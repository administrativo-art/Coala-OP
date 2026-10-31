import type { FieldMapEntry } from "@/types/rh";

/** Campos aposentados do catálogo; nenhuma tela ou rota deve listá-los ou gravá-los. */
export const RETIRED_FIELD_KEYS: ReadonlySet<string> = new Set([
  "employee.emergency_medical",
  "employee.dependent_name",
  "employee.dependent_relation",
  "employee.dependent_cpf",
  "employee.dependent_rg",
  "employee.family_salary_end_1",
  "employee.family_salary_birth_1",
  "employee.family_salary_name_1",
]);

export function withoutRetiredFields<T extends Record<string, FieldMapEntry>>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !RETIRED_FIELD_KEYS.has(key))) as T;
}
