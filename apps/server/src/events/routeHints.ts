// Which live hint each changing API route sends. One table, so "does
// every change reach the people who see it" is checked in one place:
// routeHints.test.ts fails when a POST/PUT/PATCH/DELETE route is in
// neither ROUTE_HINTS nor NO_HINT.
//
// Each entry may read what it needs *before* the route runs (`before`:
// the owner of a thing about to be deleted or moved, the members of a
// club about to lose one), and builds the hints once the route answered
// with a 2xx (`after`, with the route's JSON reply). Hints are published
// after the reply is sent and never fail a request.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Hint, HintOwner } from './hub.js';
import { orgIdBySlug, ownerOfResource, publish, staffIds, type Reach } from './audience.js';
import { clubRunners, recipientsOf } from '../routes/warnings.js';

type ResourceKind = 'layout' | 'module' | 'venue' | 'custom-part';

export interface HintCtx {
  req: FastifyRequest;
  params: Record<string, string>;
  body: Record<string, unknown>;
  /** The route's JSON reply (2xx only), or null. */
  reply: Record<string, unknown> | null;
  userId: string | null;
  /** What `before` stored. */
  before: Record<string, unknown>;
}

export interface HintSpec {
  before?: (ctx: HintCtx) => Promise<void>;
  after: (ctx: HintCtx) => Promise<Array<{ hint: Hint; reach?: Reach }>>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function action(req: FastifyRequest): string {
  const url = req.routeOptions.url ?? '';
  const last = url.split('/').filter((s) => s && !s.startsWith(':')).pop() ?? '';
  const verb = req.method === 'POST' ? 'create' : req.method === 'DELETE' ? 'delete' : 'update';
  return last && !['layouts', 'modules', 'venues', 'custom-parts', 'orgs'].includes(last) ? `${verb}:${last}` : verb;
}

function sameOwner(a?: HintOwner, b?: HintOwner): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

/**
 * A layout, module, venue or custom part. The hint goes to whoever owned
 * it before the change and whoever owns it after (a move, a transfer, a
 * copy into a club), plus `extraUsers` (someone just removed from it).
 * `idFrom` says where the thing's id is: a route param, or the reply
 * (a create or copy answers with the new id).
 */
function resource(
  kind: ResourceKind,
  idFrom: { param?: string; reply?: string } = { param: 'id' },
  extraUsers: (ctx: HintCtx) => (string | null)[] = () => [],
): HintSpec {
  return {
    before: async (ctx) => {
      const id = idFrom.param ? ctx.params[idFrom.param] : null;
      if (!id) return;
      const was = await ownerOfResource(kind, id);
      ctx.before.owner = was?.owner;
      ctx.before.isGlobal = was?.isGlobal;
      // Its collaborators lose sight of it once it's deleted: ask now.
      ctx.before.collaborators = await collaboratorsOf(kind, id);
    },
    after: async (ctx) => {
      const id = (idFrom.reply ? str(ctx.reply?.[idFrom.reply]) : null) ?? (idFrom.param ? ctx.params[idFrom.param] : null);
      if (!id) return [];
      const now = await ownerOfResource(kind, id);
      const act = action(ctx.req);
      const extra = [...extraUsers(ctx), ...((ctx.before.collaborators as string[] | undefined) ?? [])];
      if (ctx.before.isGlobal || now?.isGlobal) return [{ hint: { kind, id, action: act }, reach: { everyone: true } }];
      const out: Array<{ hint: Hint; reach?: Reach }> = [];
      const was = ctx.before.owner as HintOwner | undefined;
      if (was) out.push({ hint: { kind, owner: was, id, action: act }, reach: { users: extra } });
      if (now?.owner && !sameOwner(was, now.owner)) out.push({ hint: { kind, owner: now.owner, id, action: act }, reach: { users: extra } });
      if (out.length === 0 && extra.length) out.push({ hint: { kind, id, action: act }, reach: { users: extra } });
      return out;
    },
  };
}

async function collaboratorsOf(kind: ResourceKind, id: string): Promise<string[]> {
  if (kind === 'layout') {
    return (await db.select({ u: schema.layoutCollaborators.userId }).from(schema.layoutCollaborators).where(eq(schema.layoutCollaborators.layoutId, id)).all()).map((r) => r.u);
  }
  if (kind === 'module') {
    return (await db.select({ u: schema.moduleCollaborators.userId }).from(schema.moduleCollaborators).where(eq(schema.moduleCollaborators.moduleId, id)).all()).map((r) => r.u);
  }
  if (kind === 'custom-part') {
    return (await db.select({ u: schema.customPartCollaborators.userId }).from(schema.customPartCollaborators).where(eq(schema.customPartCollaborators.customPartId, id)).all()).map((r) => r.u);
  }
  return [];
}

async function memberIds(orgId: string): Promise<string[]> {
  return (await db.select({ u: schema.orgMembers.userId }).from(schema.orgMembers).where(eq(schema.orgMembers.orgId, orgId)).all()).map((r) => r.u);
}

/**
 * A club itself (settings, members, invites, join requests). Goes to the
 * club's members before and after the change (so someone removed, or a
 * club deleted, still drops off their screens), the person acting, and
 * `extraUsers`.
 */
function club(
  orgFrom: (ctx: HintCtx) => Promise<string | null>,
  extraUsers: (ctx: HintCtx) => (string | null)[] = () => [],
): HintSpec {
  return {
    before: async (ctx) => {
      const orgId = await orgFrom(ctx);
      ctx.before.orgId = orgId;
      ctx.before.members = orgId ? await memberIds(orgId) : [];
    },
    after: async (ctx) => {
      const orgId = (ctx.before.orgId as string | null) ?? (await orgFrom(ctx));
      if (!orgId) return [];
      const users = [ctx.userId, ...extraUsers(ctx), ...((ctx.before.members as string[] | undefined) ?? [])];
      return [{ hint: { kind: 'club', owner: { kind: 'org', id: orgId }, id: orgId, action: action(ctx.req) }, reach: { users } }];
    },
  };
}

const bySlug = (ctx: HintCtx) => orgIdBySlug(ctx.params.slug ?? '');

/** Something only the signed-in person sees (their account, settings, devices). */
const me: HintSpec = {
  after: async (ctx) => (ctx.userId ? [{ hint: { kind: 'me', owner: { kind: 'user', id: ctx.userId }, action: action(ctx.req) } }] : []),
};

/** Site-wide data everyone sees (global parts, site settings). */
function everyone(kind: Hint['kind']): HintSpec {
  return { after: async (ctx) => [{ hint: { kind, action: action(ctx.req) }, reach: { everyone: true } }] };
}

/** Admin-only data: site admins (and, for `alsoUser`, the person it is about). */
function adminOnly(kind: Hint['kind'], alsoUser?: (ctx: HintCtx) => string | null): HintSpec {
  return {
    after: async (ctx) => {
      const out: Array<{ hint: Hint; reach?: Reach }> = [{ hint: { kind, action: action(ctx.req) }, reach: { ownerless: true } }];
      const u = alsoUser?.(ctx);
      if (u) out.push({ hint: { kind: 'me', owner: { kind: 'user', id: u }, action: action(ctx.req) } });
      return out;
    },
  };
}

async function catalogItemOwner(itemId: string): Promise<HintOwner | undefined> {
  const row = await db
    .select({ u: schema.catalogItems.ownerUserId, o: schema.catalogItems.ownerOrgId })
    .from(schema.catalogItems)
    .where(eq(schema.catalogItems.id, itemId))
    .get();
  if (!row) return undefined;
  return row.o ? { kind: 'org', id: row.o } : row.u ? { kind: 'user', id: row.u } : undefined;
}

async function itemOfVersion(versionId: string): Promise<string | null> {
  const row = await db.select({ i: schema.catalogItemVersions.itemId }).from(schema.catalogItemVersions).where(eq(schema.catalogItemVersions.id, versionId)).get();
  return row?.i ?? null;
}

/**
 * The public catalog. Anything that changes what's published goes to
 * everyone; a submission or a decline goes to its owner and moderators.
 */
function catalog(itemFrom: (ctx: HintCtx) => Promise<string | null>, publicChange: boolean): HintSpec {
  return {
    after: async (ctx) => {
      const itemId = await itemFrom(ctx);
      const owner = itemId ? await catalogItemOwner(itemId) : undefined;
      const hint: Hint = { kind: 'catalog', action: action(ctx.req), ...(owner ? { owner } : {}), ...(itemId ? { id: itemId } : {}) };
      return [{ hint, reach: publicChange ? { everyone: true } : { users: [ctx.userId] } }];
    },
  };
}

/** Adding a catalog item puts a module or part in your things, or your club's. */
const catalogAdd: HintSpec = {
  after: async (ctx) => {
    const kind = ctx.reply?.kind === 'part' ? 'custom-part' : 'module';
    const id = str(ctx.reply?.id);
    if (!id) return [];
    const now = await ownerOfResource(kind, id);
    const out: Array<{ hint: Hint; reach?: Reach }> = [];
    if (now?.owner) out.push({ hint: { kind, owner: now.owner, id, action: 'create' } });
    // The item's "uses" count is public.
    out.push({ hint: { kind: 'catalog', id: ctx.params.id ?? '', action: 'add' }, reach: { everyone: true } });
    return out;
  },
};

const param = (name: string) => (ctx: HintCtx) => ctx.params[name] ?? null;

async function joinRequester(id: string): Promise<string | null> {
  const row = await db.select({ u: schema.orgJoinRequests.userId }).from(schema.orgJoinRequests).where(eq(schema.orgJoinRequests.id, id)).get();
  return row?.u ?? null;
}

/**
 * A warning: to whoever received it, and whoever may see it. Site
 * warnings: site admins and moderators. Club warnings: the club's admins
 * and managers, and site admins (not moderators).
 */
function warningHint(idFrom: (ctx: HintCtx) => string | null): HintSpec {
  return {
    after: async (ctx) => {
      const id = idFrom(ctx);
      if (!id) return [];
      const w = await db.select().from(schema.warnings).where(eq(schema.warnings.id, id)).get();
      if (!w) return [];
      const users = [
        ...(await recipientsOf(w)),
        ...(w.clubOrgId ? await clubRunners(w.clubOrgId) : []),
        ...(await staffIds(w.scope === 'site')),
      ];
      return [{ hint: { kind: 'warning', id: w.id, action: action(ctx.req) }, reach: { ownerless: true, users } }];
    },
  };
}

export const ROUTE_HINTS: Record<string, HintSpec> = {
  // ---- account (other tabs and the desktop app of the same person)
  'PATCH /api/auth/me': me,
  'POST /api/auth/link': me,
  'DELETE /api/auth/link': me,
  'POST /api/auth/device/approve': me,
  'POST /api/auth/device/deny': me,
  'DELETE /api/tokens/:id': me,
  'PUT /api/me/preferences': me,

  // ---- layouts
  'POST /api/layouts': resource('layout', { reply: 'id' }),
  'PATCH /api/layouts/:id': resource('layout'),
  'DELETE /api/layouts/:id': resource('layout'),
  'POST /api/layouts/:id/copy': resource('layout', { reply: 'id' }),
  'PUT /api/layouts/:id/snapshot': resource('layout'),
  'POST /api/layouts/:id/public-share': resource('layout'),
  'DELETE /api/layouts/:id/public-share': resource('layout'),
  'POST /api/layouts/:id/background-image': resource('layout'),
  'DELETE /api/layouts/:id/background-image': resource('layout'),
  'POST /api/layouts/:id/invites': resource('layout'),
  'DELETE /api/layouts/:id/invites/:inviteId': resource('layout'),
  'PATCH /api/layouts/:id/collaborators/:userId': resource('layout', { param: 'id' }, (c) => [c.params.userId ?? null]),
  'DELETE /api/layouts/:id/collaborators/:userId': resource('layout', { param: 'id' }, (c) => [c.params.userId ?? null]),
  'POST /api/invites/:token': resource('layout', { reply: 'layoutId' }),
  'POST /api/layouts/:id/transfer': resource('layout'),
  'POST /api/transfers/:token': resource('layout', { reply: 'layoutId' }),
  'DELETE /api/layouts/:id/transfer/:transferId': resource('layout'),

  // ---- modules
  'POST /api/modules': resource('module', { reply: 'id' }),
  'POST /api/modules/:id/copy': resource('module', { reply: 'id' }),
  'PATCH /api/modules/:id': resource('module'),
  'DELETE /api/modules/:id': resource('module'),
  'PUT /api/modules/:id/snapshot': resource('module'),
  'PUT /api/modules/:id/thumbnail': resource('module'),
  'POST /api/modules/:id/versions/:n/restore': resource('module'),
  'POST /api/modules/:id/invites': resource('module'),
  'DELETE /api/modules/:id/collaborators/:userId': resource('module', { param: 'id' }, (c) => [c.params.userId ?? null]),
  'POST /api/modules/:id/transfer': resource('module'),
  'POST /api/module-transfers/:token': resource('module', { reply: 'moduleId' }),

  // ---- venues
  'POST /api/venues': resource('venue', { reply: 'id' }),
  'PATCH /api/venues/:id': resource('venue'),
  'DELETE /api/venues/:id': resource('venue'),
  'POST /api/venues/:id/copy': resource('venue', { reply: 'id' }),
  'POST /api/venues/:id/move': resource('venue'),

  // ---- custom parts
  'POST /api/custom-parts': resource('custom-part', { reply: 'id' }),
  'PUT /api/custom-parts/:id': resource('custom-part'),
  'DELETE /api/custom-parts/:id': resource('custom-part'),
  'POST /api/custom-parts/:id/invites': resource('custom-part'),
  'PATCH /api/custom-parts/:id/collaborators/:userId': resource('custom-part', { param: 'id' }, (c) => [c.params.userId ?? null]),
  'DELETE /api/custom-parts/:id/collaborators/:userId': resource('custom-part', { param: 'id' }, (c) => [c.params.userId ?? null]),
  'POST /api/custom-part-invites/:token': resource('custom-part', { reply: 'customPartId' }),

  // ---- public catalog
  'POST /api/catalog/submissions': catalog(async (c) => str(c.reply?.id), false),
  'POST /api/catalog/items/:id/withdraw': catalog(async (c) => c.params.id ?? null, true),
  'POST /api/catalog/items/:id/add': catalogAdd,
  'POST /api/catalog/copies/:copyId/update': {
    // The copy is a module or a custom part: whichever has that id.
    after: async (c) => {
      const id = c.params.copyId ?? '';
      const kind: ResourceKind = (await ownerOfResource('module', id)) ? 'module' : 'custom-part';
      return resource(kind, { param: 'copyId' }).after(c);
    },
  },
  'POST /api/moderation/versions/:versionId/approve': catalog(async (c) => itemOfVersion(c.params.versionId ?? ''), true),
  'POST /api/moderation/versions/:versionId/decline': catalog(async (c) => itemOfVersion(c.params.versionId ?? ''), false),
  'POST /api/moderation/items/:id/unpublish': catalog(async (c) => c.params.id ?? null, true),

  // ---- clubs
  'POST /api/orgs': club(async (c) => str(c.reply?.id)),
  'PATCH /api/orgs/:slug': club(bySlug),
  'DELETE /api/orgs/:slug': club(bySlug),
  'POST /api/orgs/:slug/hand-over': club(bySlug),
  'POST /api/orgs/:slug/invites': club(bySlug),
  'DELETE /api/orgs/:slug/invites/:inviteId': club(bySlug),
  'POST /api/orgs/:slug/invites/:inviteId/resend': club(bySlug),
  'PATCH /api/orgs/:slug/members/:userId': club(bySlug, (c) => [c.params.userId ?? null]),
  'DELETE /api/orgs/:slug/members/:userId': club(bySlug, (c) => [c.params.userId ?? null]),
  'PUT /api/orgs/:slug/part-libraries/:libraryId': club(bySlug),
  'DELETE /api/orgs/:slug/part-libraries/:libraryId': club(bySlug),
  'POST /api/org-invites/:token': club(async (c) => str(c.reply?.orgId)),
  'POST /api/orgs/:slug/join': club(bySlug),
  'DELETE /api/orgs/:slug/join': club(bySlug),
  'POST /api/orgs/:slug/join-requests/:id/approve': {
    before: async (c) => {
      c.before.requester = await joinRequester(c.params.id ?? '');
      await club(bySlug).before!(c);
    },
    after: (c) => club(bySlug, () => [c.before.requester as string | null]).after(c),
  },
  'POST /api/orgs/:slug/join-requests/:id/decline': {
    before: async (c) => {
      c.before.requester = await joinRequester(c.params.id ?? '');
      await club(bySlug).before!(c);
    },
    after: (c) => club(bySlug, () => [c.before.requester as string | null]).after(c),
  },

  // ---- warnings
  'POST /api/admin/warnings': warningHint((c) => str(c.reply?.id)),
  'POST /api/orgs/:slug/warnings': warningHint((c) => str(c.reply?.id)),
  'POST /api/notices/:id/acknowledge': warningHint((c) => c.params.id ?? null),

  // ---- site admin
  'PATCH /api/admin/users/:id': adminOnly('admin', param('id')),
  'DELETE /api/admin/users/:id': adminOnly('admin'),
  'POST /api/admin/users/:id/sessions/revoke-all': adminOnly('admin', param('id')),
  'DELETE /api/admin/orgs/:id': club(async (c) => c.params.id ?? null),
  'DELETE /api/admin/layouts/:id': resource('layout'),
  'POST /api/admin/global-parts': everyone('parts-library'),
  'DELETE /api/admin/global-parts/:id': everyone('parts-library'),
  'POST /api/admin/part-libraries': everyone('parts-library'),
  'POST /api/admin/part-libraries/install-base': everyone('parts-library'),
  'POST /api/admin/part-libraries/download': everyone('parts-library'),
  'PATCH /api/admin/part-libraries/:id': everyone('parts-library'),
  'POST /api/admin/part-libraries/:id/update': everyone('parts-library'),
  'DELETE /api/admin/part-libraries/:id': everyone('parts-library'),
  'POST /api/admin/reload-parts': everyone('parts-library'),
  'PATCH /api/admin/settings': everyone('settings'),
  'PATCH /api/admin/limits': adminOnly('limits'),
  'PUT /api/admin/users/:id/limits': adminOnly('limits', param('id')),
  'PUT /api/admin/orgs/:id/limits': {
    before: (c) => club(async (cc) => cc.params.id ?? null).before!(c),
    after: async (c) => [
      { hint: { kind: 'limits', action: action(c.req) }, reach: { ownerless: true } },
      ...(await club(async (cc) => cc.params.id ?? null).after(c)),
    ],
  },
};

/**
 * Changing routes that send no hint, and why. Signing in and out, and
 * reads done with POST, change nothing anyone else is looking at.
 */
export const NO_HINT: Record<string, string> = {
  'POST /api/auth/password/register': 'a new account: nobody is looking at it yet',
  'POST /api/auth/password/resend-verification': 'sends an email only',
  'POST /api/auth/password/verify-email/:token': 'signs in; the new page loads fresh',
  'POST /api/auth/password/login': 'signs in; the new page loads fresh',
  'POST /api/auth/demo': 'signs in as the demo account; the new page loads fresh',
  'POST /api/admin/demo/reset': 'the reset sends its own hints to the demo account and admins (demo/reset.ts)',
  'POST /api/auth/logout': 'signs out',
  'POST /api/auth/device/code': 'starts a device sign-in; nothing to show yet',
  'POST /api/auth/device/token': 'the desktop polling for its token',
  'POST /api/auth/device/lookup': 'reads a pending device code',
  'POST /api/layouts/:id/compare': 'a read (compares two copies)',
  'POST /api/metrics/client': 'anonymous client timing beacon',
};

/** Route key as the table spells it. */
export function routeKey(method: string, url: string): string {
  return `${method} ${url}`;
}

declare module 'fastify' {
  interface FastifyRequest {
    hintCtx?: HintCtx;
  }
}

/**
 * Register after attachUser. Errors are logged, never thrown at the
 * request: a missed hint costs a refresh, not a failed save.
 */
export function registerChangeHints(app: FastifyInstance): void {
  app.addHook('preHandler', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const spec = ROUTE_HINTS[routeKey(req.method, req.routeOptions.url ?? '')];
    if (!spec) return;
    const ctx: HintCtx = {
      req,
      params: (req.params ?? {}) as Record<string, string>,
      body: (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>,
      reply: null,
      userId: req.user?.id ?? null,
      before: {},
    };
    req.hintCtx = ctx;
    try {
      await spec.before?.(ctx);
    } catch (err) {
      req.log.warn({ err }, 'live hint: before failed');
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const ctx = req.hintCtx;
    if (!ctx || reply.statusCode < 200 || reply.statusCode >= 300) return payload;
    if (typeof payload === 'string' && payload.length < 65_536 && payload.startsWith('{')) {
      try {
        ctx.reply = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        ctx.reply = null;
      }
    }
    return payload;
  });

  app.addHook('onResponse', async (req, reply) => {
    const ctx = req.hintCtx;
    if (!ctx || reply.statusCode < 200 || reply.statusCode >= 300) return;
    const spec = ROUTE_HINTS[routeKey(req.method, req.routeOptions.url ?? '')];
    if (!spec) return;
    try {
      for (const { hint, reach } of await spec.after(ctx)) await publish(hint, reach);
    } catch (err) {
      req.log.warn({ err }, 'live hint: after failed');
    }
  });
}
