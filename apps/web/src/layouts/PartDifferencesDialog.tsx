// Parts That Differ — the web side of desktop PartDifferencesDialog: a
// layout file carries its own version of parts the server already has.
// Each is shown both ways (sprite, description, author), with a choice:
// keep the server's, use the file's, or keep both (the file's under the
// next free number, and the layout switched to it).

import { useEffect, useState } from 'react';
import { api } from '../api';
import { partInfo, type PartChoice, type PartDifference } from '../layoutParts';

interface Props {
  differences: PartDifference[];
  /** The choice for each part, in order; `null` keeps all the server's. */
  onDone: (choices: PartChoice[] | null) => void;
}

function Side({ image, xml, label }: { image: string | null; xml: string; label: string }) {
  const info = partInfo(xml);
  return (
    <div className="space-y-1">
      <div className="grid h-24 w-32 place-items-center rounded-lg border border-line bg-bg">
        {image ? (
          <img src={image} alt={label} className="max-h-full max-w-full object-contain [image-rendering:pixelated]" />
        ) : (
          <span className="text-xs text-muted">No image</span>
        )}
      </div>
      <p className="text-xs">{info.description || '(no description)'}</p>
      {info.author && <p className="text-xs text-muted">by {info.author}</p>}
    </div>
  );
}

export function PartDifferencesDialog({ differences, onDone }: Props) {
  const [choices, setChoices] = useState<PartChoice[]>(() => differences.map(() => 'server'));
  // The file's sprites, as blob URLs while the dialog is open.
  const [fileImages, setFileImages] = useState<(string | null)[]>(() => differences.map(() => null));
  useEffect(() => {
    const urls = differences.map((d) =>
      d.sprite ? URL.createObjectURL(new Blob([d.sprite as BlobPart], { type: d.spriteMime ?? '' })) : null,
    );
    setFileImages(urls);
    return () => {
      for (const u of urls) if (u) URL.revokeObjectURL(u);
    };
  }, [differences]);

  const n = differences.length;
  return (
    <div role="dialog" aria-modal="true" aria-label="Parts That Differ" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="max-h-full w-full max-w-3xl overflow-y-auto rounded-lg border border-line bg-panel p-5 shadow-xl">
        <h2 className="text-base font-semibold">Parts That Differ</h2>
        <p className="mt-2 text-sm text-muted">
          This layout has its own version of {n} part{n === 1 ? '' : 's'} the server already has. Choose which to use for
          each.
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="pb-2 pr-3 font-medium">Part</th>
              <th className="pb-2 pr-3 font-medium">On the server</th>
              <th className="pb-2 pr-3 font-medium">In the file</th>
              <th className="pb-2 font-medium">Use</th>
            </tr>
          </thead>
          <tbody>
            {differences.map((d, i) => (
              <tr key={d.partNumber} className="border-t border-line align-top">
                <td className="py-2 pr-3 font-mono text-xs">{d.partNumber}</td>
                <td className="py-2 pr-3">
                  <Side image={api.customParts.spriteUrl(d.customPartId)} xml={d.serverXml} label={`${d.partNumber} on the server`} />
                </td>
                <td className="py-2 pr-3">
                  <Side image={fileImages[i] ?? null} xml={d.fileXml} label={`${d.partNumber} in the file`} />
                </td>
                <td className="py-2">
                  <select
                    aria-label={`Use for ${d.partNumber}`}
                    value={choices[i]}
                    onChange={(e) => setChoices((c) => c.map((v, j) => (j === i ? (e.target.value as PartChoice) : v)))}
                    title="Use the file's: the server's part is replaced. Keep both: the file's is added under a new part number, and this layout uses it."
                    className="rounded-lg border border-border bg-soft px-2 py-1"
                  >
                    <option value="server">Keep the server&apos;s</option>
                    <option value="file" disabled={!d.sprite}>Use the file&apos;s</option>
                    <option value="both" disabled={!d.sprite}>Keep both</option>
                  </select>
                  {!d.sprite && <p className="mt-1 text-xs text-amber-400">The file has no image the server takes.</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onDone(null)}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-soft"
          >
            Keep All the Server&apos;s
          </button>
          <button
            type="button"
            onClick={() => onDone(choices)}
            className="rounded-lg bg-accent text-accent-ink px-4 py-2 text-sm hover:bg-accent-hover"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
