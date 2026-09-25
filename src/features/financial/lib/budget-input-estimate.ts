export type InputEstimateBasis = {
  baseProductId: string;
  name: string;
  unit: string;
  monthlyConsumption: number;
  stockNow: number;
  inboundBeforeMonth: number;
  inboundDuringMonth: number;
  daysUntilMonth: number;
  targetMonthDays: number;
  closingStockDays: number;
  pricePerUnit: number;
};

export function estimateInputPurchase(input: InputEstimateBasis) {
  const dailyConsumption = input.monthlyConsumption / input.targetMonthDays;
  const openingStockQuantity = Math.max(0,
    input.stockNow + input.inboundBeforeMonth - dailyConsumption * input.daysUntilMonth);
  const closingStockQuantity = dailyConsumption * input.closingStockDays;
  const additionalPurchaseQuantity = Math.max(0,
    input.monthlyConsumption + closingStockQuantity - openingStockQuantity - input.inboundDuringMonth);
  return {
    baseProductId: input.baseProductId,
    name: input.name,
    unit: input.unit,
    forecastQuantity: input.monthlyConsumption,
    openingStockQuantity,
    inboundQuantity: input.inboundDuringMonth,
    closingStockQuantity,
    additionalPurchaseQuantity,
    averagePriceCentsPerUnit: Math.round(input.pricePerUnit * 100),
    additionalPurchaseAmountCents: Math.round(additionalPurchaseQuantity * input.pricePerUnit * 100),
  };
}
