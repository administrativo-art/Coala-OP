export type EntityEmailPurpose = 'onboarding' | 'termination' | 'aso' | 'vacation';

export const ENTITY_EMAIL_PURPOSES: ReadonlyArray<readonly [EntityEmailPurpose, string]> = [
  ['onboarding', 'Integração'],
  ['termination', 'Desligamento'],
  ['aso', 'ASO'],
  ['vacation', 'Férias'],
];

export const ENTITY_SIGNATORY_SCOPES = [
  { value: 'entity', label: 'Somente este CNPJ', long: 'Somente este CNPJ' },
  { value: 'cnpj_root', label: 'Matriz e filiais', long: 'Matriz e filiais do mesmo CNPJ-base' },
] as const;

export const ENTITY_ICMS_OPTIONS = [
  { value: 'nao_informado', label: 'Não inf.', long: 'Não informado' },
  { value: 'sim', label: 'Sim', long: 'Sim' },
  { value: 'nao', label: 'Não', long: 'Não' },
] as const;

export const ENTITY_IE_STATUS_OPTIONS = [
  { value: 'nao_consultada', label: 'Não consult.', long: 'Não consultada' },
  { value: 'nao_informado', label: 'Não inf.', long: 'Não informado' },
  { value: 'ativa', label: 'Ativa', long: 'Ativa' },
  { value: 'inativa', label: 'Inativa', long: 'Inativa' },
  { value: 'suspensa', label: 'Suspensa', long: 'Suspensa' },
  { value: 'baixada', label: 'Baixada', long: 'Baixada' },
] as const;

const lookupLong = (options: ReadonlyArray<{ value: string; long: string }>, value?: string) =>
  options.find((option) => option.value === value)?.long ?? '';

export const icmsLabel = (value?: string) => lookupLong(ENTITY_ICMS_OPTIONS, value);
export const ieStatusLabel = (value?: string) => lookupLong(ENTITY_IE_STATUS_OPTIONS, value);
export const signatoryScopeLabel = (value?: string) => lookupLong(ENTITY_SIGNATORY_SCOPES, value ?? 'entity');
export const purposeLabel = (value: string) => ENTITY_EMAIL_PURPOSES.find(([id]) => id === value)?.[1] ?? value;

/** Situação cadastral que exige confirmação antes de salvar (mesma regra do envio). */
export const isAttentionCadastralStatus = (status?: string) => /baixad|inapt|suspens/i.test(status ?? '');

/** Converte `YYYY-MM-DD` ou ISO em `DD/MM/YYYY`; devolve o texto original quando não for data. */
export function formatEntityDate(value?: string): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function formatEntityDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
