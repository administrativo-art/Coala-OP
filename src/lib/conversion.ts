
import { type ConversionUnits, type UnitCategory, unitCategories } from "@/types";

export const units: ConversionUnits = {
  Volume: {
    'L': 1,
    'mL': 0.001,
  },
  Massa: {
    'kg': 1,
    'g': 0.001,
    'mg': 0.000001,
  },
  Unidade: {
    'un': 1,
    'pacote': 1,
  },
  Embalagem: {
      'un': 1,
      'pacote': 1,
  }
};

export const getUnitsForCategory = (category: UnitCategory): string[] => {
  return Object.keys(units[category] || {});
};

export { unitCategories, type UnitCategory };

export function convertValue(value: number, fromUnit: string, toUnit: string, category: UnitCategory): number {
  if (value === 0) return 0;
  if (!value || !fromUnit || !toUnit || !category) return 0;
  
  if (fromUnit.toLowerCase() === toUnit.toLowerCase()) {
    return value;
  }

  const categoryUnits = units[category];
  if (!categoryUnits) {
    throw new Error(`Categoria inválida fornecida: ${category}`);
  }

  const findUnitKey = (unit: string) => {
    if (!unit) return undefined;
    const lowerCaseUnit = unit.toLowerCase();
    // Exact match first
    if(categoryUnits[unit]) return unit;
    // Fallback to case-insensitive
    return Object.keys(categoryUnits).find(key => key.toLowerCase() === lowerCaseUnit);
  }

  const fromUnitKey = findUnitKey(fromUnit);
  const toUnitKey = findUnitKey(toUnit);

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
