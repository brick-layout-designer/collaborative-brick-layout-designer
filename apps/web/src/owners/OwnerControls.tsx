// The shared pieces for "mine and my clubs' things together": the owner
// chip on each item, the All · Mine · <club> filter row, the one "Save to"
// picker used wherever something is created or saved, and the Move or
// copy dialog.

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Credit, type OrgSummary, type OwnableKind } from '../api';
import { creditText, moveToClubWording, ownerLabel, type OwnedItem, type OwnerFilter } from './owners';
import { askConfirm, showToast } from '../ui/ConfirmDialog';
import { invalidateFor } from '../live/invalidate';
import { MORE_ITEM } from '../ui/MoreMenu';

/** "by Sam · in ArkLUG", and for a copy "based on Yard by Sam": a small line under the name. */
export function CreditLine({ credit, className = '' }: { credit: Credit | null | undefined; className?: string }) {
  const { line, basedOn } = creditText(credit);
  if (!line && !basedOn) return null;
  return (
    <p data-testid="credit" className={`break-words text-xs text-muted ${className}`}>
      {[line, basedOn].filter(Boolean).join(' · ')}
    </p>
  );
}

const RETURN_WORD: Record<OwnableKind, string> = { layouts: 'layout', modules: 'module', venues: 'venue', 'custom-parts': 'part' };

/**
 * "Take back to mine" (the author, in the club) and "Give back to ‹author›"
 * (the club's admins and managers), for a ⋯ menu. The club keeps its own
 * copy, so nothing it built with it changes. Shows nothing when neither
 * applies.
 */
export function ReturnMenuItems({ kind, id, title, credit }: { kind: OwnableKind; id: string; title: string; credit: Credit | null | undefined }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: (mode: 'take' | 'give') => (mode === 'take' ? api.ownership.takeBack(kind, id) : api.ownership.giveBack(kind, id)),
    onSuccess: (_r, mode) => {
      for (const k of ['layout', 'module', 'venue', 'custom-part', 'warning'] as const) void invalidateFor(qc, k);
      showToast(mode === 'take' ? `“${title}” is yours again` : `Gave “${title}” back to ${credit?.authorName ?? 'its author'}`);
    },
    onError: (e: Error) => showToast(`Could not do that: ${e.message}`),
  });
  if (!credit || (!credit.canTakeBack && !credit.canGiveBack)) return null;
  const word = RETURN_WORD[kind];
  const club = credit.club ?? 'The club';
  async function ask(mode: 'take' | 'give') {
    const who = mode === 'take' ? 'you' : (credit?.authorName ?? 'its author');
    const ok = await askConfirm({
      title: mode === 'take' ? `Take “${title}” back?` : `Give “${title}” back to ${who}?`,
      removes: mode === 'take' ? `The ${word} becomes yours again, and only yours.` : `The ${word} goes back to ${who}, who made it.`,
      keeps: `${club} keeps its own copy, credited to ${mode === 'take' ? 'you' : who}, so nothing the club built with it changes. Its admins and managers are told.`,
      undo: mode === 'take' ? 'To share it again, move it back to the club.' : `${who} can move it back to the club.`,
      confirmLabel: mode === 'take' ? 'Take back' : 'Give back',
      danger: false,
    });
    if (ok) run.mutate(mode);
  }
  return (
    <>
      {credit.canTakeBack && (
        <button role="menuitem" type="button" className={MORE_ITEM} onClick={() => void ask('take')}>
          Take back to mine
        </button>
      )}
      {credit.canGiveBack && (
        <button role="menuitem" type="button" className={MORE_ITEM} onClick={() => void ask('give')}>
          Give back to {credit.authorName ?? 'the author'}
        </button>
      )}
    </>
  );
}

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

/** The clubs I may save new things to (a club that keeps adding to its admins is left out for its members). */
export function clubsICanAddTo<T extends Pick<OrgSummary, 'canAdd'>>(orgs: readonly T[] | undefined): T[] {
  return (orgs ?? []).filter((o) => o.canAdd !== false);
}

/**
 * "Save to: Me / <club>…". The value is '' for Me or a club's slug. Only
 * clubs that will take it are offered; a starting value that isn't one of
 * them (e.g. Home showing a club that keeps adding to its admins) falls
 * back to Me. With no clubs there is nothing to pick, so it shows nothing.
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
  const options = [{ value: '', label: 'Me' }, ...clubsICanAddTo(orgs).map((o) => ({ value: o.slug, label: o.name }))].filter(
    (o) => !exclude?.includes(o.value),
  );
  const offered = options.some((o) => o.value === value);
  const first = options[0]?.value;
  useEffect(() => {
    // Only once the clubs are in: before that every club looks missing.
    if (orgs && !offered && first !== undefined) onChange(first);
  }, [orgs, offered, first, onChange]);
  // Nothing to choose: no clubs, or only Me.
  if (!orgs || options.length === 0 || (options.length === 1 && first === '')) return null;
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

export type MovableKind = 'layout' | 'module' | 'room' | 'part';

const KIND_WORD: Record<MovableKind, string> = { layout: 'layout', module: 'module', room: 'venue', part: 'part' };

/**
 * Move or copy a layout, module, venue or custom part between you and
 * your clubs. Moving uses the existing transfer (layouts, modules) or the
 * venue and part move. Moving your own thing into a club asks first: the
 * club will own it, and you stay its author. A club's thing goes back to
 * one person only through Take back / Give back (ReturnMenuItems).
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
  const moveTargets = clubsICanAddTo(orgs).filter((o) => o.slug !== currentSlug);
  const moveAllowed = canMove && moveTargets.length > 0;
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [dest, setDest] = useState(() => (item.ownerOrgId ? '' : (clubsICanAddTo(orgs)[0]?.slug ?? '')));
  const [error, setError] = useState<string | null>(null);
  const word = KIND_WORD[kind];

  const run = useMutation({
    mutationFn: async () => {
      const slug = dest || undefined;
      if (mode === 'copy') {
        if (kind === 'layout') return api.layouts.copy(item.id, slug);
        if (kind === 'module') return api.modules.copy(item.id, slug);
        if (kind === 'part') return api.customParts.copy(item.id, slug);
        return api.venues.copy(item.id, slug);
      }
      if (!slug) throw new Error(`A club's ${word} stays with the club. Make a copy for yourself instead.`);
      if (kind === 'layout') return api.transfers.initiate(item.id, { orgSlug: slug });
      if (kind === 'module') return api.moduleTransfers.initiate(item.id, { orgSlug: slug });
      if (kind === 'part') return api.customParts.move(item.id, slug);
      return api.venues.move(item.id, slug);
    },
    onSuccess: async () => {
      const key = kind === 'layout' ? 'layouts' : kind === 'module' ? 'modules' : kind === 'part' ? 'custom-parts' : 'venues';
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Your own thing into a club: one click, but say what that means first.
    if (mode === 'move' && !item.ownerOrgId) {
      const club = orgs.find((o) => o.slug === dest)?.name ?? 'The club';
      const ok = await askConfirm({ ...moveToClubWording(club), confirmLabel: 'Move', danger: false });
      if (!ok) return;
    }
    run.mutate();
  }

  const radio = 'flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 py-2';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-copy-title"
        onSubmit={(e) => void submit(e)}
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
                    : `The club owns it, and everyone in the club can use it. You stay credited as its author.`}
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
          <p className="text-xs text-muted">
            A club’s {word}s stay with the club. Its author can take one back from the ⋯ menu; anyone can make a copy.
          </p>
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
  const [dest, setDest] = useState(() => (clubsICanAddTo(orgs).some((o) => o.slug === initial) ? initial : ''));
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
