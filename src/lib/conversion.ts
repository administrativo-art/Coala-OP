import { type ConversionUnits, type UnitCategory } from "@/types";

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
  Comprimento: {
    'm': 1,
    'cm': 0.01,
    'mm': 0.001,
  }
};

export const getUnitsForCategory = (category: UnitCategory): string[] => {
  return Object.keys(units[category]);
};

export function convertValue(value: number, fromUnit: string, toUnit: string, category: UnitCategory): number {
  if (!value || !fromUnit || !toUnit || !category) return 0;

  const categoryUnits = units[category];
  if (!categoryUnits[fromUnit] || !categoryUnits[toUnit]) {
    console.error(`Invalid unit provided for category ${category}. From: ${fromUnit}, To: ${toUnit}`);
    return 0;
  }
  
  const valueInBaseUnit = value * categoryUnits[fromUnit];
  const convertedValue = valueInBaseUnit / categoryUnits[toUnit];
  
  return convertedValue;
}
