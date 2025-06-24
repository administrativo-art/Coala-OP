export const unitCategories = ["Volume", "Massa", "Comprimento"] as const;

export type UnitCategory = (typeof unitCategories)[number];

export type Product = {
  id: string;
  baseName: string;
  category: UnitCategory;
  packageSize: number;
  unit: string;
};

export type ConversionUnits = {
  [key in UnitCategory]: { [unit: string]: number };
};

export type Location = {
  id: string;
  name: string;
};

export type LotEntry = {
  id: string;
  productName: string;
  barcode: string;
  lotNumber: string;
  expiryDate: string; // ISO String
  locationId: string;
  quantity: number;
};
