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
};
