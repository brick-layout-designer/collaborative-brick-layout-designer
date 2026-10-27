// The shared pieces for "mine and my clubs' things together": the owner
// chip on each item, the All · Mine · <club> filter row, the one "Save to"
// picker used wherever something is created or saved, and the Move or
// copy dialog.

import { ClubLogo } from '../orgs/ClubLogo';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Credit, type OrgSummary, type OwnableKind, type SetMovePlan, type SetPartSummary } from '../api';
import { HelpButton } from '../help/HelpButton';
import { creditText, moveToClubWording, ownerLabel, type OwnedItem, type OwnerFilter } from './owners';
import { askConfirm, showToast } from '../ui/ConfirmDialog';
import { invalidateFor } from '../live/invalidate';
import { MORE_ITEM } from '../ui/MoreMenu';
import { addPermissionFor, askForPermission, clubCanAdd, type AddKind } from '../orgs/clubPermissions';

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
 * (people whose club roles may Delete club items), for a ⋯ menu. The club keeps its own
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
      keeps: `${club} keeps its own copy, credited to ${mode === 'take' ? 'you' : who}, so nothing the club built with it changes. Members with the Delete club items permission are told.`,
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

/** The clubs my roles let me save this kind of thing to (a layout by default). */
export function clubsICanAddTo<T extends Pick<OrgSummary, 'canAdd' | 'permissions' | 'myRole'>>(orgs: readonly T[] | undefined, kind: AddKind = 'layout'): T[] {
  return (orgs ?? []).filter((o) => clubCanAdd(o, kind));
}

/** Clubs I'm in that won't take this kind of thing from me, for a plain note under the picker. */
export function clubsLeftOut(orgs: readonly OrgSummary[] | undefined, kind: AddKind): OrgSummary[] {
  return (orgs ?? []).filter((o) => !clubCanAdd(o, kind));
}

/** "Olive Club isn’t listed: your roles there can’t add modules. Ask a club admin for the Add or edit modules permission." */
export function LeftOutNote({ orgs, kind }: { orgs: readonly OrgSummary[] | undefined; kind: AddKind }) {
  const out = clubsLeftOut(orgs, kind);
  if (!out.length) return null;
  const names = out.map((o) => o.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const what = kind === 'module' ? 'modules' : kind === 'part' ? 'parts' : kind === 'venue' ? 'venues' : kind === 'collection' ? 'collections' : 'layouts';
  return (
    <p className="mt-1 text-xs text-muted" data-testid="clubs-left-out">
      {list} {names.length === 1 ? 'isn’t' : 'aren’t'} listed: your roles there can’t add {what}. {askForPermission(addPermissionFor(kind))}
    </p>
  );
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
  kind = 'layout',
}: {
  value: string;
  onChange: (slug: string) => void;
  orgs: readonly OrgSummary[] | undefined;
  label?: string;
  /** What is being saved: only clubs whose roles let me add it are offered. */
  kind?: AddKind;
  /** Owners not to offer ('' = Me). */
  exclude?: readonly string[];
  className?: string;
}) {
  const options = [{ value: '', label: 'Me' }, ...clubsICanAddTo(orgs, kind).map((o) => ({ value: o.slug, label: o.name }))].filter(
    (o) => !exclude?.includes(o.value),
  );
  const offered = options.some((o) => o.value === value);
  const first = options[0]?.value;
  useEffect(() => {
    // Only once the clubs are in: before that every club looks missing.
    if (orgs && !offered && first !== undefined) onChange(first);
  }, [orgs, offered, first, onChange]);
  // Nothing to choose: no clubs, or only Me.
  if (!orgs || options.length === 0 || (options.length === 1 && first === '')) {
    // Only Me: say so when a club of mine is left out, so it isn't a silent dead end.
    return orgs && clubsLeftOut(orgs, kind).length > 0 ? (
      <div className={`text-sm ${className}`}>
        <p className="text-muted">It’s saved to your own things.</p>
        <LeftOutNote orgs={orgs} kind={kind} />
      </div>
    ) : null;
  }
  const chosen = value ? orgs.find((o) => o.slug === value) : undefined;
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-muted">{label}</span>
      <span className="flex items-center gap-2">
        {/* The chosen club's logo, when it has one (a list of options can't show pictures). */}
        {chosen?.logoUrl && <ClubLogo name={chosen.name} logoUrl={chosen.logoUrl} size={36} />}
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
      </span>
      <LeftOutNote orgs={orgs} kind={kind} />
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
  /** `isSet`: a custom set, whose own custom parts move with it (the dialog lists them). */
  item: { id: string; title: string; ownerOrgId: string | null; isSet?: boolean };
  /** The caller may move it (its owner, or an admin of the club holding it). */
  canMove: boolean;
  orgs: readonly OrgSummary[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const currentSlug = item.ownerOrgId ? (orgs.find((o) => o.id === item.ownerOrgId)?.slug ?? null) : '';
  const addKind: AddKind = kind === 'room' ? 'venue' : kind;
  const moveTargets = clubsICanAddTo(orgs, addKind).filter((o) => o.slug !== currentSlug);
  const moveAllowed = canMove && moveTargets.length > 0;
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [dest, setDest] = useState(() => (item.ownerOrgId ? '' : (clubsICanAddTo(orgs, addKind)[0]?.slug ?? '')));
  const [error, setError] = useState<string | null>(null);
  const word = KIND_WORD[kind];
  const setMove = kind === 'part' && !!item.isSet && mode === 'move' && !!dest;
  const plan = useQuery({
    queryKey: ['set-move-plan', item.id, dest],
    queryFn: () => api.customParts.movePlan(item.id, dest),
    enabled: setMove,
  });

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
    onSuccess: async (res) => {
      const key = kind === 'layout' ? 'layouts' : kind === 'module' ? 'modules' : kind === 'part' ? 'custom-parts' : 'venues';
      await qc.invalidateQueries({ queryKey: [key] });
      if (kind === 'part') await qc.invalidateQueries({ queryKey: ['parts-catalog'] });
      const moved = res && typeof res === 'object' && 'parts' in res ? (res as { parts?: { moved?: string[] } }).parts?.moved?.length ?? 0 : 0;
      if (moved > 0) {
        const club = orgs.find((o) => o.slug === dest)?.name ?? 'the club';
        showToast(`Moved “${item.title}” and ${moved === 1 ? '1 of your parts' : `${moved} of your parts`} in it to ${club}.`);
      }
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
        {setMove && <SetMoveParts plan={plan.data?.parts} loading={plan.isLoading} failed={plan.isError} />}
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

const partName = (p: SetPartSummary) => (p.displayName && p.displayName !== p.partNumber ? `${p.displayName} (${p.partNumber})` : p.partNumber);

/** What moving a set does with the custom parts in it: which come along, which stay (the club gets a copy), which the club has. */
function SetMoveParts({ plan, loading, failed }: { plan: SetMovePlan | undefined; loading: boolean; failed: boolean }) {
  if (loading) return <p className="text-xs text-muted">Checking the parts in this set…</p>;
  if (failed || !plan) return <p className="text-xs text-muted">Couldn’t check the parts in this set. Your custom parts in it still move with it.</p>;
  const groups: [string, SetPartSummary[]][] = [
    [plan.move.length === 1 ? 'This custom part of yours moves with the set:' : `These ${plan.move.length} custom parts of yours move with the set:`, plan.move],
    ['These stay yours, because another of your sets uses them. The club gets its own copy:', plan.copy],
    ['The club already has parts with these numbers, so the set uses the club’s:', plan.inClub],
    ['These aren’t yours to move, so they stay where they are:', plan.notYours],
  ];
  const shown = groups.filter(([, list]) => list.length > 0);
  return (
    <div className="space-y-2 rounded-lg border border-line bg-soft/40 p-3 text-sm" data-testid="set-move-parts">
      <p className="flex items-start gap-1">
        <span>{shown.length === 0 ? 'This set has no custom parts of yours in it, so only the set moves.' : 'Your custom parts in this set:'}</span>
        <HelpButton helpKey="set.moving" />
      </p>
      {shown.map(([label, list]) => (
        <div key={label}>
          <p className="text-xs">{label}</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {list.map((p) => (
              <li key={p.id} className="break-words">
                {partName(p)}
              </li>
            ))}
          </ul>
        </div>
      ))}
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
