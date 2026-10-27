// Splits the e2e specs into shards of about the same running time, for the
// nightly run of every spec (journeys.yml).
//
// Playwright's own --shard=i/n splits by the number of tests, in file order.
// Ours vary from a second to a minute each, so its shards came out between
// 0 and 19 minutes. This packs whole spec files instead, by how long each
// took last time (longest first, each into the shard with the least so far),
// and picks the number of shards so each runs about TARGET minutes.
//
//   node e2e-shards.mjs plan <e2e dir> <timings.json> [target minutes] [max shards]
//     → {"count": n, "matrix": [{"shard": 1, "files": "e2e/test/a.spec.ts …", "minutes": 9.8}, …]}
//   node e2e-shards.mjs timings <merged Playwright JSON report>
//     → {"test/a.spec.ts": <ms>, …}, keyed by the path under the e2e dir
//
// A spec with no timing yet (a new one) counts as NEW_SPEC_MS; the timings
// the nightly writes after each run correct it from then on.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const NEW_SPEC_MS = 60_000;

function specFiles(dir, root = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...specFiles(p, root));
    else if (/\.spec\.[cm]?[jt]sx?$/.test(name)) out.push(relative(root, p).split('\\').join('/'));
  }
  return out.sort();
}

function plan(e2eDir, timingsPath, target = 12, max = 12) {
  let timings = {};
  try {
    timings = JSON.parse(readFileSync(timingsPath, 'utf8'));
  } catch {
    /* none yet: every spec counts as new */
  }
  const files = specFiles(e2eDir).map((f) => ({ f, ms: timings[f] ?? NEW_SPEC_MS }));
  const total = files.reduce((a, x) => a + x.ms, 0);
  const count = Math.max(1, Math.min(max, Math.ceil(total / (target * 60_000))));
  const shards = Array.from({ length: count }, () => ({ ms: 0, files: [] }));
  for (const x of [...files].sort((a, b) => b.ms - a.ms || (a.f < b.f ? -1 : 1))) {
    const least = shards.reduce((a, b) => (b.ms < a.ms ? b : a));
    least.ms += x.ms;
    least.files.push(x.f);
  }
  const prefix = relative(join(e2eDir, '..'), e2eDir).split('\\').join('/');
  return {
    count,
    matrix: shards.map((s, i) => ({
      shard: i + 1,
      // In file order within the shard, as a full run would take them.
      files: s.files.sort().map((f) => `${prefix}/${f}`).join(' '),
      minutes: Math.round(s.ms / 6000) / 10,
    })),
  };
}

function timingsOf(reportPath) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const out = {};
  const sum = (suite) => {
    let ms = 0;
    for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) for (const r of t.results ?? []) ms += r.duration ?? 0;
    for (const child of suite.suites ?? []) ms += sum(child);
    return ms;
  };
  // A top-level suite is one spec file, even when its tests live in a
  // module it imports (mobileRoutes.ts).
  for (const suite of report.suites ?? []) out[suite.file] = (out[suite.file] ?? 0) + Math.round(sum(suite));
  return out;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'plan') {
  const [dir, timings, target, max] = args;
  process.stdout.write(JSON.stringify(plan(dir, timings, Number(target) || undefined, Number(max) || undefined)));
} else if (cmd === 'timings') {
  process.stdout.write(JSON.stringify(timingsOf(args[0]), null, 1) + '\n');
} else {
  console.error('usage: e2e-shards.mjs plan <e2e dir> <timings.json> [target min] [max shards] | timings <report.json>');
  process.exit(2);
}
