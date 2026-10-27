// The club's roles, for its Manage page: each role with how many members
// hold it, an editor with grouped tick boxes (admins), and the chips that
// give and take roles on the Members list. Every change is checked again on
// the server (access/clubPermissions.ts) and reaches open layouts at once.

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ClubRoleSummary } from '../api';
import { HelpButton } from '../help/HelpButton';
import { askConfirm } from '../ui/ConfirmDialog';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, permissionLabel, type ClubPermission } from './clubPermissions';
import { Section } from './ClubManage';

const btn = 'tap-target inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-soft disabled:opacity-50';
const primary = 'tap-target inline-flex items-center justify-center rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50';
const field = 'min-h-11 w-full rounded-lg border border-border bg-soft px-3 py-2 text-ink';

const HINT_KEY = 'cld.clubRolesHintSeen';

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function markHintSeen(): void {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* private window: the hint shows again next time */
  }
}

/** What a role allows, in a few words: "Edit club layouts, Add parts" or "Everything". */
function summary(r: ClubRoleSummary): string {
  if (r.key === 'admin' || r.permissions.length === ALL_PERMISSIONS.length) return 'Everything, including the club’s settings';
  const shown = r.permissions.filter((p) => p !== 'view_items');
  return shown.length ? shown.map(permissionLabel).join(', ') : 'Only looks at the club’s things';
}

/** The first time an admin opens Roles: what roles are, in two lines. */
function FirstTimeHint() {
  const [open, setOpen] = useState(() => !hintSeen());
  if (!open) return null;
  return (
    <div role="note" className="flex flex-col gap-2 rounded-lg border border-accent bg-accent-soft p-3 text-sm sm:flex-row sm:items-start sm:justify-between" data-testid="roles-hint">
      <p>
        <span className="font-semibold">Roles decide what people can do in the club.</span> Give someone more than one role and they can do everything
        those roles allow. A layout or module shared with someone still works on top of their roles.
      </p>
      <button
        type="button"
        className={btn}
        onClick={() => {
          markHintSeen();
          setOpen(false);
        }}
      >
        Got it
      </button>
    </div>
  );
}

/** The tick boxes for one role, grouped, each with its ⓘ help. */
function PermissionBoxes({ value, onChange, disabled }: { value: ClubPermission[]; onChange: (v: ClubPermission[]) => void; disabled?: boolean }) {
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        What people with this role can do
        <HelpButton helpKey="club.permissions" />
      </p>
      {PERMISSION_GROUPS.map((g) => (
        <fieldset key={g.title} className="space-y-1">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</legend>
          {g.permissions.map((p) => {
            const base = p.value === 'view_items';
            return (
              <label key={p.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-soft">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0"
                  checked={base || value.includes(p.value)}
                  disabled={disabled || base}
                  onChange={(e) => onChange(e.target.checked ? [...value, p.value] : value.filter((x) => x !== p.value))}
                />
                <span className="min-w-0 text-sm">
                  <span className="block font-medium">
                    {p.label}
                    {base && <span className="ml-1 text-xs font-normal text-muted">(everyone)</span>}
                  </span>
                  <span className="block text-xs text-muted">{p.help}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

function RoleEditor({
  slug,
  role,
  onDone,
}: {
  slug: string;
  /** null: a new role. */
  role: ClubRoleSummary | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(role?.name ?? '');
  const [perms, setPerms] = useState<ClubPermission[]>(role?.permissions ?? ['view_items']);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      if (role) await api.orgs.updateRole(slug, role.id, { name: name.trim(), permissions: perms });
      else await api.orgs.createRole(slug, name.trim(), perms);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org-roles', slug] });
      void qc.invalidateQueries({ queryKey: ['org-members', slug] });
      void qc.invalidateQueries({ queryKey: ['org', slug] });
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-soft/40 p-3" aria-label={role ? `Edit ${role.name}` : 'New role'}>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Role name</span>
        <input className={field} value={name} maxLength={40} required onChange={(e) => setName(e.target.value)} placeholder="For example: Track crew" />
      </label>
      <PermissionBoxes value={perms} onChange={setPerms} />
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primary} disabled={save.isPending || !name.trim()}>
          {role ? 'Save role' : 'Add role'}
        </button>
        <button type="button" className={btn} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Settings › Roles: every role, how many hold it, and (admins) the editor. */
export function RolesSection({ slug, isAdmin }: { slug: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['org-roles', slug], queryFn: () => api.orgs.roles(slug) });
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.orgs.deleteRole(slug, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org-roles', slug] });
      void qc.invalidateQueries({ queryKey: ['org-members', slug] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const list = roles.data?.roles ?? [];
  return (
    <Section title="Roles" help="club.roles" hint={isAdmin ? 'What each role lets people do. Give roles on the People tab.' : 'What each role lets people do. Only club admins change roles.'}>
      {isAdmin && <FirstTimeHint />}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {roles.isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Club roles">
          {list.map((r) => (
            <li key={r.id} className="space-y-2 px-3 py-3 text-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-semibold">
                    {r.name}
                    <span className="ml-2 text-xs font-normal text-muted">
                      {r.memberCount === 1 ? '1 member' : `${r.memberCount} members`}
                    </span>
                  </p>
                  <p className="text-xs text-muted">{summary(r)}</p>
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {r.key === 'admin' ? (
                      <span className="text-xs text-muted">Always has every permission</span>
                    ) : (
                      <button type="button" className={btn} onClick={() => setEditing(editing === r.id ? null : r.id)} aria-expanded={editing === r.id}>
                        Edit
                      </button>
                    )}
                    {!r.key && (
                      <button
                        type="button"
                        className={btn}
                        disabled={r.memberCount > 0 || remove.isPending}
                        title={r.memberCount > 0 ? 'Take this role from its members first.' : undefined}
                        onClick={async () => {
                          setError(null);
                          const ok = await askConfirm({
                            title: `Delete the ${r.name} role?`,
                            removes: 'The role goes. Nobody holds it now, and invites to it give the Member role instead.',
                            keeps: 'Everyone keeps their other roles.',
                            confirmLabel: 'Delete role',
                          });
                          if (ok) remove.mutate(r.id);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
              {isAdmin && !r.key && r.memberCount > 0 && <p className="text-xs text-muted">To delete it, take it from its members first.</p>}
              {editing === r.id && <RoleEditor slug={slug} role={r} onDone={() => setEditing(null)} />}
            </li>
          ))}
        </ul>
      )}
      {isAdmin &&
        (editing === 'new' ? (
          <RoleEditor slug={slug} role={null} onDone={() => setEditing(null)} />
        ) : (
          <button type="button" className={primary} onClick={() => setEditing('new')}>
            New role
          </button>
        ))}
    </Section>
  );
}

/**
 * A member's roles as chips. People who manage members tap a chip to give
 * or take that role; a member always keeps at least one.
 */
export function MemberRoleChips({
  slug,
  userId,
  name,
  held,
  roles,
  canChange,
  mayToggle,
  onError,
}: {
  slug: string;
  userId: string;
  name: string;
  held: string[];
  roles: ClubRoleSummary[];
  canChange: boolean;
  /** Whether this viewer may give or take this role (only admins give Admin). */
  mayToggle: (r: ClubRoleSummary) => boolean;
  onError: (msg: string | null) => void;
}) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (roleIds: string[]) => api.orgs.setMemberRoles(slug, userId, roleIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org-members', slug] });
      void qc.invalidateQueries({ queryKey: ['org-roles', slug] });
      void qc.invalidateQueries({ queryKey: ['org', slug] });
      // Your clubs list names the roles you hold.
      void qc.invalidateQueries({ queryKey: ['orgs'] });
    },
    onError: (e: Error) => onError(e.message),
  });
  const shown = canChange ? roles : roles.filter((r) => held.includes(r.id));
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Roles for ${name}`}>
      {shown.map((r) => {
        const on = held.includes(r.id);
        if (!canChange) {
          return (
            <span key={r.id} className="rounded-full bg-soft px-2.5 py-1 text-xs font-semibold text-muted">
              {r.name}
            </span>
          );
        }
        const last = on && held.length === 1;
        const allowed = mayToggle(r) && !last;
        return (
          <button
            key={r.id}
            type="button"
            aria-pressed={on}
            disabled={!allowed || set.isPending}
            title={last ? 'Everyone keeps at least one role.' : !mayToggle(r) ? 'Only club admins give or take this role.' : undefined}
            onClick={() => {
              onError(null);
              set.mutate(on ? held.filter((id) => id !== r.id) : [...held, r.id]);
            }}
            className={`tap-target inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-60 ${
              on ? 'border-accent bg-accent text-accent-ink' : 'border-border bg-panel text-muted hover:bg-soft'
            }`}
          >
            {on ? '✓ ' : '+ '}
            {r.name}
          </button>
        );
      })}
    </div>
  );
}
