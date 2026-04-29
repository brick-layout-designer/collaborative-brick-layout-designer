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

// Per-user cap on concurrent WS connections. Prevents one tab fork-bomb
// from exhausting the server. 8 is enough for a normal user across a
// few browser tabs/windows.
const MAX_WS_PER_USER = 8;
const userConnections = new Map<string, number>();

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket);
  docHub.startSnapshotWorker();
  app.addHook('onClose', async () => {
    docHub.stopSnapshotWorker();
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

        const detach = await attachWsHandlers(ws, layoutId, userId);

        const cleanup = async () => {
          await detach();
          const n = (userConnections.get(userId) ?? 1) - 1;
          if (n <= 0) userConnections.delete(userId);
          else userConnections.set(userId, n);
        };
        ws.on('close', () => void cleanup());
        ws.on('error', () => void cleanup());
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
