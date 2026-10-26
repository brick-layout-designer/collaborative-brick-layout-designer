import { api, type CustomPartSummary } from '../api';

/**
 * A custom part's picture in a list. A set (several parts placed together,
 * such as a Brick Track Designer export) has no picture of its own: it
 * shows a "Set" tile instead.
 */
export function PartPicture({ part, className }: { part: Pick<CustomPartSummary, 'id' | 'kind'>; className: string }) {
  if (part.kind === 'set') {
    return (
      <span
        className={`${className} flex shrink-0 items-center justify-center rounded border border-dashed border-line text-xs font-medium text-muted`}
        title="A set: several parts placed together"
      >
        Set
      </span>
    );
  }
  return <img src={api.customParts.spriteUrl(part.id)} alt="" className={`${className} shrink-0 object-contain`} loading="lazy" />;
}
