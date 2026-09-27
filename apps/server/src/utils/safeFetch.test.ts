// Regression tests for the SSRF guard on admin-supplied download URLs.

import { describe, expect, it } from 'vitest';
import { guardedLookup, isPublicAddress, safeFetch, UnsafeUrlError } from './safeFetch.js';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::a00:1',
  ])('rejects %s', (addr) => {
    expect(isPublicAddress(addr)).toBe(false);
  });

  it.each(['1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('accepts %s', (addr) => {
    expect(isPublicAddress(addr)).toBe(true);
  });
});

describe('safeFetch', () => {
  it.each([
    'http://example.com/x.zip',
    'https://127.0.0.1/x.zip',
    'https://[::1]/x.zip',
    'https://[::ffff:127.0.0.1]/x.zip',
    'https://[::ffff:7f00:1]/x.zip',
    'https://2130706433/x.zip', // decimal 127.0.0.1
    'https://0x7f.1/x.zip',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/x.zip',
  ])('refuses %s without connecting', async (url) => {
    await expect(safeFetch(url)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses hostnames whose DNS answer is private (checked in the socket lookup)', async () => {
    const err = await new Promise<Error | null>((resolve) => {
      guardedLookup('localhost', { all: true }, (e) => resolve(e));
    });
    expect(err).toBeInstanceOf(UnsafeUrlError);
  });
});
