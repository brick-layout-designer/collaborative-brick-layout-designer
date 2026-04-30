import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb, schema } from '../test/helpers.js';
import { linkProvider, listLinkedProviders, resolveOauthUser } from './users.js';
import type { NormalisedProfile } from './providers.js';

const baseProfile = (overrides: Partial<NormalisedProfile> = {}): NormalisedProfile => ({
  providerUserId: 'google-123',
  email: 'alice@example.com',
  displayName: 'Alice',
  avatarUrl: null,
  ...overrides,
});

describe('resolveOauthUser', () => {
  beforeEach(() => resetDb());

  it('creates a new user and links the provider when nothing matches', async () => {
    const result = await resolveOauthUser('google', baseProfile());

    expect(result.linkPrompt).toBe(false);
    expect(result.user.email).toBe('alice@example.com');

    const accounts = await db.select().from(schema.oauthAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.provider).toBe('google');
    expect(accounts[0]?.providerUserId).toBe('google-123');
  });

  it('returns the existing user when (provider, providerUserId) is already linked', async () => {
    const first = await resolveOauthUser('google', baseProfile());
    const second = await resolveOauthUser('google', baseProfile());

    expect(second.linkPrompt).toBe(false);
    expect(second.user.id).toBe(first.user.id);

    const accounts = await db.select().from(schema.oauthAccounts);
    expect(accounts).toHaveLength(1); // not duplicated
  });

  it('flags linkPrompt when a different provider returns a colliding email', async () => {
    // Pre-existing user via password registration (no oauth link yet).
    const existingId = randomUUID();
    await db.insert(schema.users).values({
      id: existingId,
      email: 'alice@example.com',
      displayName: 'Alice',
      avatarUrl: null,
      passwordHash: 'pretend-hash',
      isDemoAccount: false,
      isGlobalAdmin: false,
      createdAt: new Date(),
    });

    const result = await resolveOauthUser('github', baseProfile({ providerUserId: 'gh-7' }));

    // Critical: we surface linkPrompt instead of silently auto-linking; the
    // route layer is responsible for asking the user to confirm before we
    // attach the provider. Auto-linking would let a hostile OAuth provider
    // take over an account by claiming the same email.
    expect(result.linkPrompt).toBe(true);
    expect(result.user.id).toBe(existingId);

    const accounts = await db.select().from(schema.oauthAccounts);
    expect(accounts).toHaveLength(0);
  });
});

describe('linkProvider', () => {
  beforeEach(() => resetDb());

  it('links a provider to an existing user', async () => {
    const created = await resolveOauthUser('google', baseProfile());
    await linkProvider(created.user.id, 'github', 'gh-42');

    const linked = await listLinkedProviders(created.user.id);
    expect(linked.sort()).toEqual(['github', 'google']);
  });

  it('is idempotent on duplicate (provider, providerUserId)', async () => {
    const created = await resolveOauthUser('google', baseProfile());
    await linkProvider(created.user.id, 'github', 'gh-42');
    await linkProvider(created.user.id, 'github', 'gh-42');

    const accounts = await db.select().from(schema.oauthAccounts);
    expect(accounts).toHaveLength(2);
  });
});
