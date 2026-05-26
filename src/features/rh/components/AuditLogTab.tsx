'use client';

import type { AuditLogEntry, FieldMap } from '@/types/rh';
import type { Timestamp } from 'firebase/firestore';

type Props = {
  entries:  AuditLogEntry[];
  fieldMap: FieldMap;
  loading:  boolean;
};

function formatDate(ts: Timestamp | unknown): string {
  try {
    const d = (ts as Timestamp).toDate?.() ?? new Date(ts as string);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch {
    return '—';
  }
}

function formatValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.join(', ') || '—';
  return String(v);
}

export function AuditLogTab({ entries, fieldMap, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  if (!entries.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <svg className="w-10 h-10 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p className="text-sm">Nenhuma alteração registrada.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry, i) => {
        const fieldLabel = fieldMap.fields[entry.field_key]?.label ?? entry.field_key;
        return (
          <div key={i} className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{fieldLabel}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                  <span className="line-through text-red-400">{formatValue(entry.old_value)}</span>
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  <span className="text-green-600 font-medium">{formatValue(entry.new_value)}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] text-gray-400">{formatDate(entry.changed_at)}</p>
                <span className={`text-[10px] font-medium mt-0.5 inline-block px-1.5 py-0.5 rounded ${
                  entry.source === 'bizneo_sync' ? 'bg-blue-50 text-blue-600' :
                  entry.source === 'cf_automation' ? 'bg-purple-50 text-purple-600' :
                  'bg-gray-50 text-gray-500'
                }`}>
                  {entry.source === 'bizneo_sync' ? 'Sync' :
                   entry.source === 'cf_automation' ? 'Auto' : 'Manual'}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
