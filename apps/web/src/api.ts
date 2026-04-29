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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: 'POST', credentials: 'include' };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface LayoutSummary {
  id: string;
  title: string;
  ownerUserId: string | null;
  ownerOrgId: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
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
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const res = await fetch(path, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
}

export interface ConnectionPointWire {
  type: string;
  x: number;
  y: number;
  angle: number;
  electricPlug: number;
}

export interface PartWire {
  key: string;
  partNumber: string;
  colorCode: string;
  kind: 'leaf' | 'group';
  description: string;
  sortingKey: string;
  spritePath: string;
  pxPerStud: number;
  connections: ConnectionPointWire[];
}

async function getBytes(path: string): Promise<{ bytes: Uint8Array; docVersion: number }> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
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
    body: bytes,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
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
    snapshot: (id: string) => getBytes(`/api/layouts/${id}/snapshot`),
    saveSnapshot: (id: string, bytes: Uint8Array) =>
      putBytes(`/api/layouts/${id}/snapshot`, bytes),
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
    create: (name: string, slug: string) =>
      post<{ id: string; name: string; slug: string }>('/api/orgs', { name, slug }),
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
    rename: (id: string, title: string) =>
      patch<{ ok: true }>(`/api/modules/${id}`, { title }),
    remove: (id: string) => del(`/api/modules/${id}`),
    invite: (id: string, email: string, role: 'viewer' | 'editor') =>
      post<{ added: true }>(`/api/modules/${id}/invites`, { email, role }),
  },
};

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
