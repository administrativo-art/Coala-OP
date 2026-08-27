import type { EmployeeFieldValue, FieldType, RhRole } from '@/types/rh';
import { formatFieldValue } from '../lib/field-format';
import { formatFieldOptionLabel } from '../lib/field-option-labels';

type Props = {
  fv?:      EmployeeFieldValue;
  type:     FieldType;
  role:     RhRole;
  fieldKey: string;
};

export function FieldValue({ fv, type, role, fieldKey }: Props) {
  const text = formatFieldValue(fv, type, role, fieldKey);

  if (text === '—') {
    return <span className="text-gray-400 italic text-sm">Não informado</span>;
  }

  if (type === 'boolean') {
    const isTrue = fv?.value_boolean;
    return (
      <span className={`inline-flex items-center gap-1 text-sm font-medium ${isTrue ? 'text-blue-700' : 'text-gray-500'}`}>
        {isTrue ? (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        )}
        {text}
      </span>
    );
  }

  if (type === 'multi_select' && Array.isArray(fv?.value_json)) {
    return (
      <div className="flex flex-wrap gap-1">
        {(fv!.value_json as string[]).map((v) => (
          <span key={v} className="px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            {formatFieldOptionLabel(fieldKey, v)}
          </span>
        ))}
      </div>
    );
  }

  return <span className="text-sm text-gray-900">{text}</span>;
}
