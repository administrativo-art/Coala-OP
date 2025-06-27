"use client"
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

export type Kiosk = {
    id: string;
    name: string;
}

export type LotEntry = {
  id: string;
  productName: string;
  barcode: string;
  lotNumber: string;
  expiryDate: string; // ISO String
  kioskId: string;
  quantity: number;
};

export type PermissionSet = {
    products: { add: boolean; edit: boolean; delete: boolean };
    lots: { add: boolean; edit: boolean; move: boolean; delete: boolean };
    users: { add: boolean; edit: boolean; delete: boolean };
    kiosks: { add: boolean; delete: boolean };
    predefinedLists: { add: boolean; edit: boolean; delete: boolean };
};

export type Profile = {
    id: string;
    name: string;
    isDefaultAdmin?: boolean;
    permissions: PermissionSet;
}

export type User = {
    id: string;
    username: string;
    password?: string; // Should be hashed in a real app
    profileId: string;
    kioskId?: string;
};

export type PredefinedConversionItem = {
  id: string;
  productId: string;
  fromUnit: string;
  toUnit: string;
};

export type PredefinedList = {
  id: string;
  name: string;
  items: PredefinedConversionItem[];
};
