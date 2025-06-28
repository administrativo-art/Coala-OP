"use client"
export const unitCategories = ["Volume", "Massa", "Comprimento", "Unidade"] as const;

export type UnitCategory = (typeof unitCategories)[number];

export type Product = {
  id: string;
  baseName: string;
  category: UnitCategory;
  packageSize: number;
  unit: string;
  // New fields for stock analysis
  pdfUnit?: string;
  hasPurchaseUnit?: boolean;
  purchaseUnitName?: string;
  itemsPerPurchaseUnit?: number;
  stockLevels?: { [kioskId: string]: { min: number; max: number } };
};

export type ConversionUnits = {
  [key in UnitCategory]: { [unit: string]: number };
};

export type Kiosk = {
    id: string;
    name: string;
}

export type LotEntry = {
  id:string;
  productName: string;
  barcode: string;
  lotNumber: string;
  expiryDate: string; // ISO String
  kioskId: string;
  quantity: number;
};

export type StockAnalysisResultItem = {
  productId: string;
  productName: string;
  kioskId: string;
  kioskName: string;
  currentStock: number;
  idealStock: number;
  needed: number;
  purchaseSuggestion: string;
};

export type StockAnalysisReport = {
  id: string;
  reportName: string;
  createdAt: string; // ISO String
  status: 'completed' | 'processing' | 'error';
  summary: string;
  results: StockAnalysisResultItem[];
};

export type ConsumptionAnalysisItem = {
  productId: string;
  productName: string;
  consumedQuantity: number;
  consumedPackages: number;
};

export type ConsumptionReport = {
  id: string;
  reportName: string;
  month: number;
  year: number;
  kioskId: string;
  kioskName: string;
  createdAt: string;
  status: 'completed' | 'processing' | 'error';
  results: ConsumptionAnalysisItem[];
};


export type PermissionSet = {
    products: { add: boolean; edit: boolean; delete: boolean };
    lots: { add: boolean; edit: boolean; move: boolean; delete: boolean };
    users: { add: boolean; edit: boolean; delete: boolean };
    kiosks: { add: boolean; delete: boolean };
    predefinedLists: { add: boolean; edit: boolean; delete: boolean };
    forms: { manage: boolean; fill: boolean; viewHistory: boolean };
    stockAnalysis: { upload: boolean; configure: boolean; viewHistory: boolean; deleteHistory: boolean; };
    consumptionAnalysis: { upload: boolean; viewHistory: boolean; deleteHistory: boolean; };
};

export type Profile = {
    id: string;
    name: string;
    isDefaultAdmin?: boolean;
    permissions: PermissionSet;
}

export type User = {
    id:string;
    username: string;
    password?: string; // Should be hashed in a real app
    profileId: string;
    kioskId: string;
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

export type FormQuestion = {
    id: string;
    label: string;
    type: 'yes-no' | 'text' | 'number' | 'single-choice' | 'multiple-choice';
    options?: {
        id: string; // For react hook form field array key
        value: string;
        subQuestions: FormQuestion[];
    }[];
};

export type FormSection = {
  id: string;
  name: string;
  questions: FormQuestion[];
};

export type FormTemplate = {
    id: string;
    name: string;
    sections: FormSection[];
};

export type FormAnswer = {
    questionId: string;
    questionLabel: string;
    value: string | number | string[];
};

export type FormSubmission = {
    id: string;
    templateId: string;
    templateName: string;
    userId: string;
    username: string;
    kioskId: string;
    kioskName: string;
    createdAt: string; // ISO string
    answers: FormAnswer[];
};

export const defaultGuestPermissions: PermissionSet = {
    products: { add: false, edit: false, delete: false },
    lots: { add: false, edit: false, move: false, delete: false },
    users: { add: false, edit: false, delete: false },
    kiosks: { add: false, delete: false },
    predefinedLists: { add: false, edit: false, delete: false },
    forms: { manage: false, fill: false, viewHistory: false },
    stockAnalysis: { upload: false, configure: false, viewHistory: false, deleteHistory: false },
    consumptionAnalysis: { upload: false, viewHistory: false, deleteHistory: false },
};

export const defaultUserPermissions: PermissionSet = {
    products: { add: false, edit: false, delete: false },
    lots: { add: true, edit: true, move: true, delete: false },
    users: { add: false, edit: false, delete: false },
    kiosks: { add: false, delete: false },
    predefinedLists: { add: true, edit: true, delete: false },
    forms: { manage: false, fill: true, viewHistory: true },
    stockAnalysis: { upload: true, configure: false, viewHistory: true, deleteHistory: false },
    consumptionAnalysis: { upload: true, viewHistory: true, deleteHistory: false },
};

export const defaultAdminPermissions: PermissionSet = {
    products: { add: true, edit: true, delete: true },
    lots: { add: true, edit: true, move: true, delete: true },
    users: { add: true, edit: true, delete: true },
    kiosks: { add: true, delete: true },
    predefinedLists: { add: true, edit: true, delete: true },
    forms: { manage: true, fill: true, viewHistory: true },
    stockAnalysis: { upload: true, configure: true, viewHistory: true, deleteHistory: true },
    consumptionAnalysis: { upload: true, viewHistory: true, deleteHistory: true },
};
