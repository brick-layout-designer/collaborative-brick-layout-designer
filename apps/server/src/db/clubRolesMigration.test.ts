// Migration 0035 (club roles): on a realistic database at 0034 (clubs that
// let members add things and clubs that don't, admins, managers and
// members, a pending invite), every club gets Admin, Manager, Member and
// Viewer, every member holds the role matching their old one, and what
// each person may do is what the old fixed roles allowed.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { builtinAccess, clubThingAccess, defaultPermissions, lesserRole, type BuiltinRoleKey } from '../access/clubPermissions.js';
import { atLeast, clubThingRole, type ClubRole } from '../access/clubRoles.js';
import { clubModuleRole } from '../access/resolveResourceRole.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function migrationsUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cld-mig-'));
  dirs.push(dir);
  cpSync('migrations', dir, { recursive: true });
  const journalPath = join(dir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const end = journal.entries.findIndex((e) => e.tag === lastTag);
  expect(end).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, end + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migration 0035_club_roles', () => {
  it('gives every club the four roles and every member the role they had', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cld-mig-db-'));
    dirs.push(dir);
    const sqlite = new Database(join(dir, 'db.sqlite'));
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: migrationsUpTo('0034_module_invites') });

    const now = Date.now();
    const users = ['ann', 'bob', 'cat', 'dan', 'eve'];
    for (const u of users) {
      sqlite.prepare('INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)').run(u, `${u}@x.com`, u, now);
    }
    sqlite.prepare('INSERT INTO orgs (id, name, slug, created_at, members_can_create) VALUES (?, ?, ?, ?, ?)').run('open', 'Open club', 'open', now, 1);
    sqlite.prepare('INSERT INTO orgs (id, name, slug, created_at, members_can_create) VALUES (?, ?, ?, ?, ?)').run('shut', 'Admins add', 'shut', now, 0);
    const member = sqlite.prepare('INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)');
    member.run('open', 'ann', 'admin', now);
    member.run('open', 'bob', 'manager', now);
    member.run('open', 'cat', 'member', now);
    member.run('shut', 'dan', 'admin', now);
    member.run('shut', 'eve', 'member', now);
    member.run('shut', 'cat', 'manager', now);
    sqlite
      .prepare('INSERT INTO org_invites (id, org_id, invited_email, invited_by, role, token, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('inv', 'open', 'new@x.com', 'ann', 'member', 'tok', now + 86_400_000);

    migrate(db, { migrationsFolder: 'migrations' });

    const roles = sqlite.prepare('SELECT id, org_id, key, name, permissions FROM club_roles ORDER BY org_id, position').all() as {
      id: string;
      org_id: string;
      key: BuiltinRoleKey;
      name: string;
      permissions: string;
    }[];
    expect(roles.map((r) => `${r.org_id}:${r.key}:${r.name}`)).toEqual([
      'open:admin:Admin',
      'open:manager:Manager',
      'open:member:Member',
      'open:viewer:Viewer',
      'shut:admin:Admin',
      'shut:manager:Manager',
      'shut:member:Member',
      'shut:viewer:Viewer',
    ]);
    // The stored permissions are the code's starting ones, Member following "members can add things".
    for (const r of roles) expect(JSON.parse(r.permissions), r.id).toEqual(defaultPermissions(r.key, r.org_id === 'open'));

    const held = sqlite.prepare('SELECT org_id, user_id, role_id FROM member_roles ORDER BY org_id, user_id').all();
    expect(held).toEqual([
      { org_id: 'open', user_id: 'ann', role_id: 'open:admin' },
      { org_id: 'open', user_id: 'bob', role_id: 'open:manager' },
      { org_id: 'open', user_id: 'cat', role_id: 'open:member' },
      { org_id: 'shut', user_id: 'cat', role_id: 'shut:manager' },
      { org_id: 'shut', user_id: 'dan', role_id: 'shut:admin' },
      { org_id: 'shut', user_id: 'eve', role_id: 'shut:member' },
    ]);
    // Nothing removed: the old column and the invite are as they were.
    expect(sqlite.prepare('SELECT count(*) AS n FROM org_members').get()).toEqual({ n: 6 });
    expect(sqlite.prepare('SELECT role, role_id FROM org_invites').get()).toEqual({ role: 'member', role_id: null });
    // Leaving a club takes its role rows with it.
    sqlite.prepare("DELETE FROM org_members WHERE org_id = 'open' AND user_id = 'cat'").run();
    expect(sqlite.prepare("SELECT count(*) AS n FROM member_roles WHERE user_id = 'cat'").get()).toEqual({ n: 1 });
    sqlite.close();
  });
});

describe('the starting roles give what the old fixed roles gave', () => {
  const OLD: ClubRole[] = ['admin', 'manager', 'member'];
  // Each check the routes made before, by role, against the permission they ask now.
  const oldRules: { what: string; old: (r: ClubRole, mcc: boolean) => unknown; now: (a: ReturnType<typeof builtinAccess>) => unknown }[] = [
    { what: 'role on a club layout', old: (r) => clubThingRole(r), now: (a) => clubThingAccess(a, 'layout') },
    { what: 'role on a club part', old: (r) => clubThingRole(r), now: (a) => clubThingAccess(a, 'custom_part') },
    { what: 'role on a club module', old: (r, mcc) => clubModuleRole(r, mcc), now: (a) => clubThingAccess(a, 'module') },
    { what: 'add a layout, venue or collection', old: (r, mcc) => mcc || atLeast(r, 'manager'), now: (a) => a.permissions.has('start_layouts') },
    { what: 'add a module', old: (r, mcc) => mcc || atLeast(r, 'manager'), now: (a) => a.permissions.has('edit_modules') },
    { what: 'change or delete a club venue', old: (r) => atLeast(r, 'manager'), now: (a) => a.permissions.has('manage_venues') },
    { what: 'invite, answer requests, see activity, warn', old: (r) => atLeast(r, 'manager'), now: (a) => a.permissions.has('invite') || a.permissions.has('manage_members') },
    { what: 'share to the catalog, review a trusted club', old: (r) => atLeast(r, 'manager'), now: (a) => a.permissions.has('send_catalog') },
    { what: 'give a thing back to its author', old: (r) => atLeast(r, 'manager'), now: (a) => a.permissions.has('delete_items') },
    { what: 'change roles', old: (r) => r === 'admin', now: (a) => a.permissions.has('manage_members') },
    { what: "download the club's data", old: (r) => r === 'admin', now: (a) => a.permissions.has('export_data') },
    { what: 'club settings, deleting, handing over', old: (r) => r === 'admin', now: (a) => a.isAdmin },
  ];

  for (const mcc of [true, false]) {
    for (const rule of oldRules) {
      it(`${rule.what} (${mcc ? 'members add things' : 'only admins add things'})`, () => {
        for (const r of OLD) expect(rule.now(builtinAccess(r, mcc)), r).toEqual(rule.old(r, mcc));
      });
    }
  }

  it('who may remove, warn or invite whom', () => {
    // Before: admins act on anyone but (for warnings) admins; managers on members only.
    const old = (by: ClubRole, target: ClubRole) => by === 'admin' || (by === 'manager' && target === 'member');
    for (const mcc of [true, false]) {
      for (const by of OLD) {
        for (const target of OLD) {
          const a = builtinAccess(by, mcc);
          const t = builtinAccess(target, mcc);
          const now = a.permissions.has('manage_members') || (a.permissions.has('invite') && lesserRole(t.permissions, a.permissions));
          expect(now, `${by} on ${target}`).toBe(old(by, target));
        }
      }
    }
  });
});
