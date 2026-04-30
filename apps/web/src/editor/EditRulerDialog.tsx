// Edit-Ruler properties dialog — port of `editRulerDialog`
// (EditDialogs.cpp:157-296). Surfaces every field on the ruler item:
//   - line color / thickness
//   - displayDistance / displayUnit / unit (combo)
//   - guideline color / thickness / dash pattern
//   - measure font (family, size, bold, italic) / measure font color
//   - linear-only: allowOffset / offsetDistance / Detach endpoint buttons
//   - circular-only: radius / Detach centre button
//
// Commits via `editRulerItem` + `attachRulerEndpoint` mutations.

import { useState } from 'react';
import type * as Y from 'yjs';
import type {
  CircularRulerItem,
  ColorSpec,
  FontSpec,
  LinearRulerItem,
  RulerItem,
} from '@cld/model';
import { attachRulerEndpoint, editRulerItem } from './mutations';

interface Props {
  item: RulerItem;
  layerId: string;
  doc: Y.Doc;
  onClose: () => void;
}

const UNITS = [
  { value: 0, label: 'STUD' },
  { value: 1, label: 'LDU' },
  { value: 2, label: 'STRAIGHT_TRACK' },
  { value: 3, label: 'MODULE' },
  { value: 4, label: 'METER' },
  { value: 5, label: 'FEET' },
];

export function EditRulerDialog({ item, layerId, doc, onClose }: Props) {
  const [color, setColor] = useState<string>(colorToHex(item.color));
  const [lineThickness, setLineThickness] = useState(item.lineThickness);
  const [displayDistance, setDisplayDistance] = useState(item.displayDistance);
  const [displayUnit, setDisplayUnit] = useState(item.displayUnit);
  const [unit, setUnit] = useState(item.unit);
  const [guidelineColor, setGuidelineColor] = useState<string>(colorToHex(item.guidelineColor));
  const [guidelineThickness, setGuidelineThickness] = useState(item.guidelineThickness);
  const [dashCsv, setDashCsv] = useState(item.guidelineDashPattern.join(', '));
  const [fontFamily, setFontFamily] = useState(item.measureFont.family);
  const [fontSize, setFontSize] = useState(item.measureFont.size);
  const styleStr = (item.measureFont.style ?? '').toLowerCase();
  const [bold, setBold] = useState(styleStr.includes('bold'));
  const [italic, setItalic] = useState(styleStr.includes('italic'));
  const [fontColor, setFontColor] = useState<string>(colorToHex(item.measureFontColor));

  // Linear extras.
  const linear = item.kind === 'linear' ? (item as LinearRulerItem) : null;
  const [offsetDistance, setOffsetDistance] = useState(linear?.offsetDistance ?? 0);
  const [allowOffset, setAllowOffset] = useState(linear?.allowOffset ?? false);

  // Circular extras.
  const circular = item.kind === 'circular' ? (item as CircularRulerItem) : null;
  const [radius, setRadius] = useState(circular?.radius ?? 0);

  function commit() {
    const styleParts: string[] = [];
    if (bold) styleParts.push('Bold');
    if (italic) styleParts.push('Italic');
    const measureFont: FontSpec = {
      family: fontFamily,
      size: fontSize,
      style: styleParts.join(',') || 'Regular',
    };
    const dash = dashCsv
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    editRulerItem(doc, layerId, item.id, {
      color: hexToColor(color),
      lineThickness,
      displayDistance,
      displayUnit,
      unit,
      guidelineColor: hexToColor(guidelineColor),
      guidelineThickness,
      guidelineDashPattern: dash,
      measureFont,
      measureFontColor: hexToColor(fontColor),
      ...(linear ? { offsetDistance, allowOffset } : {}),
      ...(circular ? { radius } : {}),
    });
    onClose();
  }

  function detachEndpoint(which: 0 | 1) {
    attachRulerEndpoint(doc, layerId, item.id, which, '');
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-[34rem] overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">
          Edit {item.kind === 'linear' ? 'linear' : 'circular'} ruler
        </h2>

        <fieldset className="mt-4 space-y-2 rounded border border-neutral-800 p-3 text-sm">
          <legend className="px-1 text-xs uppercase tracking-wider text-neutral-500">Line</legend>
          <Row label="Colour">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </Row>
          <Row label="Thickness">
            <NumberField value={lineThickness} setValue={setLineThickness} step={0.5} min={0.5} />
          </Row>
        </fieldset>

        <fieldset className="mt-3 space-y-2 rounded border border-neutral-800 p-3 text-sm">
          <legend className="px-1 text-xs uppercase tracking-wider text-neutral-500">Distance</legend>
          <Row label="Show distance">
            <input
              type="checkbox"
              checked={displayDistance}
              onChange={(e) => setDisplayDistance(e.target.checked)}
            />
          </Row>
          <Row label="Show unit">
            <input
              type="checkbox"
              checked={displayUnit}
              onChange={(e) => setDisplayUnit(e.target.checked)}
            />
          </Row>
          <Row label="Unit">
            <select
              value={unit}
              onChange={(e) => setUnit(parseInt(e.target.value, 10))}
              className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
            >
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </Row>
        </fieldset>

        <fieldset className="mt-3 space-y-2 rounded border border-neutral-800 p-3 text-sm">
          <legend className="px-1 text-xs uppercase tracking-wider text-neutral-500">Label</legend>
          <Row label="Font">
            <input
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
            />
          </Row>
          <Row label="Size">
            <NumberField value={fontSize} setValue={setFontSize} step={1} min={1} />
          </Row>
          <Row label="Style">
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} />
                Bold
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} />
                Italic
              </label>
            </div>
          </Row>
          <Row label="Colour">
            <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} />
          </Row>
        </fieldset>

        <fieldset className="mt-3 space-y-2 rounded border border-neutral-800 p-3 text-sm">
          <legend className="px-1 text-xs uppercase tracking-wider text-neutral-500">Guidelines</legend>
          <Row label="Colour">
            <input
              type="color"
              value={guidelineColor}
              onChange={(e) => setGuidelineColor(e.target.value)}
            />
          </Row>
          <Row label="Thickness">
            <NumberField
              value={guidelineThickness}
              setValue={setGuidelineThickness}
              step={0.5}
              min={0.5}
            />
          </Row>
          <Row label="Dash (px,px,…)">
            <input
              value={dashCsv}
              onChange={(e) => setDashCsv(e.target.value)}
              className="w-32 rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
            />
          </Row>
        </fieldset>

        {linear && (
          <fieldset className="mt-3 space-y-2 rounded border border-neutral-800 p-3 text-sm">
            <legend className="px-1 text-xs uppercase tracking-wider text-neutral-500">Linear</legend>
            <Row label="Allow offset">
              <input
                type="checkbox"
                checked={allowOffset}
                onChange={(e) => setAllowOffset(e.target.checked)}
              />
            </Row>
            <Row label="Offset (studs)">
              <NumberField value={offsetDistance} setValue={setOffsetDistance} step={0.5} />
            </Row>
            <Row label="Endpoint 1">
              <span className="text-xs text-neutral-500">
                {linear.attachedBrick1Id ? `attached to ${linear.attachedBrick1Id.slice(0, 8)}…` : 'free'}
              </span>
              <button
                disabled={!linear.attachedBrick1Id}
                onClick={() => detachEndpoint(0)}
                className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800 disabled:opacity-30"
              >
                Detach
              </button>
            </Row>
            <Row label="Endpoint 2">
              <span className="text-xs text-neutral-500">
                {linear.attachedBrick2Id ? `attached to ${linear.attachedBrick2Id.slice(0, 8)}…` : 'free'}
              </span>
              <button
                disabled={!linear.attachedBrick2Id}
                onClick={() => detachEndpoint(1)}
                className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800 disabled:opacity-30"
              >
                Detach
              </button>
            </Row>
          </fieldset>
        )}

        {circular && (
          <fieldset className="mt-3 space-y-2 rounded border border-neutral-800 p-3 text-sm">
            <legend className="px-1 text-xs uppercase tracking-wider text-neutral-500">Circular</legend>
            <Row label="Radius (studs)">
              <NumberField value={radius} setValue={setRadius} step={0.5} min={0} />
            </Row>
            <Row label="Centre">
              <span className="text-xs text-neutral-500">
                {circular.attachedBrickId ? `attached to ${circular.attachedBrickId.slice(0, 8)}…` : 'free'}
              </span>
              <button
                disabled={!circular.attachedBrickId}
                onClick={() => detachEndpoint(0)}
                className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800 disabled:opacity-30"
              >
                Detach
              </button>
            </Row>
          </fieldset>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-32 text-xs text-neutral-400">{label}</label>
      <div className="flex flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

function NumberField({
  value,
  setValue,
  step,
  min,
}: {
  value: number;
  setValue: (v: number) => void;
  step: number;
  min?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n)) setValue(n);
      }}
      className="w-24 rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
    />
  );
}

const KNOWN_HEX: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
};

function colorToHex(c: ColorSpec): string {
  if (c.kind === 'known') return KNOWN_HEX[(c.name ?? '').toLowerCase()] ?? '#000000';
  return c.argb.length === 8 ? `#${c.argb.slice(2)}` : `#${c.argb}`;
}

function hexToColor(hex: string): ColorSpec {
  const h = hex.replace(/^#/, '').toUpperCase();
  return { kind: 'argb', argb: `FF${h}` };
}
