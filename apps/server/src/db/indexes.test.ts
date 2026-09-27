// Regression test: the lookup-by-user / by-owner / audit-read indexes
// exist after migrating, and the hot queries actually use them.

import { describe, expect, it } from 'vitest';
import { sqlite } from './index.js';

const EXPECTED = [
  'sessions_user_id_idx',
  'org_members_user_id_idx',
  'layout_collaborators_user_id_idx',
  'custom_part_collaborators_user_id_idx',
  'module_collaborators_user_id_idx',
  'custom_parts_owner_user_id_idx',
  'custom_parts_owner_org_id_idx',
  'modules_owner_user_id_idx',
  'modules_owner_org_id_idx',
  'audit_events_layout_id_created_at_idx',
  'audit_events_resource_created_at_idx',
  'api_tokens_user_id_idx',
  'device_codes_expires_at_idx',
];

function plan(sql: string): string {
  const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>;
  return rows.map((r) => r.detail).join('\n');
}

describe('schema indexes', () => {
  it('creates every lookup index', () => {
    const names = (
      sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as Array<{ name: string }>
    ).map((r) => r.name);
    for (const idx of EXPECTED) expect(names).toContain(idx);
  });

  it('uses them for the per-user and audit queries', () => {
    expect(plan(`SELECT * FROM layout_collaborators WHERE user_id = 'u'`)).toContain('layout_collaborators_user_id_idx');
    expect(plan(`SELECT * FROM org_members WHERE user_id = 'u'`)).toContain('org_members_user_id_idx');
    expect(plan(`SELECT id FROM sessions WHERE user_id = 'u'`)).toContain('sessions_user_id_idx');
    expect(
      plan(`SELECT * FROM audit_events WHERE resource_kind = 'module' AND resource_id = 'm' ORDER BY created_at DESC`),
    ).toContain('audit_events_resource_created_at_idx');
  });
});
