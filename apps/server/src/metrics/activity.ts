// Request-level counting for the admin dashboard: one onResponse hook
// that feeds the daily rollup (rollup.ts) and keeps users.last_seen_at
// and layouts.last_opened_at roughly current. Everything here is cheap
// in-memory work; the database writes are throttled.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { rollup } from './rollup.js';

/** Requests slower than this count as "slow" on the dashboard. */
export const SLOW_REQUEST_MS = 1000;

const SEEN_THROTTLE_MS = 5 * 60 * 1000;
const OPENED_THROTTLE_MS = 10 * 60 * 1000;
const lastSeenWrite = new Map<string, number>();
const lastOpenedWrite = new Map<string, number>();

function throttled(map: Map<string, number>, id: string, every: number, now: number): boolean {
  const last = map.get(id);
  if (last !== undefined && now - last < every) return true;
  map.set(id, now);
  // Keep the maps from growing forever on a long-lived process.
  if (map.size > 50_000) map.clear();
  return false;
}

/** Note that a person made a signed-in request (writes at most every 5 minutes). */
export function touchUser(userId: string, now: number = Date.now()): void {
  if (throttled(lastSeenWrite, userId, SEEN_THROTTLE_MS, now)) return;
  try {
    db.update(schema.users).set({ lastSeenAt: new Date(now) }).where(eq(schema.users.id, userId)).run();
  } catch {
    /* best-effort */
  }
}

/** Note that a layout was opened (writes at most every 10 minutes). */
export function touchLayoutOpened(layoutId: string, now: number = Date.now()): void {
  if (throttled(lastOpenedWrite, layoutId, OPENED_THROTTLE_MS, now)) return;
  try {
    db.update(schema.layouts).set({ lastOpenedAt: new Date(now) }).where(eq(schema.layouts.id, layoutId)).run();
  } catch {
    /* best-effort */
  }
}

/** Forget throttles (tests). */
export function resetActivityThrottles(): void {
  lastSeenWrite.clear();
  lastOpenedWrite.clear();
}

export type ClientKind =
  | { kind: 'desktop'; version: string }
  | { kind: 'web'; device: 'phone' | 'tablet' | 'computer' };

const DESKTOP_UA = /^BrickLayoutDesigner\/([0-9][0-9A-Za-z.+-]{0,31}) \(desktop\)/;

/**
 * What kind of client sent a request, from its User-Agent. The desktop
 * app sends `BrickLayoutDesigner/<version> (desktop)`; everything else
 * is the web app, split by device. Only the kind is counted.
 */
export function classifyClient(userAgent: string | undefined): ClientKind {
  const ua = userAgent ?? '';
  const desktop = DESKTOP_UA.exec(ua);
  if (desktop) return { kind: 'desktop', version: desktop[1]! };
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return { kind: 'web', device: 'tablet' };
  if (/Mobi|iPhone|iPod/i.test(ua)) return { kind: 'web', device: 'phone' };
  return { kind: 'web', device: 'computer' };
}

/** The route pattern a request matched, or "(unmatched)" — never the raw URL. */
export function routeLabel(req: FastifyRequest): string {
  return `${req.method} ${req.routeOptions?.url ?? '(unmatched)'}`;
}

/**
 * Count every /api and /ws request: totals, 5xx, slow ones, refused ones
 * (403/429) by route, and, for signed-in people, which client they use.
 */
export function registerRequestMetrics(app: FastifyInstance): void {
  app.addHook('onResponse', async (req, reply) => {
    const path = req.url;
    if (!path.startsWith('/api/') && !path.startsWith('/ws/')) return;
    const now = Date.now();
    const status = reply.statusCode;
    rollup.count('requests', '', 1, now);
    if (status >= 500) {
      rollup.count('errors_5xx', '', 1, now);
      rollup.count('errors_5xx_route', routeLabel(req), 1, now);
    }
    if (reply.elapsedTime > SLOW_REQUEST_MS) {
      rollup.count('slow', '', 1, now);
      rollup.count('slow_route', routeLabel(req), 1, now);
    }
    if (status === 403 || status === 429) {
      rollup.count('refused', `${status} ${routeLabel(req)}`, 1, now);
    }
    const user = req.user;
    if (!user) return;
    touchUser(user.id, now);
    const client = classifyClient(req.headers['user-agent']);
    if (client.kind === 'desktop') {
      rollup.distinct('client', 'desktop', user.id, now);
      rollup.distinct('desktop_version', client.version, user.id, now);
    } else {
      rollup.distinct('client', 'web', user.id, now);
      rollup.distinct('device', client.device, user.id, now);
    }
  });
}
