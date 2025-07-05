
"use client"
export const unitCategories = ["Volume", "Massa", "Comprimento", "Unidade"] as const;

export type UnitCategory = (typeof unitCategories)[number];

export type Location = {
  id: string;
  name: string; // e.g., "Prateleira A1"
  code?: string; // e.g., "PA1"
  kioskId: string;
};

export type Product = {
  id: string;
  baseName: string;
  brand?: string;
  barcode?: string;
  imageUrl?: string;
  category: UnitCategory;
  packageSize: number;
  unit: string;
  notes?: string;
  pdfUnit?: string;
  stockLevels?: { [kioskId: string]: { min: number; max: number } };
  alertThreshold?: number; // e.g., 30 days
  urgentThreshold?: number; // e.g., 7 days
  isArchived?: boolean;
};

export type ProductDefinition = {
    baseName: string;
    brand?: string;
    category: UnitCategory;
    unit: string;
}

export type ConversionUnits = {
  [key in UnitCategory]: { [unit: string]: number };
};

export type Kiosk = {
    id: string;
    name: string;
}

export type LotEntry = {
  id:string;
  productId: string;
  productName: string;
  lotNumber: string;
  expiryDate: string; // ISO String
  kioskId: string;
  quantity: number;
  imageUrl?: string;
  locationId?: string | null;
  locationName?: string | null;
  locationCode?: string | null;
};

export type MovementRecord = {
  id: string;
  productName: string;
  lotNumber: string;
  quantityMoved: number;
  fromKioskId: string;
  fromKioskName: string;
  toKioskId: string;
  toKioskName: string;
  movedByUserId: string;
  movedByUsername: string;
  movedAt: string; // ISO String
};

// A single item suggested for distribution
export type DistributionItem = {
  lotId: string;
  productId: string;
  productName: string; // Full name, e.g., Ovomaltine (250g)
  fromKioskId: string;
  quantityToMove: number; // Number of packages
  baseUnitValue: number; // e.g., 250 (for a 250g package)
  baseUnit: string; // e.g., g
  lotNumber: string;
  expiryDate: string;
};

export type StockAnalysisResultItem = {
  productId: string; // ID of the product from analysis config
  productName: string; // Base name, e.g., Ovomaltine
  kioskId: string;
  kioskName: string;
  currentStockInBaseUnit: number;
  maxStockInBaseUnit: number;
  neededInBaseUnit: number;
  statusMessage: string; // e.g., "Suggestion generated" or "Not enough stock at origin"
  isActionable: boolean;
  distributionSuggestion: DistributionItem[];
};

export type StockAnalysisReport = {
  id: string;
  reportName: string;
  displayName?: string;
  createdAt: string; // ISO String
  status: 'completed' | 'processing' | 'error';
  summary: string;
  results: StockAnalysisResultItem[];
};

export type ConsumptionAnalysisItem = {
  productId: string;
  productName: string;
  consumedQuantity: number;
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
    lots: { add: boolean; edit: boolean; move: boolean; delete: boolean; viewMovementHistory: boolean; };
    users: { add: boolean; edit: boolean; delete: boolean };
    kiosks: { add: boolean; delete: boolean };
    predefinedLists: { add: boolean; edit: boolean; delete: boolean };
    forms: { manage: boolean; fill: boolean; viewHistory: boolean; deleteHistory: boolean };
    stockAnalysis: { upload: boolean; configure: boolean; viewHistory: boolean; deleteHistory: boolean; };
    consumptionAnalysis: { upload: boolean; viewHistory: boolean; deleteHistory: boolean; };
    returns: { add: boolean; updateStatus: boolean; delete: boolean; };
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
    isRequired: boolean;
    options?: {
        id: string;
        value: string;
        subQuestions: FormQuestion[];
    }[];
};

export type FormSection = {
  id: string;
  name?: string;
  questions: FormQuestion[];
};

export type FormTemplate = {
    id: string;
    name: string;
    sections: FormSection[];
    layout: 'continuous' | 'stepped';
    submissionTitleFormat?: string;
};

export type FormAnswer = {
    questionId: string;
    questionLabel: string;
    value: string | number | string[];
    subAnswers?: FormAnswer[];
};

export type FormSubmission = {
    id: string;
    templateId: string;
    templateName: string;
    title: string;
    userId: string;
    username: string;
    kioskId: string;
    kioskName: string;
    createdAt: string; // ISO string
    answers: FormAnswer[];
};

export type ReturnRequestStatus = 'em_andamento' | 'finalizado_sucesso' | 'finalizado_erro';

export const returnRequestStatuses: { [key in ReturnRequestStatus]: { label: string; color: string } } = {
    em_andamento: { label: 'Em Andamento', color: 'bg-orange-500' },
    finalizado_sucesso: { label: 'Finalizado (Sucesso)', color: 'bg-green-600' },
    finalizado_erro: { label: 'Finalizado (Erro)', color: 'bg-red-600' },
};

export type ReturnRequestHistoricoItem = {
    statusAnterior: ReturnRequestStatus;
    statusNovo: ReturnRequestStatus;
    changedBy: {
        userId: string;
        username: string;
    };
    changedAt: string; // Data em formato ISO
    detalhes?: string;
};

export type ReturnRequestChecklistItem = {
    texto: string;
    feito: boolean;
};

export type ReturnRequest = {
    id: string; // ID do documento no Firestore
    numero: string; // Ex: "DEV-20250704-0001"
    insumoId: string; // Referência ao ID do insumo na coleção `products`
    insumoNome: string; // Para exibição rápida, ex: "Ovomaltine (400g)"
    lote: string;
    quantidade: number;
    tipo: 'devolucao' | 'bonificacao';
    motivo: string;
    status: ReturnRequestStatus;
    dataPrevisaoRetorno?: string; // Data em formato ISO
    dataContatoRepresentante?: string; // Data em formato ISO
    dataPrevisaoRetornoFornecedor?: string; // Data em formato ISO
    dataConclusao?: string; // Data em formato ISO
    detalhesResultado?: string;
    anexos?: { url: string; nome: string }[];
    historico: ReturnRequestHistoricoItem[];
    checklist: { [key: string]: ReturnRequestChecklistItem[] };
    createdAt: string; // Data em formato ISO
    updatedAt: string; // Data em formato ISO
    isArchived?: boolean;
    createdBy: {
        userId: string;
        username: string;
    };
};

export interface ReturnRequestContextType {
  requests: ReturnRequest[];
  loading: boolean;
  addReturnRequest: (data: { tipo: 'devolucao' | 'bonificacao'; insumoId: string; lote: string; quantidade: number; motivo: string; dataPrevisaoRetorno: Date; }) => Promise<void>;
  updateReturnRequest: (requestId: string, payload: Partial<ReturnRequest>) => Promise<void>;
  deleteReturnRequest: (requestId: string) => Promise<void>;
}

export const defaultGuestPermissions: PermissionSet = {
    products: { add: false, edit: false, delete: false },
    lots: { add: false, edit: false, move: false, delete: false, viewMovementHistory: false },
    users: { add: false, edit: false, delete: false },
    kiosks: { add: false, delete: false },
    predefinedLists: { add: false, edit: false, delete: false },
    forms: { manage: false, fill: false, viewHistory: false, deleteHistory: false },
    stockAnalysis: { upload: false, configure: false, viewHistory: false, deleteHistory: false },
    consumptionAnalysis: { upload: false, viewHistory: false, deleteHistory: false },
    returns: { add: false, updateStatus: false, delete: false },
};

export const defaultUserPermissions: PermissionSet = {
    products: { add: true, edit: false, delete: false },
    lots: { add: true, edit: true, move: true, delete: false, viewMovementHistory: true },
    users: { add: false, edit: false, delete: false },
    kiosks: { add: false, delete: false },
    predefinedLists: { add: true, edit: true, delete: false },
    forms: { manage: false, fill: true, viewHistory: true, deleteHistory: false },
    stockAnalysis: { upload: true, configure: false, viewHistory: true, deleteHistory: false },
    consumptionAnalysis: { upload: true, viewHistory: true, deleteHistory: false },
    returns: { add: true, updateStatus: true, delete: false },
};

export const defaultAdminPermissions: PermissionSet = {
    products: { add: true, edit: true, delete: true },
    lots: { add: true, edit: true, move: true, delete: true, viewMovementHistory: true },
    users: { add: true, edit: true, delete: true },
    kiosks: { add: true, delete: true },
    predefinedLists: { add: true, edit: true, delete: true },
    forms: { manage: true, fill: true, viewHistory: true, deleteHistory: true },
    stockAnalysis: { upload: true, configure: true, viewHistory: true, deleteHistory: true },
    consumptionAnalysis: { upload: true, viewHistory: true, deleteHistory: true },
    returns: { add: true, updateStatus: true, delete: true },
};
