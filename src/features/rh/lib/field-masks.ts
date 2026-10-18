/**
 * Máscaras de entrada por campo da ficha. O campo exibe o valor formatado, mas aceita
 * só os caracteres do formato e grava o valor normalizado (somente dígitos no CPF),
 * igual ao que já está persistido.
 */
export type FieldMask = {
  /** Valor normalizado a partir do que foi digitado ou colado. */
  normalize: (raw: string) => string;
  /** Valor exibido no campo. */
  format: (normalized: string) => string;
  /** Erro de formato para o valor normalizado; vazio é tratado pela obrigatoriedade. */
  validate: (normalized: string) => string | null;
  inputMode: 'numeric' | 'text';
  placeholder: string;
};

function digits(raw: string, max: number) {
  return raw.replace(/\D/g, '').slice(0, max);
}

const cpfMask: FieldMask = {
  normalize: (raw) => digits(raw, 11),
  format: (value) => {
    const d = digits(value, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  },
  validate: (value) => (value && value.length !== 11 ? 'O CPF tem 11 dígitos.' : null),
  inputMode: 'numeric',
  placeholder: '000.000.000-00',
};

const cepMask: FieldMask = {
  normalize: (raw) => digits(raw, 8),
  format: (value) => {
    const d = digits(value, 8);
    return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
  },
  validate: (value) => (value && value.length !== 8 ? 'O CEP tem 8 dígitos.' : null),
  inputMode: 'numeric',
  placeholder: '00000-000',
};

const FIELD_MASKS: Record<string, FieldMask> = {
  'employee.cpf': cpfMask,
  'employee.address_zipcode': cepMask,
};

export function getFieldMask(fieldKey: string): FieldMask | null {
  return FIELD_MASKS[fieldKey] ?? null;
}
