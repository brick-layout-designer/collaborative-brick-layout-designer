export type ProviderId = 'google' | 'github' | 'oidc';

export interface Me {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isDemoAccount: boolean;
  isGlobalAdmin: boolean;
  linkedProviders: ProviderId[];
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  enabled: boolean;
}

/**
 * Curated overrides for error codes whose humanized form (see
 * `humanizeErrorCode`) would read awkwardly or ambiguously in a form's
 * inline error text. Everything else falls through to the generic
 * snake_case → sentence conversion.
 */
const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  invalid_input: 'Please fill in all required fields.',
  email_taken: 'An account with that email already exists.',
  invalid_email: 'Enter a valid email address.',
  forbidden: "You don't have permission to do that.",
  not_found: 'That item could not be found.',
  payload_too_large: 'That file is too large.',
};

/** `some_error_code` -> "Some error code." */
function humanizeErrorCode(code: string): string {
  const words = code.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1) + '.';
}

/**
 * Reads `{ error: string }` from a failed JSON response and turns it
 * into a message fit for direct display in the UI — never the raw
 * `path → status`, which used to leak straight into forms (e.g. a
 * failed login showing "/api/auth/password/login → 401").
 */
async function friendlyErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) {
      return ERROR_MESSAGES[body.error] ?? humanizeErrorCode(body.error);
    }
  } catch {
    // Response wasn't JSON, or had no `error` field — fall through.
  }
  if (res.status === 401) return 'You need to sign in to do that.';
  if (res.status === 403) return "You don't have permission to do that.";
  if (res.status >= 500) return 'Something went wrong on our end. Please try again.';
  return 'Something went wrong. Please try again.';
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(await friendlyErrorMessage(res));
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: 'POST', credentials: 'include' };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(await friendlyErrorMessage(res));
  return res.json() as Promise<T>;
}

export interface LayoutSummary {
  id: string;
  title: string;
  ownerUserId: string | null;
  ownerOrgId: string | null;
  ownerOrgName: string | null;
  ownerOrgSlug: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  docVersion: number;
  hasSidecar: boolean;
  /**
   * Non-null when the layout is publicly shared. The token is the
   * suffix of the share URL (`/p/<token>`). Null = private.
   */
  publicShareToken: string | null;
}

/** Anonymous-readable summary for `/p/:token` viewer pages. */
export interface PublicLayoutSummary {
  id: string;
  title: string;
  updatedAt: number;
  docVersion: number;
  hasSidecar: boolean;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await friendlyErrorMessage(res));
  return res.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const res = await fetch(path, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error(await friendlyErrorMessage(res));
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await friendlyErrorMessage(res));
  return res.json() as Promise<T>;
}

export interface ConnectionPointWire {
  type: string;
  x: number;
  y: number;
  angle: number;
  electricPlug: number;
  nextConnexionPreference?: number;
}

export interface SubPartWire {
  /** Catalog key of the referenced part. */
  subKey: string;
  /** Local position in studs, relative to the group's origin. */
  x: number;
  y: number;
  /** Local rotation in degrees. */
  angle: number;
}

export interface PartWire {
  key: string;
  partNumber: string;
  colorCode: string;
  kind: 'leaf' | 'group';
  description: string;
  sortingKey: string;
  /** Empty for source: 'custom' (use spriteUrlFor to compose). */
  spritePath: string;
  pxPerStud: number;
  /** Parent folder of the part XML — drives the category dropdown. */
  category: string;
  connections: ConnectionPointWire[];
  /** Group-only: subparts that compose this set; empty for leaves. */
  subparts: SubPartWire[];
  /** Hull polygon in pixel space (relative to sprite top-left). Empty = use bounding rect. */
  hullPts: { x: number; y: number }[];
  source: 'bundled' | 'custom';
  /** Set on source: 'custom' so the editor can build the sprite URL. */
  customPartId: string | null;
}

/** Resolve the sprite URL for any part, regardless of source. */
export function spriteUrlFor(part: PartWire): string {
  if (part.source === 'custom' && part.customPartId) {
    return `/api/custom-parts/${part.customPartId}/sprite`;
  }
  return part.spritePath ? `/parts/${part.spritePath}` : '';
}

async function getBytes(path: string): Promise<{ bytes: Uint8Array; docVersion: number }> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(await friendlyErrorMessage(res));
  const buf = await res.arrayBuffer();
  return {
    bytes: new Uint8Array(buf),
    docVersion: Number.parseInt(res.headers.get('x-doc-version') ?? '0', 10),
  };
}

async function putBytes(path: string, bytes: Uint8Array): Promise<{ updatedAt: number }> {
  const res = await fetch(path, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/octet-stream' },
    // TypeScript 7's DOM lib types narrowed BodyInit to require
    // Uint8Array<ArrayBuffer> specifically, rejecting the more general
    // Uint8Array (which could theoretically back a SharedArrayBuffer,
    // though nothing in this codebase ever produces one here).
    body: bytes as Uint8Array<ArrayBuffer>,
  });
  if (!res.ok) throw new Error(await friendlyErrorMessage(res));
  return res.json() as Promise<{ updatedAt: number }>;
}

export const api = {
  me: () => get<{ user: Me | null }>('/api/auth/me'),
  providers: () =>
    get<{ providers: ProviderInfo[]; passwordEnabled: boolean }>('/api/auth/providers'),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  passwordLogin: (email: string, password: string) =>
    post<{ ok: true }>('/api/auth/password/login', { email, password }),
  passwordRegister: (email: string, password: string, displayName?: string) =>
    post<{ ok: true }>('/api/auth/password/register', { email, password, displayName }),

  layouts: {
    list: () => get<{ layouts: LayoutSummary[] }>('/api/layouts'),
    get: (id: string) => get<{ layout: LayoutSummary; role: 'owner' | 'editor' | 'viewer' }>(
      `/api/layouts/${id}`,
    ),
    create: (body: { title?: string; bbm?: string; sidecar?: string }) =>
      post<{ id: string; title: string }>('/api/layouts', body),
    rename: (id: string, title: string) =>
      patch<{ ok: true }>(`/api/layouts/${id}`, { title }),
    remove: (id: string) => del(`/api/layouts/${id}`),
    exportBbmUrl: (id: string) => `/api/layouts/${id}/export.bbm`,
    exportSidecarUrl: (id: string) => `/api/layouts/${id}/export.bbm.cld`,
    exportZipUrl: (id: string) => `/api/layouts/${id}/export.zip`,
    snapshot: (id: string) => getBytes(`/api/layouts/${id}/snapshot`),
    saveSnapshot: (id: string, bytes: Uint8Array) =>
      putBytes(`/api/layouts/${id}/snapshot`, bytes),
    enablePublicShare: (id: string) =>
      post<{ token: string }>(`/api/layouts/${id}/public-share`),
    disablePublicShare: (id: string) =>
      del(`/api/layouts/${id}/public-share`),
  },

  publicLayouts: {
    get: (token: string) =>
      get<{ layout: PublicLayoutSummary }>(`/api/public-layouts/${token}`),
    snapshot: (token: string) => getBytes(`/api/public-layouts/${token}/snapshot`),
  },

  parts: {
    catalog: () => get<{ parts: PartWire[] }>('/api/parts/catalog'),
  },

  collaborators: {
    list: (layoutId: string) =>
      get<{ collaborators: CollaboratorSummary[]; invites: InviteSummary[] }>(
        `/api/layouts/${layoutId}/collaborators`,
      ),
    invite: (layoutId: string, email: string, role: 'viewer' | 'editor') =>
      post<{
        id: string;
        token: string;
        inviteUrl: string;
        emailDelivered: boolean;
        expiresAt: number;
      }>(`/api/layouts/${layoutId}/invites`, { email, role }),
    revokeInvite: (layoutId: string, inviteId: string) =>
      del(`/api/layouts/${layoutId}/invites/${inviteId}`),
    changeRole: (layoutId: string, userId: string, role: 'viewer' | 'editor') =>
      patch<{ ok: true }>(`/api/layouts/${layoutId}/collaborators/${userId}`, { role }),
    remove: (layoutId: string, userId: string) =>
      del(`/api/layouts/${layoutId}/collaborators/${userId}`),
  },

  invites: {
    preview: (token: string) =>
      get<{
        invitedEmail: string;
        role: 'viewer' | 'editor';
        layoutId: string;
        layoutTitle: string;
        expiresAt: number;
      }>(`/api/invites/${token}`),
    accept: (token: string) =>
      post<{ layoutId: string; role: 'viewer' | 'editor' }>(`/api/invites/${token}`),
  },

  orgs: {
    list: () => get<{ orgs: OrgSummary[] }>('/api/orgs'),
    /**
     * Create an org. `slug` is optional — when omitted, the server
     * auto-derives one from `name` and disambiguates with a numeric
     * suffix on collision. Older callers can still pass a manual slug.
     */
    create: (name: string, slug?: string) =>
      post<{ id: string; name: string; slug: string }>(
        '/api/orgs',
        slug ? { name, slug } : { name },
      ),
    get: (slug: string) => get<OrgDetail>(`/api/orgs/${slug}`),
    members: (slug: string) =>
      get<{ members: OrgMemberSummary[]; invites: OrgInviteSummary[] }>(
        `/api/orgs/${slug}/members`,
      ),
    invite: (slug: string, email: string, role: 'admin' | 'member') =>
      post<{
        id: string;
        token: string;
        inviteUrl: string;
        emailDelivered: boolean;
        expiresAt: number;
      }>(`/api/orgs/${slug}/invites`, { email, role }),
    revokeInvite: (slug: string, inviteId: string) =>
      del(`/api/orgs/${slug}/invites/${inviteId}`),
    changeMemberRole: (slug: string, userId: string, role: 'admin' | 'member') =>
      patch<{ ok: true }>(`/api/orgs/${slug}/members/${userId}`, { role }),
    removeMember: (slug: string, userId: string) =>
      del(`/api/orgs/${slug}/members/${userId}`),
    layouts: (slug: string) =>
      get<{ layouts: LayoutSummary[] }>(`/api/orgs/${slug}/layouts`),
  },

  orgInvites: {
    preview: (token: string) =>
      get<{
        invitedEmail: string;
        role: 'admin' | 'member';
        orgId: string;
        orgName: string;
        orgSlug: string;
        expiresAt: number;
      }>(`/api/org-invites/${token}`),
    accept: (token: string) =>
      post<{ orgId: string; role: 'admin' | 'member' }>(`/api/org-invites/${token}`),
  },

  transfers: {
    initiate: (
      layoutId: string,
      recipient: { email: string } | { orgSlug: string },
    ) =>
      post<
        | { transferred: true; ownerKind: 'org'; ownerSlug: string }
        | { id: string; token: string; transferUrl: string; emailDelivered: boolean; expiresAt: number }
      >(`/api/layouts/${layoutId}/transfer`, {
        recipientEmail: 'email' in recipient ? recipient.email : undefined,
        recipientOrgSlug: 'orgSlug' in recipient ? recipient.orgSlug : undefined,
      }),
    preview: (token: string) =>
      get<{
        recipientEmail: string;
        layoutId: string;
        layoutTitle: string;
        expiresAt: number;
      }>(`/api/transfers/${token}`),
    accept: (token: string) => post<{ layoutId: string }>(`/api/transfers/${token}`),
  },

  customParts: {
    list: () => get<{ parts: CustomPartSummary[] }>('/api/custom-parts'),
    get: (id: string) =>
      get<{ part: CustomPartSummary; role: 'owner' | 'editor' | 'viewer' }>(
        `/api/custom-parts/${id}`,
      ),
    create: (body: {
      partNumber: string;
      displayName: string;
      xmlBase64: string;
      spriteBase64: string;
      spriteMime: 'image/gif' | 'image/png';
      orgSlug?: string;
      category?: string;
    }) =>
      post<{ id: string; partNumber: string; displayName: string }>(
        '/api/custom-parts',
        body,
      ),
    remove: (id: string) => del(`/api/custom-parts/${id}`),
    spriteUrl: (id: string) => `/api/custom-parts/${id}/sprite`,
    xmlUrl: (id: string) => `/api/custom-parts/${id}/xml`,
    invite: (id: string, email: string, role: 'viewer' | 'editor') =>
      post<{ added?: true; pending?: true; inviteUrl?: string }>(
        `/api/custom-parts/${id}/invites`,
        { email, role },
      ),
  },

  modules: {
    list: () => get<{ modules: ModuleSummary[] }>('/api/modules'),
    get: (id: string) =>
      get<{ module: ModuleSummary; role: 'owner' | 'editor' | 'viewer' }>(
        `/api/modules/${id}`,
      ),
    create: (body: { title?: string; orgSlug?: string }) =>
      post<{ id: string; title: string }>('/api/modules', body),
    saveSnapshot: (id: string, bytes: Uint8Array) =>
      putBytes(`/api/modules/${id}/snapshot`, bytes),
    rename: (id: string, title: string) =>
      patch<{ ok: true }>(`/api/modules/${id}`, { title }),
    remove: (id: string) => del(`/api/modules/${id}`),
    invite: (id: string, email: string, role: 'viewer' | 'editor') =>
      post<{ added: true }>(`/api/modules/${id}/invites`, { email, role }),
  },

  venues: {
    list: () => get<{ venues: { id: string; name: string; ownerOrgId: string | null }[] }>('/api/venues'),
    get: (id: string) => get<{ id: string; name: string; data: unknown }>(`/api/venues/${id}`),
    create: (body: { name: string; data: unknown; orgSlug?: string }) =>
      post<{ id: string; name: string }>('/api/venues', body),
    remove: (id: string) => del(`/api/venues/${id}`),
  },

  audit: {
    forLayout: (layoutId: string, limit = 100) =>
      get<{ events: AuditEventSummary[] }>(
        `/api/layouts/${layoutId}/audit?limit=${limit}`,
      ),
    generic: (kind: 'layout' | 'custom_part' | 'module' | 'org', id: string, limit = 100) =>
      get<{ events: AuditEventSummary[] }>(
        `/api/audit?kind=${kind}&id=${encodeURIComponent(id)}&limit=${limit}`,
      ),
    forOrg: (slug: string, limit = 100, offset = 0) =>
      get<{ events: AuditEventSummary[]; limit: number; offset: number }>(
        `/api/orgs/${slug}/audit?limit=${limit}&offset=${offset}`,
      ),
  },

  customPartInvites: {
    preview: (token: string) =>
      get<{
        invitedEmail: string;
        role: 'viewer' | 'editor';
        customPartId: string;
        partNumber: string;
        displayName: string;
        expiresAt: number;
      }>(`/api/custom-part-invites/${token}`),
    accept: (token: string) =>
      post<{ customPartId: string; role: 'viewer' | 'editor' }>(
        `/api/custom-part-invites/${token}`,
      ),
  },

  moduleTransfers: {
    initiate: (
      moduleId: string,
      recipient: { email: string } | { orgSlug: string },
    ) =>
      post<
        | { transferred: true; ownerKind: 'org'; ownerSlug: string }
        | { id: string; token: string; transferUrl: string; emailDelivered: boolean; expiresAt: number }
      >(`/api/modules/${moduleId}/transfer`, {
        recipientEmail: 'email' in recipient ? recipient.email : undefined,
        recipientOrgSlug: 'orgSlug' in recipient ? recipient.orgSlug : undefined,
      }),
    preview: (token: string) =>
      get<{
        recipientEmail: string;
        moduleId: string;
        moduleTitle: string;
        expiresAt: number;
      }>(`/api/module-transfers/${token}`),
    accept: (token: string) => post<{ moduleId: string }>(`/api/module-transfers/${token}`),
  },

  // ---------------------------------------------------------------------
  // Platform admin — gated server-side by `requireGlobalAdmin`. Every
  // mutation writes an audit_event keyed by the admin's userId.
  // ---------------------------------------------------------------------
  admin: {
    stats: () => get<AdminStats>('/api/admin/stats'),
    users: (q: AdminListParams) =>
      get<{ users: AdminUser[]; total: number; limit: number; offset: number }>(
        `/api/admin/users?${listParams(q)}`,
      ),
    user: (id: string) =>
      get<{ user: AdminUser; stats: AdminUserStats }>(`/api/admin/users/${id}`),
    patchUser: (id: string, body: { isGlobalAdmin?: boolean; isDemoAccount?: boolean }) =>
      patch<{ ok: true }>(`/api/admin/users/${id}`, body),
    deleteUser: (id: string) => del(`/api/admin/users/${id}`),
    revokeUserSessions: (id: string) =>
      post<{ ok: true }>(`/api/admin/users/${id}/sessions/revoke-all`),
    orgs: (q: AdminListParams) =>
      get<{ orgs: AdminOrg[]; total: number; limit: number; offset: number }>(
        `/api/admin/orgs?${listParams(q)}`,
      ),
    deleteOrg: (id: string) => del(`/api/admin/orgs/${id}`),
    layouts: (q: AdminListParams & { ownerUserId?: string; ownerOrgId?: string }) =>
      get<{ layouts: AdminLayout[]; total: number; limit: number; offset: number }>(
        `/api/admin/layouts?${listParams(q)}`,
      ),
    deleteLayout: (id: string) => del(`/api/admin/layouts/${id}`),
    globalParts: () => get<{ parts: AdminGlobalPart[] }>('/api/admin/global-parts'),
    createGlobalPart: (body: {
      partNumber: string;
      displayName: string;
      category?: string;
      xmlBase64: string;
      spriteBase64: string;
      spriteMime: 'image/gif' | 'image/png';
    }) => post<{ id: string }>('/api/admin/global-parts', body),
    deleteGlobalPart: (id: string) => del(`/api/admin/global-parts/${id}`),
    auditLog: (q: AdminListParams) =>
      get<{ events: AdminAuditEvent[]; total: number; limit: number; offset: number }>(
        `/api/admin/audit?${listParams(q)}`,
      ),
    partLibraries: () => get<{ libraries: PartLibrary[] }>('/api/admin/part-libraries'),
    searchPartLibraries: (source: string) =>
      get<{ packages: RemotePackage[]; indexUrl: string }>(
        `/api/admin/part-libraries/search?source=${encodeURIComponent(source)}`,
      ),
    installBaseLibrary: () =>
      post<{ id: string; slug: string; partCount: number }>(
        '/api/admin/part-libraries/install-base',
      ),
    downloadPartLibrary: (body: {
      name: string;
      slug: string;
      sourceUrl: string;
      defaultEnabled?: boolean;
    }) => post<{ id: string; slug: string; partCount: number }>('/api/admin/part-libraries/download', body),
    installPartLibrary: (body: {
      name: string;
      slug: string;
      sourceUrl?: string;
      zipBase64?: string;
      defaultEnabled?: boolean;
    }) => post<{ id: string; slug: string; partCount: number }>('/api/admin/part-libraries', body),
    patchPartLibrary: (id: string, body: { name?: string; defaultEnabled?: boolean; locked?: boolean }) =>
      patch<{ ok: true }>(`/api/admin/part-libraries/${id}`, body),
    updatePartLibrary: (id: string) =>
      post<{ ok: true; partCount: number }>(`/api/admin/part-libraries/${id}/update`, {}),
    deletePartLibrary: (id: string) => del(`/api/admin/part-libraries/${id}`),
    reloadParts: () => post<{ ok: true }>('/api/admin/reload-parts'),
  },

  // Per-org part library management (org admin only).
  orgLibraries: {
    list: (slug: string) =>
      get<{ libraries: OrgPartLibrary[]; isAdmin: boolean }>(
        `/api/orgs/${encodeURIComponent(slug)}/part-libraries`,
      ),
    set: (slug: string, libraryId: string, enabled: boolean) =>
      put<{ ok: true }>(
        `/api/orgs/${encodeURIComponent(slug)}/part-libraries/${libraryId}`,
        { enabled },
      ),
    reset: (slug: string, libraryId: string) =>
      del(`/api/orgs/${encodeURIComponent(slug)}/part-libraries/${libraryId}`),
  },
};

interface AdminListParams {
  q?: string;
  limit?: number;
  offset?: number;
  ownerUserId?: string;
  ownerOrgId?: string;
}

function listParams(p: AdminListParams): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set('q', p.q);
  if (p.limit !== undefined) sp.set('limit', String(p.limit));
  if (p.offset !== undefined) sp.set('offset', String(p.offset));
  if (p.ownerUserId) sp.set('ownerUserId', p.ownerUserId);
  if (p.ownerOrgId) sp.set('ownerOrgId', p.ownerOrgId);
  return sp.toString();
}

export interface AdminStats {
  users: number;
  demoUsers: number;
  globalAdmins: number;
  orgs: number;
  layouts: number;
  customParts: number;
  modules: number;
  activeSessions: number;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isDemoAccount: boolean;
  isGlobalAdmin: boolean;
  createdAt: number;
}

export interface AdminUserStats {
  orgs: number;
  layouts: number;
  customParts: number;
  modules: number;
  activeSessions: number;
}

export interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  memberCount: number;
}

export interface AdminLayout {
  id: string;
  title: string;
  ownerUserId: string | null;
  ownerOrgId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  docVersion: number;
}

export interface AdminGlobalPart {
  id: string;
  partNumber: string;
  displayName: string;
  category: string;
  spriteMime: string;
  createdAt: number;
}

export interface AdminAuditEvent {
  id: number;
  layoutId: string | null;
  resourceKind: string | null;
  resourceId: string | null;
  userId: string | null;
  userName: string | null;
  eventType: string;
  payload: unknown;
  createdAt: number;
}

export interface AuditEventSummary {
  id: number;
  layoutId: string | null;
  resourceKind: 'layout' | 'custom_part' | 'module' | 'org' | null;
  resourceId: string | null;
  userId: string | null;
  userName: string | null;
  eventType: string;
  payload: unknown;
  docVersion: number | null;
  createdAt: number;
}

export interface CustomPartSummary {
  id: string;
  partNumber: string;
  displayName: string;
  ownerUserId: string | null;
  ownerOrgId: string | null;
  spriteMime: 'image/gif' | 'image/png';
  createdAt: number;
  updatedAt: number;
}

export interface ModuleSummary {
  id: string;
  title: string;
  ownerUserId: string | null;
  ownerOrgId: string | null;
  docVersion: number;
  hasSidecar: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  myRole: 'admin' | 'member';
}

export interface OrgDetail extends OrgSummary {}

export interface OrgMemberSummary {
  userId: string;
  role: 'admin' | 'member';
  joinedAt: number;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface OrgInviteSummary {
  id: string;
  invitedEmail: string;
  role: 'admin' | 'member';
  expiresAt: number;
}

export interface CollaboratorSummary {
  userId: string;
  role: 'viewer' | 'editor' | 'owner';
  addedAt: number;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface InviteSummary {
  id: string;
  invitedEmail: string;
  role: 'viewer' | 'editor';
  expiresAt: number;
}

export interface RemotePackage {
  name: string;
  version: string;
  fileName: string;
  sourceUrl: string;
}

export interface PartLibrary {
  id: string;
  name: string;
  slug: string;
  sourceUrl: string | null;
  diskPath: string;
  partCount: number;
  defaultEnabled: boolean;
  locked: boolean;
  installedAt: number;
  updatedAt: number;
}

export interface OrgPartLibrary {
  id: string;
  name: string;
  slug: string;
  partCount: number;
  defaultEnabled: boolean;
  /** When true, org admins cannot disable this library — always enabled for everyone. */
  locked: boolean;
  /** Effective state for this org (includes defaultEnabled + override). */
  enabled: boolean;
  /** Whether the org has an explicit override row (never true for locked libraries). */
  explicitOverride: boolean;
}
