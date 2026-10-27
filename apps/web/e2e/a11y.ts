// Accessibility checks with axe (WCAG 2.1 A and AA): what a page, or the
// dialog on top of it, gets wrong for people using a screen reader, the
// keyboard only, or who need more contrast. The editor's map is a picture
// drawn on a canvas, so it's left out.

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export interface AxeOptions {
  /** Only this part of the page (a CSS selector), e.g. the open dialog. */
  include?: string;
  /** Parts to leave out, besides the map's canvas. */
  exclude?: string[];
}

/** Each problem axe finds, as "rule: what's wrong — where". */
export async function axeProblems(page: Page, opts: AxeOptions = {}): Promise<string[]> {
  let axe = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (opts.include) axe = axe.include(opts.include);
  for (const sel of ['.konvajs-content', ...(opts.exclude ?? [])]) axe = axe.exclude(sel);
  const { violations } = await axe.analyze();
  return violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${v.help} — ${n.target.join(' ')}${n.failureSummary ? ` (${n.failureSummary.split('\n').slice(1, 2).join('').trim()})` : ''}`),
  );
}

/** Fails with the list of problems if axe finds any. */
export async function expectAccessible(page: Page, what: string, opts: AxeOptions = {}): Promise<void> {
  expect(await axeProblems(page, opts), `${what}: accessibility problems`).toEqual([]);
}
