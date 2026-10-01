// The shared pieces for "mine and my clubs' things together": the owner
// chip on each item, the All · Mine · <club> filter row, the one "Save to"
// picker used wherever something is created or saved, and the Move or
// copy dialog.

import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type OrgSummary } from '../api';
import { ownerLabel, type OwnedItem, type OwnerFilter } from './owners';

export function OwnerChip({
  item,
  myUserId,
  orgs,
}: {
  item: OwnedItem;
  myUserId: string | undefined;
  orgs: readonly OrgSummary[] | undefined;
}) {
  const { text, kind } = ownerLabel(item, myUserId, orgs);
  const tone =
    kind === 'me'
      ? 'border-line bg-soft text-muted'
      : kind === 'club'
        ? 'border-transparent bg-accent-soft text-accent-text'
        : 'border-dashed border-border bg-panel text-muted';
  return (
    <span
      data-testid="owner-chip"
      title={kind === 'club' ? `Belongs to the club ${text}` : kind === 'me' ? 'Yours' : text}
      className={`inline-flex max-w-[12rem] shrink-0 items-center truncate rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}
    >
      {text}
    </span>
  );
}

/** All · Mine · each club, as toggle buttons that wrap onto more lines on a phone (no club hidden off the side). */
export function OwnerFilterBar({
  value,
  onChange,
  orgs,
}: {
  value: OwnerFilter;
  onChange: (f: OwnerFilter) => void;
  orgs: readonly OrgSummary[];
}) {
  const options: { value: OwnerFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'me', label: 'Mine' },
    ...orgs.map((o) => ({ value: o.slug, label: o.name })),
  ];
  return (
    <div role="group" aria-label="Show whose things" className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`tap-target inline-flex min-w-0 max-w-full items-center whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-semibold ${
              on ? 'border-accent bg-accent text-accent-ink' : 'border-border bg-panel text-ink hover:bg-soft'
            }`}
          >
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Save to: Me / <club>…". The value is '' for Me or a club's slug. With
 * no clubs there is nothing to pick, so it shows nothing.
 */
export function SaveToPicker({
  value,
  onChange,
  orgs,
  label = 'Save to',
  exclude,
  className = '',
}: {
  value: string;
  onChange: (slug: string) => void;
  orgs: readonly OrgSummary[] | undefined;
  label?: string;
  /** Owners not to offer ('' = Me). */
  exclude?: readonly string[];
  className?: string;
}) {
  if (!orgs || orgs.length === 0) return null;
  const options = [{ value: '', label: 'Me' }, ...orgs.map((o) => ({ value: o.slug, label: o.name }))].filter(
    (o) => !exclude?.includes(o.value),
  );
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full rounded-lg border border-border bg-soft px-3 py-2 text-ink"
      >
        {options.map((o) => (
          <option key={o.value || 'me'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export type MovableKind = 'layout' | 'module' | 'room';

const KIND_WORD: Record<MovableKind, string> = { layout: 'layout', module: 'module', room: 'room' };

/**
 * Move or copy a layout, module or room between you and your clubs.
 * Moving uses the existing transfer (layouts, modules) or room move; a
 * club's thing never moves back out to one person, so only Copy is
 * offered there.
 */
export function MoveCopyDialog({
  kind,
  item,
  canMove,
  orgs,
  onClose,
}: {
  kind: MovableKind;
  item: { id: string; title: string; ownerOrgId: string | null };
  /** The caller may move it (its owner, or an admin of the club holding it). */
  canMove: boolean;
  orgs: readonly OrgSummary[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const currentSlug = item.ownerOrgId ? (orgs.find((o) => o.id === item.ownerOrgId)?.slug ?? null) : '';
  const moveTargets = orgs.filter((o) => o.slug !== currentSlug);
  const moveAllowed = canMove && moveTargets.length > 0;
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [dest, setDest] = useState(() => (item.ownerOrgId ? '' : (orgs[0]?.slug ?? '')));
  const [error, setError] = useState<string | null>(null);
  const word = KIND_WORD[kind];

  const run = useMutation({
    mutationFn: async () => {
      const slug = dest || undefined;
      if (mode === 'copy') {
        if (kind === 'layout') return api.layouts.copy(item.id, slug);
        if (kind === 'module') return api.modules.copy(item.id, slug);
        return api.venues.copy(item.id, slug);
      }
      if (!slug) throw new Error(`A club's ${word} stays with the club. Make a copy for yourself instead.`);
      if (kind === 'layout') return api.transfers.initiate(item.id, { orgSlug: slug });
      if (kind === 'module') return api.moduleTransfers.initiate(item.id, { orgSlug: slug });
      return api.venues.move(item.id, slug);
    },
    onSuccess: async () => {
      const key = kind === 'layout' ? 'layouts' : kind === 'module' ? 'modules' : 'venues';
      await qc.invalidateQueries({ queryKey: [key] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function pickMode(m: 'copy' | 'move') {
    setMode(m);
    setError(null);
    // Moving goes to a club other than where it is now.
    if (m === 'move' && !moveTargets.some((o) => o.slug === dest)) setDest(moveTargets[0]?.slug ?? '');
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    run.mutate();
  }

  const radio = 'flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 py-2';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-copy-title"
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-section border border-line bg-panel p-5 text-sm text-ink shadow-[var(--pop-shadow)]"
      >
        <h3 id="move-copy-title" className="text-lg font-semibold">
          Move or copy “{item.title}”
        </h3>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-muted">What to do</legend>
          <label className={radio}>
            <input type="radio" name="mode" checked={mode === 'copy'} onChange={() => pickMode('copy')} />
            <span>
              <span className="font-semibold">Copy</span>
              <span className="block text-xs text-muted">Keep this one where it is and make a copy.</span>
            </span>
          </label>
          <label className={`${radio} ${moveAllowed ? '' : 'opacity-60'}`}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'move'}
              disabled={!moveAllowed}
              onChange={() => pickMode('move')}
            />
            <span>
              <span className="font-semibold">Move to a club</span>
              <span className="block text-xs text-muted">
                {!canMove
                  ? item.ownerOrgId
                    ? `Only the club's admins can move its ${word}s.`
                    : `Only the ${word}'s owner can move it.`
                  : moveTargets.length === 0
                    ? 'You are not in another club to move it to.'
                    : `The club keeps it, and everyone in the club can use it.`}
              </span>
            </span>
          </label>
        </fieldset>

        <SaveToPicker
          label={mode === 'copy' ? 'Copy to' : 'Move to'}
          value={dest}
          onChange={setDest}
          orgs={orgs}
          exclude={mode === 'move' ? ['', ...(currentSlug ? [currentSlug] : [])] : []}
        />
        {item.ownerOrgId && (
          <p className="text-xs text-muted">A club’s {word}s stay with the club. To have your own, make a copy.</p>
        )}

        {error && <p className="text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
            Cancel
          </button>
          <button
            type="submit"
            disabled={run.isPending}
            className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
          >
            {mode === 'copy' ? 'Copy' : 'Move'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A small "where does it go?" step before making a new thing, for people in a club. */
export function SaveToDialog({
  title,
  confirmLabel,
  initial,
  orgs,
  onConfirm,
  onClose,
}: {
  title: string;
  confirmLabel: string;
  initial: string;
  orgs: readonly OrgSummary[];
  onConfirm: (slug: string) => void;
  onClose: () => void;
}) {
  const [dest, setDest] = useState(() => (orgs.some((o) => o.slug === initial) ? initial : ''));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(dest);
        }}
        className="w-full max-w-sm space-y-4 rounded-section border border-line bg-panel p-5 text-sm text-ink shadow-[var(--pop-shadow)]"
      >
        <h3 className="text-lg font-semibold">{title}</h3>
        <SaveToPicker value={dest} onChange={setDest} orgs={orgs} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="tap-target rounded-lg border border-border px-4 py-2 hover:bg-soft">
            Cancel
          </button>
          <button
            type="submit"
            className="tap-target rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink hover:bg-accent-hover"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
