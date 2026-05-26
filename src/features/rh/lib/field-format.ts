import type { EmployeeFieldValue, FieldType, RhRole } from '@/types/rh';
import { maskSensitiveText, canViewField } from '@/types/rh';
import type { Timestamp } from 'firebase/firestore';

export function formatFieldValue(
  fv: EmployeeFieldValue | undefined,
  type: FieldType,
  role: RhRole,
  fieldKey: string
): string {
  if (!fv) return '—';

  // Mascaramento de CPF para employee
  if (fieldKey === 'employee.cpf' && fv.value_text) {
    return maskSensitiveText(fv.value_text, role);
  }

  if (type === 'date' && fv.value_date) {
    const d = (fv.value_date as unknown as Timestamp).toDate?.() ?? new Date(fv.value_date as unknown as string);
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
  }

  if (type === 'currency' && fv.value_number != null) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fv.value_number / 100);
  }

  if (type === 'number' && fv.value_number != null) {
    return String(fv.value_number);
  }

  if (type === 'boolean') {
    if (fv.value_boolean == null) return '—';
    return fv.value_boolean ? 'Sim' : 'Não';
  }

  if (type === 'multi_select' && Array.isArray(fv.value_json)) {
    return (fv.value_json as string[]).join(', ') || '—';
  }

  return fv.value_text ?? fv.value_text ?? '—';
}

export function getProfileCompletionBadge(pct: number): {
  label: string;
  color: string;
} {
  if (pct >= 80) return { label: 'Completo',    color: 'bg-green-100 text-green-800' };
  if (pct >= 60) return { label: 'Em progresso', color: 'bg-orange-100 text-orange-800' };
  if (pct >= 40) return { label: 'Parcial',      color: 'bg-yellow-100 text-yellow-800' };
  return           { label: 'Incompleto',         color: 'bg-red-100 text-red-800' };
}

export function getStatusBadge(status: string): { label: string; color: string } {
  if (status === 'active')     return { label: 'Ativo',      color: 'bg-green-100 text-green-800' };
  if (status === 'inactive')   return { label: 'Inativo',    color: 'bg-gray-100 text-gray-700' };
  if (status === 'terminated') return { label: 'Desligado',  color: 'bg-red-100 text-red-800' };
  return { label: status, color: 'bg-gray-100 text-gray-500' };
}
