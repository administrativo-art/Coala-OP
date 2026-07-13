'use client';

import { useState } from 'react';
import type { FieldMapEntry, EmployeeFieldValue, RhRole } from '@/types/rh';
import { FieldValue } from './FieldValue';

type SectionEntry = {
  key:   string;
  entry: FieldMapEntry;
  fv?:   EmployeeFieldValue;
  editable?: boolean;
};

type Props = {
  title:   string;
  fields:  SectionEntry[];
  role:    RhRole;
  onEdit?: (key: string) => void;
};

export function SectionCard({ title, fields, role, onEdit }: Props) {
  const [expanded, setExpanded] = useState(true);

  const visible = fields;
  if (!visible.length) return null;

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {expanded && (
        <div className="divide-y divide-gray-50 px-5 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
            {visible.map(({ key, entry, fv, editable }) => (
              <div key={key} className="py-3 group">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-500 mb-1 truncate">
                      {entry.label}
                    </p>
                    <FieldValue fv={fv} type={entry.type} role={role} fieldKey={key} />
                  </div>

                  {onEdit && editable === true ? (
                    <button
                      type="button"
                      onClick={() => onEdit(key)}
                      className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-all mt-0.5"
                      title={`Editar ${entry.label}`}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </button>
                  ) : null}
                </div>

                {entry.help_text && (
                  <p className="text-[10px] text-gray-400 mt-1">{entry.help_text}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
