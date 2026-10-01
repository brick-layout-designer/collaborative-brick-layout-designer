// A part category: one already in the catalog, or a new one typed in.

import { useState } from 'react';

export function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  // Track whether the user has explicitly chosen "type your own" mode.
  // We can't infer this from value alone: an empty string or an unrecognised
  // value both look like "custom" but the initial render should show the
  // select, not the text input.
  const [customMode, setCustomMode] = useState(false);

  function onSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === '__custom__') {
      setCustomMode(true);
      onChange('');
    } else {
      setCustomMode(false);
      onChange(v);
    }
  }

  return (
    <div className="block space-y-1">
      <span className="block text-muted">Category</span>
      {!customMode ? (
        <select
          value={categories.includes(value) ? value : (categories[0] ?? '')}
          onChange={onSelect}
          className="w-full rounded-lg border border-border bg-soft px-3 py-2 text-sm"
        >
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
          <option value="__custom__">— type your own —</option>
        </select>
      ) : (
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="My Category"
            autoFocus
            className="flex-1 rounded-lg border border-border bg-soft px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => { setCustomMode(false); onChange(categories[0] ?? 'Custom'); }}
            className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-soft"
            title="Pick from list"
          >
            ↩
          </button>
        </div>
      )}
    </div>
  );
}
