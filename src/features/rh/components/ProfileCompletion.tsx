import type { FieldMap, EmployeeFieldValue } from '@/types/rh';
import { getProfileCompletionBadge } from '../lib/field-format';

type Props = {
  pct:         number;
  fieldMap:    FieldMap;
  fieldValues: Record<string, EmployeeFieldValue>;
};

function sectionPct(
  sectionName: string,
  fieldMap:    FieldMap,
  fieldValues: Record<string, EmployeeFieldValue>
): number {
  const entries = Object.entries(fieldMap.fields).filter(
    ([, entry]) => entry.section === sectionName
  );
  if (!entries.length) return 100;

  const filled = entries.filter(([key]) => {
    const fv = fieldValues[key];
    if (!fv) return false;
    return (
      fv.value_text != null ||
      fv.value_number != null ||
      fv.value_boolean != null ||
      fv.value_date != null ||
      (Array.isArray(fv.value_json) && fv.value_json.length > 0)
    );
  }).length;

  return Math.round((filled / entries.length) * 100);
}

const SECTION_LABELS: Record<string, string> = {
  identity:        'Identidade',
  contact:         'Contato',
  address:         'Endereço',
  documents:       'Documentos',
  employment:      'Emprego',
  compensation:    'Remuneração',
  banking:         'Bancário',
  health:          'Saúde',
  emergency:       'Emergência',
  uniforms:        'Uniformes',
  onboarding:      'Onboarding',
  diversity:       'Diversidade',
};

export function ProfileCompletion({ pct, fieldMap, fieldValues }: Props) {
  const { label, color } = getProfileCompletionBadge(pct);

  const sections = [
    ...new Set(Object.values(fieldMap.fields).map((f) => f.section)),
  ];

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-700">Perfil completo</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>
          {label}
        </span>
      </div>

      <div className="relative h-2 rounded-full bg-gray-100 overflow-hidden mb-4">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-violet-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-2xl font-bold text-gray-900 mb-4">{pct}%</p>

      <div className="space-y-2">
        {sections.map((sec) => {
          const sp = sectionPct(sec, fieldMap, fieldValues);
          return (
            <div key={sec} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 shrink-0 truncate">
                {SECTION_LABELS[sec] ?? sec}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    sp >= 80 ? 'bg-green-400' : sp >= 60 ? 'bg-yellow-400' : 'bg-red-400'
                  }`}
                  style={{ width: `${sp}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 w-8 text-right shrink-0">{sp}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
