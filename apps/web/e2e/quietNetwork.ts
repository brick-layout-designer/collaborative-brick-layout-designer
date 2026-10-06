// Watch a browser for 4xx answers from the app's own server.
//
// The live site sits behind a WAF (CrowdSec) whose scenarios ban an IP
// after a burst of 404/403 answers. At a show a whole club shares one
// venue Wi-Fi address, so normal use must not produce them: the app
// checks what exists before it asks (the parts catalog, a list's
// hasCover/hasThumbnail flags) and answers "nothing here" with 200.
// README "Operations: the 4xx profile" lists what still may 4xx.
//
// Use: `const net = watch4xx(context)`, mark stages with `net.stage('…')`,
// then `net.expectQuiet()` at the end of the journey.

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

export interface Hit {
  stage: string;
  status: number;
  method: string;
  path: string;
}

export interface Watch4xx {
  hits: Hit[];
  /** Name what the journey does next; hits are filed under it. */
  stage: (name: string) => void;
  /** Fail when anything 4xx'd, except paths `allow` matches (deliberate negative steps). */
  expectQuiet: (allow?: readonly RegExp[]) => void;
}

/** Record every 4xx the browser `target` gets from the app (pages it opens later too). */
export function watch4xx(target: BrowserContext | Page): Watch4xx {
  const ctx = 'context' in target ? target.context() : target;
  const host = new URL(test.info().project.use.baseURL ?? 'http://localhost:5173').host;
  const hits: Hit[] = [];
  let stage = 'start';
  ctx.on('response', (res) => {
    const status = res.status();
    if (status < 400 || status >= 500) return;
    const url = new URL(res.url());
    // Only the app's own origin: what the WAF in front of it sees.
    // Not Vite's own dev-server files (/@fs/, /@vite/): no WAF sees those.
    if (url.host !== host || url.pathname.startsWith('/@')) return;
    hits.push({ stage, status, method: res.request().method(), path: url.pathname + url.search });
  });
  return {
    hits,
    stage: (name) => {
      stage = name;
    },
    expectQuiet: (allow = []) => {
      const left = hits.filter((h) => !allow.some((re) => re.test(h.path)));
      // QUIET_4XX_MEASURE=1: list them instead of failing (for counting).
      if (process.env.QUIET_4XX_MEASURE) {
        const counts = new Map<string, number>();
        for (const h of left) {
          const k = `[${h.stage}] ${h.status} ${h.method} ${h.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')}`;
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        console.log(`4XX ${test.info().title}: ${left.length}\n${[...counts].map(([k, n]) => `  ${n} × ${k}`).join('\n')}`);
        return;
      }
      expect(left, `4xx answers during the journey:\n${left.map((h) => `  [${h.stage}] ${h.status} ${h.method} ${h.path}`).join('\n')}`).toEqual([]);
    },
  };
}
