// Map > General Info dialog — port of MainWindowMapMenu.cpp:130-158.
// Edits Author / LUG / Event / Date / Comment.

import { useState } from 'react';
import type * as Y from 'yjs';
import type { BbmMap } from '@cld/model';
import { setGeneralInfo } from './mutations';

interface Props {
  map: BbmMap;
  doc: Y.Doc;
  onClose: () => void;
}

export function GeneralInfoDialog({ map, doc, onClose }: Props) {
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
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[32rem] rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">General info</h2>
        <div className="mt-4 grid grid-cols-[7rem_1fr] gap-2 text-sm">
          <label className="self-center">Author:</label>
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
          />
          <label className="self-center">LUG:</label>
          <input
            value={lug}
            onChange={(e) => setLug(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
          />
          <label className="self-center">Event:</label>
          <input
            value={event}
            onChange={(e) => setEventValue(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
          />
          <label className="self-center">Date:</label>
          <div className="flex items-center gap-1">
            <NumberInput value={day} setValue={setDay} min={1} max={31} placeholder="DD" />
            <span className="text-neutral-500">/</span>
            <NumberInput value={month} setValue={setMonth} min={1} max={12} placeholder="MM" />
            <span className="text-neutral-500">/</span>
            <NumberInput value={year} setValue={setYear} min={1900} max={2999} placeholder="YYYY" />
          </div>
          <label className="self-start">Comment:</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
          />
        </div>
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

function NumberInput({
  value,
  setValue,
  min,
  max,
  placeholder,
}: {
  value: number;
  setValue: (v: number) => void;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n)) setValue(n);
      }}
      className="w-16 rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
    />
  );
}
