
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
  }
};

export const getUnitsForCategory = (category: UnitCategory): string[] => {
  return Object.keys(units[category] || {});
};

export { unitCategories };

export function convertValue(value: number, fromUnit: string, toUnit: string, category: UnitCategory): number {
  if (!value || !fromUnit || !toUnit || !category) return 0;
  
  if (fromUnit.toLowerCase() === toUnit.toLowerCase()) {
    return value;
  }

  const categoryUnits = units[category];
  if (!categoryUnits) {
    console.error(`Invalid category provided: ${category}`);
    return 0;
  }

  const findUnitKey = (unit: string) => {
    if (!unit) return undefined;
    const lowerCaseUnit = unit.toLowerCase();
    return Object.keys(categoryUnits).find(key => key.toLowerCase() === lowerCaseUnit);
  }

  const fromUnitKey = findUnitKey(fromUnit);
  const toUnitKey = findUnitKey(toUnit);

  if (!fromUnitKey || !toUnitKey) {
    console.error(`Invalid unit provided for category ${category}. From: ${fromUnit}, To: ${toUnit}`);
    return 0;
  }
  
  const valueInBaseUnit = value * categoryUnits[fromUnitKey];
  const convertedValue = valueInBaseUnit / categoryUnits[toUnitKey];
  
  return convertedValue;
}
