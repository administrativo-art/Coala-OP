
import { type ConversionUnits, type UnitCategory, unitCategories, packageTypes, type PackageType } from "@/types";

export const units: ConversionUnits = {
  Volume: {
    'l': 1,
    'ml': 0.001,
    'bag': 1, // Default bag = 1L (override by packageSize)
  },
  Massa: {
    'kg': 1,
    'g': 0.001,
    'mg': 0.000001,
  },
  Unidade: {
    'un': 1,
    'pacote': 1,
    'bag': 1,
    'caixa': 1,
  },
  Embalagem: {
      'un': 1,
      'pacote': 1,
      'bag': 1,
      'caixa': 1,
  },
  Vestimenta: {
      'peça': 1,
      'un': 1,
  }
};

const measurementUnitAliases: Record<string, string> = {
  unidade: 'un',
};

export function normalizeMeasurementUnit(unit: string | null | undefined): string {
  const trimmedUnit = String(unit ?? '').trim();
  return measurementUnitAliases[trimmedUnit.toLowerCase()] ?? trimmedUnit;
}

export const getUnitsForCategory = (category: UnitCategory): string[] => {
  return Object.keys(units[category] || {});
};

export { unitCategories, packageTypes, type UnitCategory, type PackageType };

export function convertValue(value: number, fromUnit: string, toUnit: string, category: UnitCategory): number {
  if (value === 0) return 0;
  if (!value || !fromUnit || !toUnit || !category) return 0;

  const normalizedFromUnit = normalizeMeasurementUnit(fromUnit);
  const normalizedToUnit = normalizeMeasurementUnit(toUnit);
  
  if (normalizedFromUnit.toLowerCase() === normalizedToUnit.toLowerCase()) {
    return value;
  }

  const categoryUnits = units[category];
  if (!categoryUnits) {
    throw new Error(`Categoria inválida fornecida: ${category}`);
  }

  const findUnitKey = (unit: string) => {
    if (!unit) return undefined;
    const normalizedUnit = normalizeMeasurementUnit(unit);
    const lowerCaseUnit = normalizedUnit.toLowerCase();
    // Exact match first
    if(categoryUnits[normalizedUnit]) return normalizedUnit;
    // Fallback to case-insensitive
    return Object.keys(categoryUnits).find(key => key.toLowerCase() === lowerCaseUnit);
  }

  const fromUnitKey = findUnitKey(normalizedFromUnit);
  const toUnitKey = findUnitKey(normalizedToUnit);

  if (!fromUnitKey || !toUnitKey) {
    throw new Error(`Unidade inválida para a categoria ${category}. De: ${fromUnit}, Para: ${toUnit}`);
  }
  
  const valueInBaseUnit = value * categoryUnits[fromUnitKey];
  const convertedValue = valueInBaseUnit / categoryUnits[toUnitKey];
  
  return convertedValue;
}

export function formatQuantity(quantity: number, unit: string): string {
    if (unit.toLowerCase() === 'un' || unit.toLowerCase() === 'pacote(s)' || unit.toLowerCase() === 'pacotes') {
        return quantity.toLocaleString('pt-BR');
    }
    
    // Mostra decimais se não for um número inteiro
    if (quantity % 1 !== 0) {
        return quantity.toLocaleString('pt-BR', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 3
        });
    }

    return quantity.toLocaleString('pt-BR');
}
