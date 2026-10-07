import { type UnitCategory } from '@/types';

export const CATEGORY_SYMBOLS: Record<UnitCategory, string> = { Massa: 'kg', Volume: 'l', Unidade: 'un', Embalagem: 'cx', Vestimenta: 'pç' };

const UNIT_NAMES: Record<string, string> = { un: 'unidade', kg: 'quilograma', g: 'grama', mg: 'miligrama', l: 'litro', ml: 'mililitro', bag: 'bag', pacote: 'pacote', caixa: 'caixa', peça: 'peça' };
const UNIT_SYMBOLS: Record<string, string> = { pacote: 'pct', caixa: 'cx', peça: 'pç' };

export function unitSymbol(unit: string) {
  return UNIT_SYMBOLS[unit] ?? unit;
}

export function unitFullName(unit: string) {
  return UNIT_NAMES[unit] ?? unit;
}
