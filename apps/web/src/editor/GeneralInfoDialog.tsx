// Map > General Info dialog — port of MainWindowMapMenu.cpp:130-158.
// Edits Author / LUG / Event / Date / Comment.

import { useId, useState } from 'react';
import type * as Y from 'yjs';
import type { BbmMap } from '@cld/model';
import { setGeneralInfo } from './mutations';
import { useEscape } from './useEscape';

interface Props {
  map: BbmMap;
  doc: Y.Doc;
  onClose: () => void;
}

export function GeneralInfoDialog({ map, doc, onClose }: Props) {
  useEscape(onClose);
  const uid = useId();
  const [author, setAuthor] = useState(map.author);
  const [lug, setLug] = useState(map.lug);
  const [event, setEventValue] = useState(map.event);
  const [day, setDay] = useState(map.date.day);
  const [month, setMonth] = useState(map.date.month);
  const [year, setYear] = useState(map.date.year);
  const [comment, setComment] = useState(map.comment);

  function commit() {
    setGeneralInfo(doc, {
      author,
      lug,
      event,
      comment,
      date: { day, month, year },
    });
    onClose();
  }

  return (
    <div
      role="dialog" aria-label="General info"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-lg rounded-lg border border-line bg-panel p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">General info</h2>
        <div className="mt-4 grid grid-cols-[7rem_1fr] gap-2 text-sm">
          <label className="self-center" htmlFor={`${uid}-author`}>Author:</label>
          <input
            id={`${uid}-author`}
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="rounded-lg border border-border bg-soft px-2 py-1"
          />
          <label className="self-center" htmlFor={`${uid}-lug`}>LUG:</label>
          <input
            id={`${uid}-lug`}
            value={lug}
            onChange={(e) => setLug(e.target.value)}
            className="rounded-lg border border-border bg-soft px-2 py-1"
          />
          <label className="self-center" htmlFor={`${uid}-event`}>Event:</label>
          <input
            id={`${uid}-event`}
            value={event}
            onChange={(e) => setEventValue(e.target.value)}
            className="rounded-lg border border-border bg-soft px-2 py-1"
          />
          <span className="self-center" id={`${uid}-date`}>Date:</span>
          <div className="flex items-center gap-1" role="group" aria-labelledby={`${uid}-date`}>
            <NumberInput value={day} setValue={setDay} min={1} max={31} placeholder="DD" label="Day" />
            <span className="text-muted">/</span>
            <NumberInput value={month} setValue={setMonth} min={1} max={12} placeholder="MM" label="Month" />
            <span className="text-muted">/</span>
            <NumberInput value={year} setValue={setYear} min={1900} max={2999} placeholder="YYYY" label="Year" />
          </div>
          <label className="self-start" htmlFor={`${uid}-comment`}>Comment:</label>
          <textarea
            id={`${uid}-comment`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            className="rounded-lg border border-border bg-soft px-2 py-1"
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1 text-sm hover:bg-soft"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="rounded-lg bg-accent text-accent-ink px-3 py-1 text-sm hover:bg-accent-hover"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberInput({
  value,
  setValue,
  min,
  max,
  placeholder,
  label,
}: {
  value: number;
  setValue: (v: number) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  label: string;
}) {
  return (
    <input
      type="number"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n)) setValue(n);
      }}
      className="w-16 rounded-lg border border-border bg-soft px-2 py-1"
    />
  );
}
