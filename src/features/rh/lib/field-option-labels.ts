const FIELD_OPTION_LABELS: Record<string, Record<string, string>> = {
  'employee.pix_key_type': {
    cpf: 'CPF',
    cnpj: 'CNPJ',
    phone: 'Celular',
    email: 'E-mail',
    random: 'Chave aleatória',
  },
};

export function formatFieldOptionLabel(fieldKey: string, option: string): string {
  return FIELD_OPTION_LABELS[fieldKey]?.[option] ?? option;
}

export function formatPixKeyTypeLabel(option: string): string {
  return formatFieldOptionLabel('employee.pix_key_type', option);
}
