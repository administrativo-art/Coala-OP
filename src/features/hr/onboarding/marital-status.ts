export const ONBOARDING_MARITAL_STATUSES = [
  'Solteiro(a)',
  'Casado(a)',
  'Divorciado(a)',
  'Viúvo(a)',
  'União estável',
] as const;

export function maritalStatusIsInformed(value: unknown) {
  return typeof value === 'string'
    && Boolean(value.trim())
    && value.trim().toLocaleLowerCase('pt-BR') !== 'não informado';
}
