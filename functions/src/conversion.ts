/**
 * Conversão de unidades — cópia autocontida de src/lib/conversion.ts.
 * O pacote functions/ não compartilha código com o app Next, então a tabela
 * de unidades e o convertValue são replicados aqui. Mantenha em sincronia.
 */

type UnitTable = Record<string, Record<string, number>>;

const units: UnitTable = {
  Volume: { l: 1, ml: 0.001, bag: 1 },
  Massa: { kg: 1, g: 0.001, mg: 0.000001 },
  Unidade: { un: 1, unidade: 1, pacote: 1, bag: 1, caixa: 1 },
  Embalagem: { un: 1, unidade: 1, pacote: 1, bag: 1, caixa: 1 },
  Vestimenta: { 'peça': 1, un: 1, unidade: 1 },
};

export function convertValue(value: number, fromUnit: string, toUnit: string, category: string): number {
  if (value === 0) return 0;
  if (!value || !fromUnit || !toUnit || !category) return 0;
  if (fromUnit.toLowerCase() === toUnit.toLowerCase()) return value;

  const categoryUnits = units[category];
  if (!categoryUnits) throw new Error(`Categoria inválida: ${category}`);

  const findUnitKey = (unit: string) => {
    if (!unit) return undefined;
    const lower = unit.toLowerCase();
    if (categoryUnits[unit] !== undefined) return unit;
    return Object.keys(categoryUnits).find(k => k.toLowerCase() === lower);
  };

  const fromKey = findUnitKey(fromUnit);
  const toKey = findUnitKey(toUnit);
  if (!fromKey || !toKey) {
    throw new Error(`Unidade inválida para ${category}. De: ${fromUnit}, Para: ${toUnit}`);
  }

  const valueInBase = value * categoryUnits[fromKey];
  return valueInBase / categoryUnits[toKey];
}
