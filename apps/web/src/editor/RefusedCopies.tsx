// A card on every page for each layout copy the server refused
// (refusedCopies.ts): the work is only on this page, so it offers to save
// it as a new layout or download it, and asks before it is let go.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { askConfirm } from '../ui/ConfirmDialog';
import { downloadLocalLayout, localLayoutContents } from './localLayoutFile';
import { dropRefusedCopy, markRefusedCopyKept, useRefusedCopies, type RefusedCopy } from './refusedCopies';

export function RefusedCopies() {
  const copies = useRefusedCopies((s) => s.copies);
  if (copies.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4">
      {copies.map((c) => (
        <CopyCard key={c.key} copy={c} />
      ))}
    </div>
  );
}

const WHY: Record<RefusedCopy['why'], string> = {
  merge:
    "The server didn't take your latest changes to this layout, because they looked like another layout's parts going into it. Nothing you did is lost, but it's only on this page: save it as a new layout or download it before you close the page.",
  unreadable:
    "The server didn't take your latest changes to this layout, because they hold something the apps can't read. Nothing you did is lost, but it's only on this page: save it as a new layout or download it before you close the page.",
  signed_out:
    'You were signed out before your latest changes to this layout reached the server. Nothing you did is lost, but it’s only on this page: sign in again in another tab and save it as a new layout, or download it, before you close the page.',
  gone:
    'This layout was deleted, or is no longer shared with you, before your latest changes reached the server. Nothing you did is lost, but it’s only on this page: save it as a new layout or download it before you close the page.',
  view_only:
    'Your access to this layout changed to view only before your latest changes reached the server, so it didn’t take them. Nothing you did is lost, but it’s only on this page: save it as a new layout or download it before you close the page.',
};

function CopyCard({ copy }: { copy: RefusedCopy }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ['layout', copy.layoutId], queryFn: () => api.layouts.get(copy.layoutId), retry: false });
  const title = meta.data?.layout.title ?? 'this layout';
  const [busy, setBusy] = useState<'save' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const headingId = `refused-copy-${copy.key}`;

  async function saveAsNew(): Promise<void> {
    setBusy('save');
    setError(null);
    try {
      const { bbm, sidecar, background } = await localLayoutContents(copy.doc);
      const made = await api.layouts.create({
        title: `${meta.data?.layout.title ?? 'Layout'} (my copy)`,
        bbm,
        ...(sidecar ? { sidecar } : {}),
        ...(background ? { backgroundImage: background } : {}),
      });
      markRefusedCopyKept(copy.key);
      void qc.invalidateQueries({ queryKey: ['layouts'] });
      dropRefusedCopy(copy.key);
      navigate(`/editor/${made.id}`);
    } catch (e) {
      setError(`Couldn't save it as a new layout: ${(e as Error).message}. You can still download it.`);
    } finally {
      setBusy(null);
    }
  }

  async function download(): Promise<void> {
    setBusy('download');
    try {
      if (await downloadLocalLayout(copy.doc, copy.layoutId, `${meta.data?.layout.title ?? 'layout'} (my copy)`, undefined)) {
        markRefusedCopyKept(copy.key);
        setDownloaded(true);
      }
    } finally {
      setBusy(null);
    }
  }

  async function letGo(): Promise<void> {
    if (
      !copy.kept &&
      !(await askConfirm({
        title: 'Discard your copy?',
        removes: `The changes the server didn't take for “${title}” are only on this page. They're gone once you discard them.`,
        keeps: 'The layout on the server stays as it is.',
        undo: 'This can’t be undone.',
        confirmLabel: 'Discard',
      }))
    )
      return;
    dropRefusedCopy(copy.key);
  }

  const btn = 'tap-target rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60';
  return (
    <section
      role="alertdialog"
      aria-labelledby={headingId}
      data-testid="refused-copy"
      className="pointer-events-auto w-full max-w-xl rounded-card border-2 border-danger bg-panel p-4 text-ink shadow-pop"
    >
      <p id={headingId} className="text-sm font-semibold">
        Your copy of “{title}” is kept on this page
      </p>
      <p className="mt-2 text-sm">{WHY[copy.why]}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {downloaded && <p className="mt-2 text-sm text-muted">Downloaded. Open the file from the Layouts list any time.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy !== null} onClick={() => void saveAsNew()} className={`${btn} bg-accent text-accent-ink hover:bg-accent-hover`}>
          {busy === 'save' ? 'Saving…' : 'Save my copy as a new layout'}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => void download()} className={`${btn} border border-border hover:bg-soft`}>
          {busy === 'download' ? 'Preparing…' : 'Download it (.bld-layout)'}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => void letGo()} className="text-sm text-muted hover:underline">
          {copy.kept ? 'Done' : 'Discard my copy'}
        </button>
      </div>
    </section>
  );
}
