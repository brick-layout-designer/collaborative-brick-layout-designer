// Token scopes (sync P1b): layouts:create, parts:read and parts:write
// join layouts:read / layouts:write, then venues:read / venues:write; a
// write scope implies its read one.

import { describe, expect, it } from 'vitest';
import { API_SCOPES, hasScope, parseScopes } from './apiTokens.js';

describe('API token scopes', () => {
  it('parses space-separated scopes in canonical order, rejecting unknown ones', () => {
    expect(parseScopes('parts:write layouts:read parts:write')).toEqual(['layouts:read', 'parts:write']);
    expect(parseScopes('layouts:create')).toEqual(['layouts:create']);
    expect(parseScopes('parts:admin')).toBeNull();
    // Omitted: every scope.
    expect(parseScopes(undefined)).toEqual([...API_SCOPES]);
    expect(API_SCOPES).toEqual([
      'layouts:read',
      'layouts:write',
      'layouts:create',
      'parts:read',
      'parts:write',
      'venues:read',
      'venues:write',
      'account:prefs',
    ]);
  });

  it('a write scope implies its read scope, and nothing else implies another', () => {
    expect(hasScope(['layouts:write'], 'layouts:read')).toBe(true);
    expect(hasScope(['parts:write'], 'parts:read')).toBe(true);
    expect(hasScope(['venues:write'], 'venues:read')).toBe(true);
    expect(hasScope(['parts:read'], 'parts:write')).toBe(false);
    expect(hasScope(['venues:read'], 'venues:write')).toBe(false);
    expect(hasScope(['layouts:write'], 'venues:read')).toBe(false);
    expect(hasScope(['layouts:write'], 'layouts:create')).toBe(false);
    expect(hasScope(['layouts:create'], 'layouts:read')).toBe(false);
    expect(hasScope(['parts:write'], 'layouts:read')).toBe(false);
  });
});
