// SSRF-hardened outbound HTTPS fetch for admin-supplied URLs (part
// library downloads / index pages).
//
// The previous check pattern-matched the URL's hostname only, so any DNS
// name pointing at an internal address, IPv4-mapped IPv6 literals
// (`[::ffff:127.0.0.1]`), decimal/hex IPv4 forms, and redirects to
// internal hosts all got through. Here:
//   - only https:// URLs are allowed;
//   - every address the hostname resolves to is checked, inside the
//     socket's own DNS lookup, so the address that is validated is the
//     address that is connected to (no DNS-rebinding window). IP-literal
//     hosts (which skip DNS) are checked up front;
//   - redirects are followed manually (max 5) and each hop is re-validated;
//   - the body is streamed with a byte cap instead of buffered unbounded.

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

export class UnsafeUrlError extends Error {}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['64:ff9b::', 96], // NAT64 — reaches arbitrary IPv4 space
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** The embedded IPv4 address of an IPv4-mapped IPv6 address, if any. */
function unmapIpv4(addr: string): string | null {
  const lower = addr.toLowerCase();
  const dotted = /^(?:0{0,4}:){0,4}:?:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1]!;
  const hex = /^(?:0{0,4}:){0,4}:?:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return null;
}

/** True when `addr` (an IP literal) is a publicly routable unicast address. */
export function isPublicAddress(addr: string): boolean {
  const family = isIP(addr);
  if (family === 4) return !blocked.check(addr, 'ipv4');
  if (family === 6) {
    const v4 = unmapIpv4(addr);
    if (v4 !== null) return isIP(v4) === 4 && !blocked.check(v4, 'ipv4');
    return !blocked.check(addr, 'ipv6');
  }
  return false;
}

const PRIVATE_MSG = 'URL resolves to a private network address';

/** A `lookup` for net/tls sockets that refuses non-public addresses. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      return callback(new UnsafeUrlError(PRIVATE_MSG), '', 0);
    }
    if (options.all) {
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0]!.address, list[0]!.family);
    }
  });
};

function validateUrl(raw: string | URL): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeUrlError('invalid URL');
  }
  if (parsed.protocol !== 'https:') throw new UnsafeUrlError('only https:// URLs are allowed');
  if (parsed.username || parsed.password) throw new UnsafeUrlError('credentials in URL are not allowed');
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  // IP literals never go through DNS (and so never through guardedLookup).
  if (isIP(host) && !isPublicAddress(host)) throw new UnsafeUrlError(PRIVATE_MSG);
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) {
    throw new UnsafeUrlError(PRIVATE_MSG);
  }
  return parsed;
}

export interface SafeFetchInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Reject once the response body exceeds this many bytes. */
  maxBytes?: number;
}

const MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

interface RawResponse {
  status: number;
  statusText: string;
  headers: Headers;
  location: string | null;
  body: Buffer | null;
}

function getOnce(url: URL, init: SafeFetchInit, maxBytes: number): Promise<RawResponse> {
  return new Promise((resolvePromise, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        headers: init.headers ?? {},
        lookup: guardedLookup,
        ...(init.signal ? { signal: init.signal } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined) continue;
          headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        }
        const location = status >= 300 && status < 400 ? (res.headers.location ?? null) : null;
        if (location !== null) {
          res.resume();
          resolvePromise({ status, statusText: res.statusMessage ?? '', headers, location, body: null });
          return;
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          reject(new Error(`response exceeds ${maxBytes} bytes`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > maxBytes) {
            res.destroy(new Error(`response exceeds ${maxBytes} bytes`));
            return;
          }
          chunks.push(c);
        });
        res.on('error', reject);
        res.on('end', () =>
          resolvePromise({
            status,
            statusText: res.statusMessage ?? '',
            headers,
            location: null,
            body: Buffer.concat(chunks as unknown as Uint8Array<ArrayBuffer>[]),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Fetch an admin-supplied https URL, refusing anything that resolves to a
 * private / loopback / link-local address at any redirect hop. Resolves
 * to a fully-buffered `Response` (capped at `maxBytes`, default 100 MiB).
 */
export async function safeFetch(raw: string, init: SafeFetchInit = {}): Promise<Response> {
  const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES;
  let url = validateUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await getOnce(url, init, maxBytes);
    if (res.location === null) {
      const nullBody = res.status === 204 || res.status === 304 || res.status < 200;
      return new Response(nullBody ? null : new Uint8Array(res.body ?? Buffer.alloc(0)), {
        status: res.status < 200 ? 502 : res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
    url = validateUrl(new URL(res.location, url));
  }
  throw new Error('too many redirects');
}
