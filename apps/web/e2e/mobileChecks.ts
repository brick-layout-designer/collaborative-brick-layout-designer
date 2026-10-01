// Phone and tablet checks shared by the mobile specs: the devices to run
// on, what runs off the side of the screen, and controls too small for a
// finger.

import { devices, type Page } from '@playwright/test';

const { defaultBrowserType: _a, ...iPhone14 } = devices['iPhone 14'];
const { defaultBrowserType: _b, ...pixel7 } = devices['Pixel 7'];
const { defaultBrowserType: _c, ...iPadMini } = devices['iPad Mini'];
const { defaultBrowserType: _d, ...galaxyTab } = devices['Galaxy Tab S4'];
const size = (width: number, height: number) => ({ viewport: { width, height }, screen: { width, height } });
export const DEVICES = [
  { name: '360x740', use: { ...iPhone14, ...size(360, 740) } },
  { name: '360x740-landscape', use: { ...iPhone14, ...size(740, 360) } },
  { name: 'iphone14', use: iPhone14 },
  { name: 'iphone14-landscape', use: { ...iPhone14, ...size(844, 390) } },
  { name: 'pixel7', use: pixel7 },
  { name: 'pixel7-landscape', use: { ...pixel7, ...size(915, 412) } },
  // Tablets, by touch, upright and on their side.
  { name: 'tablet-ipad-mini', use: { ...iPadMini, ...size(768, 1024) } },
  { name: 'tablet-ipad-mini-landscape', use: { ...iPadMini, ...size(1024, 768) } },
  { name: 'tablet-ipad-air', use: { ...iPadMini, ...size(820, 1180) } },
  { name: 'tablet-ipad-air-landscape', use: { ...iPadMini, ...size(1180, 820) } },
  { name: 'tablet-ipad-pro-12', use: { ...iPadMini, ...size(1024, 1366) } },
  { name: 'tablet-ipad-pro-12-landscape', use: { ...iPadMini, ...size(1366, 1024) } },
  { name: 'tablet-android', use: { ...galaxyTab, ...size(800, 1280) } },
  { name: 'tablet-android-landscape', use: { ...galaxyTab, ...size(1280, 800) } },
  // iPad split view: the app beside another, about half the screen.
  { name: 'tablet-ipad-air-split', use: { ...iPadMini, ...size(590, 820) } },
];

/**
 * What runs off the right-hand side: a page (or a page-wide scroll area)
 * that scrolls sideways, and anything cut off by the screen edge or by a
 * box that clips it. A row that scrolls sideways on purpose says so with
 * `data-scroll-x`; text cut short with an ellipsis is fine.
 */
export function findOverflow(page: Page, scope = 'body'): Promise<string[]> {
  return page.evaluate((scope) => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    const describe = (el: Element) => {
      const text = (el.getAttribute('aria-label') ?? (el as HTMLElement).innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 3).join('.') : '';
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
    };
    const visible = (el: Element) => {
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;
    };
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
    const offending = new Set<Element>();
    for (const el of document.querySelector(scope)?.querySelectorAll('*') ?? []) {
      if (el.closest('canvas, svg *, [aria-hidden=true], [data-scroll-x] > *')) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1 || !visible(el)) continue;
      const cs = getComputedStyle(el);
      // A scroll area most of the screen wide that scrolls sideways.
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && !el.hasAttribute('data-scroll-x') &&
          r.width >= vw * 0.8 && el.scrollWidth > el.clientWidth + 1) {
        out.push(`${describe(el)} scrolls sideways (${el.scrollWidth} > ${el.clientWidth})`);
      }
      if (cs.position === 'fixed' && (r.left >= vw || r.right <= 0)) continue; // a drawer parked off screen
      if (cs.textOverflow === 'ellipsis') continue;
      // The nearest box that clips or scrolls it.
      let clipRight = vw;
      let clipWidth = vw;
      let scrolls = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'visible') continue;
        scrolls = ox === 'auto' || ox === 'scroll';
        clipRight = Math.min(p.getBoundingClientRect().right, vw);
        clipWidth = p.getBoundingClientRect().width;
        break;
      }
      if (scrolls || r.right <= clipRight + 1 || r.left >= clipRight) continue;
      // Inside a 1 px box kept for screen readers only.
      if (clipWidth <= 1) continue;
      offending.add(el);
    }
    // Report the outermost offender only.
    for (const el of offending) {
      if (el.parentElement && offending.has(el.parentElement)) continue;
      out.push(`${describe(el)} is cut off at the right (${Math.round(el.getBoundingClientRect().right)} px)`);
    }
    return out;
  }, scope);
}

/** Controls smaller than 44×44 px. */
export function findSmallTargets(page: Page, scope = 'body', min = 44): Promise<string[]> {
  return page.evaluate(([scope, min]) => {
    const sel = [
      'button', 'a[href]', '[role=button]', '[role=tab]', '[role=radio]', '[role=switch]',
      '[role=menuitem]', '[role=checkbox]', '[role=option]', 'select', 'summary',
      'input:not([type=hidden])', 'textarea',
    ].join(',');
    const out: string[] = [];
    for (const el of document.querySelector(scope)?.querySelectorAll<HTMLElement>(sel) ?? []) {
      if (el.closest('[aria-hidden=true], [inert]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      let r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Links in running text are exempt.
      if (el.tagName === 'A' && cs.display === 'inline') {
        const parentText = (el.parentElement?.textContent ?? '').trim();
        if (parentText.length > (el.textContent ?? '').trim().length + 1) continue;
      }
      // A checkbox or radio is hit through its label.
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file')) {
        const label = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
        if (label) r = label.getBoundingClientRect();
        if (el.type === 'file' && (cs.position === 'absolute' || r.width < 2)) continue;
      }
      // A control inside a bigger tap target (e.g. a whole clickable row) counts as that target.
      const host = el.parentElement?.closest<HTMLElement>('label, [role=button], button, a[href]');
      if (host && host !== el) {
        const h = host.getBoundingClientRect();
        if (h.width >= min - 0.5 && h.height >= min - 0.5) continue;
      }
      if (r.width >= min - 0.5 && r.height >= min - 0.5) continue;
      const text = (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.innerText ?? (el as HTMLInputElement).placeholder ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      out.push(`${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} "${text}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  }, [scope, min] as const);
}

