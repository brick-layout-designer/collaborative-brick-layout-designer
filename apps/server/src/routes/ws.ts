// WebSocket route at `/ws/layout/:id`.
//
// Auth: the session cookie is sent automatically with the WS handshake
// because @fastify/websocket runs through the same HTTP pipeline. We
// reuse `attachUser` (same as REST) to populate `req.user` and reject
// the upgrade if the user lacks at least viewer role. Non-browser
// clients (the desktop app) instead send `Authorization: Bearer
// bld_pat_…` on the upgrade request; this route is on the API-token
// allow-list, and a token without `layouts:write` is held to viewer.
// Tokens are never read from the query string.
//
// Cookie-authenticated handshakes must come from our own origin: a
// browser attaches the session cookie to a WebSocket opened by ANY page
// (WebSockets aren't subject to CORS), so without this check another
// site could open a socket as the signed-in user (cross-site WebSocket
// hijacking). Browsers can't set Authorization on a WebSocket, so
// token handshakes carry no such ambient credential and skip the check.
//
// Phase 5 will distinguish viewer (read-only WS) from editor (writable);
// for Phase 4 we accept any role >= viewer and let the editor's REST
// endpoints gate write actions. Per-message viewer enforcement is
// stubbed in `handler.ts` and lands when sharing UIs do.

import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { docHub } from '../ws/docHub.js';
import { attachWsHandlers } from '../ws/handler.js';
import { hasAtLeast, resolveResourceRole } from '../access/resolveResourceRole.js';
import { SESSION_COOKIE, sessionIdForToken } from '../auth/session.js';
import { onCredentialRevoked } from '../auth/revocation.js';
import { isRevokedBy, revokedReason, type Credential } from '../auth/credentials.js';
import { bearerToken } from '../auth/cookie.js';
import { hasScope } from '../auth/apiTokens.js';
import { env } from '../env.js';

// Per-user cap on concurrent WS connections. Prevents one tab fork-bomb
// from exhausting the server. 8 is enough for a normal user across a
// few browser tabs/windows.
const MAX_WS_PER_USER = 8;
const userConnections = new Map<string, number>();

/**
 * Largest single WS message accepted. `ws` defaults to 100 MiB, which
 * lets one socket make the server buffer (and Yjs decode) a huge frame.
 * 16 MiB rather than something tighter: a y-websocket client's sync
 * step 2 / first update after a long offline session can carry a large
 * slice of a big layout, and an over-limit frame closes the socket (1009)
 * — the client would reconnect and resend it forever. (The REST snapshot
 * endpoint allows 50 MiB for whole documents.)
 */
export const WS_MAX_PAYLOAD = 16 * 1024 * 1024;

/** Open sockets and the credential/user they authenticated as. */
const openSockets = new Map<
  { close(code?: number, reason?: string): void },
  { userId: string; credential: Credential }
>();

/**
 * True when a handshake may proceed as far as the Origin goes: token
 * (Bearer) handshakes always; cookie handshakes when there's no Origin
 * (a non-browser client — browsers always send one) or it is PUBLIC_URL's.
 */
export function isAllowedWsOrigin(origin: string | undefined, hasBearer: boolean): boolean {
  if (hasBearer || origin === undefined) return true;
  try {
    return new URL(origin).origin === new URL(env.publicUrl).origin;
  } catch {
    return false;
  }
}

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket, { options: { maxPayload: WS_MAX_PAYLOAD } });
  docHub.startSnapshotWorker();
  // Logout / "revoke all sessions" / user deletion / token revoked:
  // close the affected sockets now rather than when the client next
  // reconnects. 1008 is the code the editor already maps to "not signed
  // in".
  const unsubscribe = onCredentialRevoked((r) => {
    for (const [sock, who] of openSockets) {
      if (isRevokedBy(who.credential, who.userId, r)) {
        try {
          sock.close(1008, revokedReason(who.credential));
        } catch {
          /* already closed */
        }
      }
    }
  });
  app.addHook('onClose', async () => {
    docHub.stopSnapshotWorker();
    unsubscribe();
  });

  app.get<{ Params: { id: string } }>(
    '/ws/layout/:id',
    {
      websocket: true,
      config: { apiToken: 'layouts:read' },
      // Runs before the upgrade, so a refused Origin gets a plain 403
      // instead of an accepted-then-closed socket.
      preValidation: async (req, reply) => {
        const origin = req.headers.origin;
        if (!isAllowedWsOrigin(origin, bearerToken(req) !== null)) {
          // Most often a misconfigured PUBLIC_URL (the app reached under
          // another host/port), so say so in the log.
          req.log.warn({ origin, publicUrl: env.publicUrl }, 'ws: refused cross-origin handshake');
          return reply.code(403).send({ error: 'origin_not_allowed' });
        }
      },
    },
    async (socket, req) => {
      const ws = socket;
      try {
        if (!req.user) {
          ws.close(1008, 'unauthorized');
          return;
        }
        const layoutId = req.params.id;
        const role = await resolveResourceRole(req.user.id, 'layout', layoutId);
        if (!hasAtLeast(role.role, 'viewer')) {
          // 4404 = our convention for "no such layout". Real WS close
          // codes 4000-4999 are reserved for app use.
          ws.close(4404, 'not_found');
          return;
        }

        const userId = req.user.id;
        const current = userConnections.get(userId) ?? 0;
        if (current >= MAX_WS_PER_USER) {
          ws.close(4429, 'too_many_connections');
          return;
        }
        userConnections.set(userId, current + 1);

        // role.role is non-null here because hasAtLeast(role.role, 'viewer')
        // succeeded above. Cast for the type system.
        const token = req.apiToken;
        const credential: Credential = token
          ? { kind: 'token', id: token.id }
          : { kind: 'session', id: sessionIdForToken(req.cookies[SESSION_COOKIE] ?? '') };
        const readOnly = token !== null && !hasScope(token.scopes, 'layouts:write');
        let detach: () => Promise<void>;
        try {
          detach = await attachWsHandlers(ws, layoutId, userId, role.role!, { credential, readOnly });
        } catch (err) {
          const n = (userConnections.get(userId) ?? 1) - 1;
          if (n <= 0) userConnections.delete(userId);
          else userConnections.set(userId, n);
          throw err;
        }

        // A socket can emit 'error' AND 'close' (e.g. an invalid UTF-8
        // text frame), and may already be closed if the client went away
        // while we were hydrating. Run the cleanup exactly once either way:
        // a double detach used to double-decrement the connection count and
        // arm a second idle timer that destroyed the doc under a live client.
        openSockets.set(ws, { userId, credential });
        let cleanedUp = false;
        const cleanup = async () => {
          if (cleanedUp) return;
          cleanedUp = true;
          openSockets.delete(ws);
          const n = (userConnections.get(userId) ?? 1) - 1;
          if (n <= 0) userConnections.delete(userId);
          else userConnections.set(userId, n);
          try {
            await detach();
          } catch (err) {
            app.log.error({ err, layoutId }, 'ws detach failed');
          }
        };
        ws.on('close', () => void cleanup());
        ws.on('error', () => void cleanup());
        if (ws.readyState === ws.CLOSING || ws.readyState === ws.CLOSED) {
          void cleanup();
        }
      } catch (err) {
        app.log.error({ err }, 'ws upgrade failed');
        try {
          ws.close(1011, 'internal_error');
        } catch {
          /* socket already closed */
        }
      }
    },
  );
}
