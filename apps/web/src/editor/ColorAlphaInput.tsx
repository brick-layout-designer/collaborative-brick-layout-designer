// Colour with alpha — the web stand-in for desktop's colour buttons, which
// open QColorDialog with ShowAlphaChannel (EditDialogs.cpp:68). The value
// is `aarrggbb` hex, as the .bbm stores unknown colours.

interface Props {
  /** `aarrggbb` (case-insensitive). */
  value: string;
  onChange: (argb: string) => void;
  /** Accessible name; the alpha slider is "<label> alpha". */
  label: string;
  compact?: boolean;
}

export function ColorAlphaInput({ value, onChange, label, compact = false }: Props) {
  const argb = value.padStart(8, 'f').slice(-8).toLowerCase();
  const alpha = parseInt(argb.slice(0, 2), 16);
  const rgb = argb.slice(2);
  const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return (
    <span className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={`#${rgb}`}
        onChange={(e) => onChange(argb.slice(0, 2) + e.target.value.slice(1).toLowerCase())}
        className={compact ? 'h-6 w-8 cursor-pointer rounded-lg border border-border bg-transparent' : 'h-8 w-12 cursor-pointer rounded-lg border border-border bg-transparent'}
      />
      <input
        type="range"
        min={0}
        max={255}
        aria-label={`${label} alpha`}
        title={`Alpha ${alpha}`}
        value={Number.isFinite(alpha) ? alpha : 255}
        onChange={(e) => onChange(hex2(parseInt(e.target.value, 10)) + rgb)}
        className={compact ? 'w-14' : 'w-24'}
      />
    </span>
  );
}
