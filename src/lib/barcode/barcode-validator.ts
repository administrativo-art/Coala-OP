import type { BarcodeFormat } from './product-lookup-types';

export type BarcodeValidationResult =
  | { ok: true; code: string; format: BarcodeFormat }
  | { ok: false; code: string; error: string };

const FORMAT_BY_LENGTH: Record<number, BarcodeFormat> = {
  8: 'ean_8',
  12: 'upc_a',
  13: 'ean_13',
  14: 'gtin_14',
};

export class BarcodeValidator {
  static normalize(value: string) {
    return String(value ?? '').replace(/\D/g, '');
  }

  static validate(value: string): BarcodeValidationResult {
    const code = BarcodeValidator.normalize(value);
    const format = FORMAT_BY_LENGTH[code.length];
    if (!format) {
      return {
        ok: false,
        code,
        error: 'Informe um codigo EAN-8, EAN-13, UPC-A ou GTIN-14.',
      };
    }

    if (!BarcodeValidator.hasValidCheckDigit(code)) {
      return {
        ok: false,
        code,
        error: 'Codigo de barras invalido: digito verificador nao confere.',
      };
    }

    return { ok: true, code, format };
  }

  static hasValidCheckDigit(code: string) {
    if (!/^\d+$/.test(code) || code.length < 2) return false;

    const digits = code.split('').map(Number);
    const checkDigit = digits.pop();
    if (checkDigit === undefined) return false;

    const sum = digits
      .reverse()
      .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
    const calculated = (10 - (sum % 10)) % 10;
    return calculated === checkDigit;
  }
}
