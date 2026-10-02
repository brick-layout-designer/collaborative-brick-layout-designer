// A module's picture in a list, or a placeholder while it has none (a
// module gets its picture when it's saved, or the first time it's opened).

import { useState } from 'react';
import { moduleThumbnailUrl, type ModuleSummary } from '../api';

const SIZES = { sm: 'size-10', md: 'size-14', lg: 'size-24' } as const;

export function ModuleThumb({
  module,
  size = 'md',
}: {
  module: Pick<ModuleSummary, 'id' | 'title' | 'thumbnailAt'>;
  size?: keyof typeof SIZES;
}) {
  const url = moduleThumbnailUrl(module);
  // The picture didn't load (removed, or offline): the placeholder.
  const [failed, setFailed] = useState<string | null>(null);
  const box = `${SIZES[size]} shrink-0 overflow-hidden rounded-lg border border-line bg-soft`;
  if (!url || failed === url) {
    return (
      <span data-testid="module-thumb-placeholder" aria-hidden className={`${box} grid place-items-center text-muted`}>
        <svg width="45%" height="45%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <rect x="3" y="9" width="18" height="11" rx="1.5" />
          <rect x="6" y="5" width="4" height="4" rx="1" />
          <rect x="14" y="5" width="4" height="4" rx="1" />
        </svg>
      </span>
    );
  }
  return (
    <img
      data-testid="module-thumb"
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(url)}
      className={`${box} object-contain`}
    />
  );
}
