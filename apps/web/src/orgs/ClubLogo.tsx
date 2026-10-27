// A club's logo, or its first letter on a soft tile when it has none (or
// the picture can't be loaded). Decorative: the club's name is always
// next to it.

import { useState } from 'react';

export function ClubLogo({ name, logoUrl, size = 40, className = '' }: { name: string; logoUrl?: string | null | undefined; size?: number; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const box = { width: size, height: size };
  if (logoUrl && broken !== logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        style={box}
        data-testid="club-logo"
        onError={() => setBroken(logoUrl)}
        className={`shrink-0 rounded-lg border border-line bg-panel object-contain ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ ...box, fontSize: Math.max(12, Math.round(size * 0.45)) }}
      className={`grid shrink-0 place-items-center rounded-lg bg-soft font-semibold text-muted ${className}`}
    >
      {name.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  );
}
