export const CONTRACTUAL_FIELDS = ['employmentRelationshipType', 'admissionDate', 'employerUnitId', 'employerCnpj', 'employerUnitName',
  'unitId', 'jobRoleId', 'jobRoleName', 'jobFunctionIds', 'jobFunctionNames'] as const;

export const CONTRACTUAL_FIELD_LABELS: Record<string, string> = {
  employmentRelationshipType: 'Tipo de vínculo', admissionDate: 'Admissão', employerUnitId: 'Empregador',
  employerCnpj: 'CNPJ do empregador', unitId: 'Unidade financeira', jobRoleId: 'Cargo', jobRoleName: 'Cargo',
  jobFunctionIds: 'Funções', jobFunctionNames: 'Funções',
};

export function contractAuditValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) return value.map(contractAuditValue);
  return value;
}

export function contractualDiff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const result = Object.fromEntries(CONTRACTUAL_FIELDS.flatMap((field) => {
    if (!(field in after)) return [];
    const oldValue = contractAuditValue(before[field]);
    const newValue = contractAuditValue(after[field]);
    const comparable = (value: unknown) => Array.isArray(value) ? [...value].sort() : value;
    return JSON.stringify(comparable(oldValue)) === JSON.stringify(comparable(newValue)) ? [] : [[field, { before: oldValue, after: newValue }]];
  })) as Record<string, { before: unknown; after: unknown }>;
  return Object.keys(result).some((key) => !['jobRoleName', 'jobFunctionNames', 'employerUnitName'].includes(key)) ? result : {};
}
