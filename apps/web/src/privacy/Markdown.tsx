// A small, safe markdown reader for the privacy notice an admin writes:
// headings (#, ##, ###), paragraphs, bulleted and numbered lists, **bold**,
// *italic*, `code` and [links](https://…). It builds React elements (never
// raw HTML), and links only go to http(s), mailto: or a path on this site.

import { Fragment, type ReactNode } from 'react';

export function safeHref(href: string): string | null {
  const h = href.trim();
  if (h.startsWith('/') && !h.startsWith('//')) return h;
  if (/^mailto:[^\s]+$/i.test(h)) return h;
  try {
    const u = new URL(h);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

export function inline(text: string, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const t = m[0];
    const key = `${keyBase}-${n++}`;
    if (t.startsWith('**')) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const label = t.slice(1, t.indexOf(']('));
      const href = safeHref(t.slice(t.indexOf('](') + 2, -1));
      out.push(
        href ? (
          <a key={key} href={href} className="text-accent-text hover:underline" {...(href.startsWith('/') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
            {label}
          </a>
        ) : (
          <Fragment key={key}>{label}</Fragment>
        ),
      );
    } else out.push(<em key={key}>{t.slice(1, -1)}</em>);
    last = i + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '), `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={`l${blocks.length}`} className="list-decimal space-y-1 pl-6">
          {items}
        </ol>
      ) : (
        <ul key={`l${blocks.length}`} className="list-disc space-y-1 pl-6">
          {items}
        </ul>
      ),
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      const level = h[1]!.length;
      const k = `h${blocks.length}`;
      const content = inline(h[2]!, k);
      blocks.push(
        level === 1 ? (
          <h2 key={k} className="font-display text-xl font-semibold">
            {content}
          </h2>
        ) : level === 2 ? (
          <h3 key={k} className="text-lg font-semibold">
            {content}
          </h3>
        ) : (
          <h4 key={k} className="font-semibold">
            {content}
          </h4>
        ),
      );
    } else if (bullet || num) {
      flushPara();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? num)![1]!);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="space-y-3 leading-relaxed">{blocks}</div>;
}
