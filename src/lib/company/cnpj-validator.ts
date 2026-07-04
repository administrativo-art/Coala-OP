export type CnpjValidationResult = {
  valid: boolean;
  clean: string;
  formatted: string;
  message?: string;
};

function onlyDigits(value: string) {
  return String(value ?? '').replace(/\D/g, '');
}

function calculateDigit(base: string, weights: number[]) {
  const sum = weights.reduce((acc, weight, index) => acc + Number(base[index]) * weight, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export class CnpjValidator {
  static clean(value: string) {
    return onlyDigits(value);
  }

  static format(value: string) {
    const cnpj = this.clean(value);
    if (cnpj.length !== 14) return value;
    return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
  }

  static validate(value: string): CnpjValidationResult {
    const clean = this.clean(value);
    const formatted = this.format(clean);
    if (clean.length !== 14) {
      return {
        valid: false,
        clean,
        formatted,
        message: 'CNPJ inválido. Verifique os números informados.',
      };
    }

    if (/^(\d)\1{13}$/.test(clean)) {
      return {
        valid: false,
        clean,
        formatted,
        message: 'CNPJ inválido. Verifique os números informados.',
      };
    }

    const firstDigit = calculateDigit(clean.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const secondDigit = calculateDigit(clean.slice(0, 12) + firstDigit, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

    const valid = clean.endsWith(`${firstDigit}${secondDigit}`);
    return {
      valid,
      clean,
      formatted,
      message: valid ? undefined : 'CNPJ inválido. Verifique os números informados.',
    };
  }
}
