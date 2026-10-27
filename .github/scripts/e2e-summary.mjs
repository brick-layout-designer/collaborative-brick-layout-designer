// Turns the merged Playwright JSON report of the nightly shards into one
// Markdown summary: the totals, which shards reported, and every failed and
// flaky test with its first error line. Written for $GITHUB_STEP_SUMMARY.
//
//   node e2e-summary.mjs <report.json> <blob dir> <shard count>

import { readFileSync, readdirSync } from 'node:fs';

const [reportPath, blobDir, shardCountArg] = process.argv.slice(2);
const shardCount = Number(shardCountArg);

const blobs = (() => {
  try {
    return readdirSync(blobDir).filter((f) => f.endsWith('.zip'));
  } catch {
    return [];
  }
})();
// Blob files are named report-<i>.zip by the blob reporter's shard suffix.
const reported = new Set(
  blobs.map((f) => Number(/(\d+)\.zip$/.exec(f)?.[1])).filter((n) => Number.isFinite(n)),
);
const missing = [];
for (let i = 1; i <= shardCount; i++) if (!reported.has(i)) missing.push(i);

let report = null;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch {
  /* no shard reported */
}

const out = [];
out.push('## Every e2e spec');
out.push('');
out.push(
  `Shards reported: **${reported.size} of ${shardCount}**` +
    (missing.length ? ` (no report from shard ${missing.join(', ')})` : ''),
);

if (report) {
  const failed = [];
  const flaky = [];
  const walk = (suite, trail) => {
    const here = suite.title && !suite.title.endsWith('.ts') ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status !== 'unexpected' && t.status !== 'flaky') continue;
        const err = t.results?.find((r) => r.error)?.error?.message ?? '';
        const line = err
          .replace(/\u001b\[[0-9;]*m/g, '')
          .split('\n')
          .map((s) => s.trim())
          .find(Boolean);
        const row = {
          where: `${spec.file}:${spec.line}`,
          title: [...here, spec.title].join(' › '),
          error: line ?? '',
        };
        (t.status === 'flaky' ? flaky : failed).push(row);
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const s of report.suites ?? []) walk(s, []);

  const st = report.stats ?? {};
  out.push('');
  out.push(
    `Passed **${st.expected ?? 0}**, failed **${st.unexpected ?? 0}**, ` +
      `flaky **${st.flaky ?? 0}**, skipped **${st.skipped ?? 0}**.`,
  );
  const table = (title, rows) => {
    if (!rows.length) return;
    out.push('');
    out.push(`### ${title} (${rows.length})`);
    out.push('');
    out.push('| Test | Where | First error line |');
    out.push('|---|---|---|');
    const esc = (s) => s.replace(/\|/g, '\\|').slice(0, 200);
    for (const r of rows) out.push(`| ${esc(r.title)} | \`${r.where}\` | ${esc(r.error)} |`);
  };
  table('Failed', failed);
  table('Flaky (failed, then passed on the retry)', flaky);
} else {
  out.push('');
  out.push('No shard left a report.');
}

process.stdout.write(out.join('\n') + '\n');
