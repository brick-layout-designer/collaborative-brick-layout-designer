// "This one opens in the desktop app": what to do with an LDraw, Studio or
// LDD file, or a model that should become a part. Never a dead end: the
// steps, the download link and a help topic.

import { HelpButton } from '../help/HelpButton';
import { DESKTOP_URL } from '../projectLinks';
import type { DesktopOnlyFormat } from './openFiles';

/**
 * The steps for `name` (a file), or for a model in general; `part`: the
 * model should become a custom part.
 */
export function DesktopOnlySteps({
  name,
  format,
  part = false,
}: {
  name?: string | undefined;
  format?: DesktopOnlyFormat | undefined;
  part?: boolean;
}) {
  const asPart = part || (format?.part ?? false);
  return (
    <div className="space-y-2" data-testid="desktop-only">
      <p>
        {name && format ? (
          <>
            <span className="font-semibold text-ink break-all">{name}</span> is {format.what}. The website can’t open it, but
            the desktop app can.
          </>
        ) : part ? (
          <>The desktop app turns an LDraw, BrickLink Studio or LDD model into a custom part.</>
        ) : (
          <>LDraw, BrickLink Studio and LDD models are imported in the desktop app.</>
        )}
      </p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Import it in the desktop app{format ? ` (${format.where})` : ' (Tools › Import)'}.</li>
        {asPart ? (
          <li>Send it to this site: File › Open from Server…, then Upload to server… on the Parts tab.</li>
        ) : (
          <li>Save it to this site with File › Save to Server…</li>
        )}
      </ol>
      <p>It then shows up here, ready to edit and share.</p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a
          href={DESKTOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="tap-target inline-flex items-center font-semibold text-accent-text hover:underline"
        >
          Get the desktop app
        </a>
        <span className="inline-flex items-center gap-1">
          How this works <HelpButton helpKey="open.desktop" />
        </span>
      </p>
    </div>
  );
}
