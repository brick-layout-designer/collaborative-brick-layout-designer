// WebSocket route at `/ws/layout/:id`.
//
// Auth: the session cookie is sent automatically with the WS handshake
// because @fastify/websocket runs through the same HTTP pipeline. We
// reuse `attachUser` (same as REST) to populate `req.user` and reject
// the upgrade if the user lacks at least viewer role.
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
import { onSessionRevoked, SESSION_COOKIE, sessionIdForToken } from '../auth/session.js';

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

/** Open sockets and the session/user they authenticated as. */
const openSockets = new Map<{ close(code?: number, reason?: string): void }, { userId: string; sessionId: string }>();

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket, { options: { maxPayload: WS_MAX_PAYLOAD } });
  docHub.startSnapshotWorker();
  // Logout / "revoke all sessions" / user deletion: close the affected
  // sockets now rather than when the client next reconnects. 1008 is the
  // code the editor already maps to "not signed in".
  const unsubscribe = onSessionRevoked((r) => {
    for (const [sock, who] of openSockets) {
      if ('sessionId' in r ? who.sessionId === r.sessionId : who.userId === r.userId) {
        try {
          sock.close(1008, 'session_revoked');
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
    { websocket: true },
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
        const sessionId = sessionIdForToken(req.cookies[SESSION_COOKIE] ?? '');
        let detach: () => Promise<void>;
        try {
          detach = await attachWsHandlers(ws, layoutId, userId, role.role!, sessionId);
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
        openSockets.set(ws, { userId, sessionId });
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
