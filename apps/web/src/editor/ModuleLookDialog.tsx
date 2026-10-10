// A placed module's look: whether its name shows, its outline and name
// colors, the "Same color" link and Reset to default. Changes show on
// the map (and for everyone else) as they're made; the desktop's
// ModuleLookDialog is the same.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type * as Y from 'yjs';
import { readSidecarFromDoc } from '@cld/ydoc';
import { useYjsSnapshot } from './useYjsSnapshot';
import { HelpButton } from '../help/HelpButton';
import { updateSidecarModule } from './mutations';
import { projectDoc } from './useDocMap';
import { layoutModuleColors } from './render/moduleLabels';
import {
  colorsLinked,
  hasCustomColors,
  moduleColor,
  withColor,
  withDefaultColors,
  withSameColor,
  withShowName,
  type ModuleColorPart,
} from './moduleLook';

interface Props {
  doc: Y.Doc;
  moduleId: string;
  onClose: () => void;
}

/** How long a color being dragged around the picker waits before it's written. */
const COLOR_WRITE_MS = 120;

export function ModuleLookDialog({ doc, moduleId, onClose }: Props) {
  // Follows the module as it changes, here or from someone else.
  useYjsSnapshot(doc);
  const modules = readSidecarFromDoc(doc)?.modules ?? [];
  const mod = modules.find((m) => m.id === moduleId) ?? null;
  // Its own default color, as the map draws it when none is chosen.
  const map = projectDoc(doc);
  const ownDefault = (map && layoutModuleColors(map, modules).get(moduleId)) || undefined;
  const pending = useRef<{ part: ModuleColorPart; hex: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flush() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) updateSidecarModule(doc, moduleId, (m) => withColor(m, p.part, p.hex));
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The module was deleted (here or by someone else): nothing to edit.
  useEffect(() => {
    if (!mod) onClose();
  }, [mod, onClose]);
  if (!mod) return null;

  function pick(part: ModuleColorPart, hex: string) {
    pending.current = { part, hex };
    if (timer.current === null) timer.current = setTimeout(flush, COLOR_WRITE_MS);
  }

  const linked = colorsLinked(mod);
  const name = mod.name || '(module)';
  const swatch = (part: ModuleColorPart, label: string) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input
        type="color"
        aria-label={label}
        data-testid={`module-${part}-color`}
        value={moduleColor(mod, part, ownDefault)}
        onChange={(e) => pick(part, e.target.value)}
        className="h-9 w-16 cursor-pointer rounded-lg border border-border bg-transparent"
      />
    </label>
  );

  // On <body>: opened from a panel, it must still cover the whole window.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Module look: ${name}`}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      // A portal still passes React events to the row it was opened from.
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[22rem] max-w-full rounded-lg border border-line bg-panel p-5 shadow-xl"
      >
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold" title={name}>
            {name}
          </h2>
          <HelpButton helpKey="dialog.moduleLook" />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="module-show-name"
            checked={mod.showName !== false}
            onChange={(e) => updateSidecarModule(doc, moduleId, (m) => withShowName(m, e.target.checked))}
          />
          Show name
        </label>
        <div className="mt-4 space-y-3">
          {swatch('outline', 'Outline color')}
          {swatch('name', 'Name color')}
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="module-same-color"
                checked={linked}
                onChange={(e) => {
                  flush();
                  updateSidecarModule(doc, moduleId, (m) => withSameColor(m, e.target.checked));
                }}
              />
              Same color
            </label>
            <p className="ml-6 mt-0.5 text-xs text-muted">
              {linked ? 'The outline and the name change together.' : 'Set each color on its own.'}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={!hasCustomColors(mod)}
            onClick={() => {
              pending.current = null;
              flush();
              updateSidecarModule(doc, moduleId, withDefaultColors);
            }}
            className="rounded-lg border border-border px-3 py-1 text-sm hover:bg-soft disabled:cursor-default disabled:opacity-40"
          >
            Reset to default
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-accent px-3 py-1 text-sm text-accent-ink hover:bg-accent-hover"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
