

"use client"
export const unitCategories = ["Volume", "Massa", "Unidade", "Embalagem"] as const;

export type UnitCategory = (typeof unitCategories)[number];

export type LastEffectivePrice = {
  pricePerUnit: number;
  productId: string;
  entityId: string;
  updatedAt: string;
};

export type PriceHistoryEntry = {
  id: string;
  baseProductId: string;
  productId: string;
  pricePerUnit: number;
  entityId: string;
  confirmedBy: string; // userId
  confirmedAt: string; // ISO String
}

export type BaseProduct = {
  id: string;
  name: string;
  unit: string;
  stockLevels: { [kioskId: string]: { min: number } };
  category: UnitCategory;
  lastEffectivePrice?: LastEffectivePrice
}

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
  secondaryUnitValue?: number;
  secondaryUnit?: string;
  notes?: string;
  pdfUnit?: string;
  alertThreshold?: number; // e.g., 30 days
  urgentThreshold?: number; // e.g., 7 days
  isArchived?: boolean;
  baseProductId?: string;
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

export type MovementType = 'ENTRADA' | 'SAIDA_CONSUMO' | 'SAIDA_DESCARTE' | 'SAIDA_CORRECAO' | 'ENTRADA_CORRECAO' | 'TRANSFERENCIA_SAIDA' | 'TRANSFERENCIA_ENTRADA';

export type MovementRecord = {
  id: string;
  lotId: string;
  productId: string;
  productName: string; // Full name for easy display
  lotNumber: string;
  type: MovementType;
  quantityChange: number;
  fromKioskId?: string;
  fromKioskName?: string;
  toKioskId?: string;
  toKioskName?: string;
  userId: string;
  username: string;
  timestamp: string; // ISO String
  notes?: string;
};


export type ConsumptionAnalysisItem = {
  productId: string;
  productName: string;
  consumedQuantity: number;
  baseProductId: string | null;
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

export type Shift = {
    id: string;
    userId: string;
    username: string;
    kioskId: string;
    date: string; // YYYY-MM-DD
    startTime: string; // HH:mm
    endTime: string; // HH:mm
    notes?: string;
};

export type DailySchedule = {
  id: string; // YYYY-MM-DD
  diaDaSemana: string;
  [kioskTurnKey: string]: any; // "Quiosque Tirirical T1": "Edna" or "Edna + Carliane"
};

export interface MonthlyScheduleContextType {
  schedule: DailySchedule[];
  previousMonthSchedule: DailySchedule[];
  loading: boolean;
  fetchSchedule: (year: number, month: number) => void;
  updateDailySchedule: (dayId: string, updates: Partial<DailySchedule>) => Promise<void>;
  createFullMonthSchedule: (scheduleData: Record<string, any>) => Promise<void>;
  currentYear: number;
  currentMonth: number;
}

// Pricing Simulator Types
export type SimulationCategory = {
  id: string;
  name: string;
  color: string;
  type: 'category' | 'line';
};

export type SimulationPriceHistory = {
  id: string;
  simulationId: string;
  oldPrice: number;
  newPrice: number;
  changedAt: string; // ISO string
  changedBy: {
    userId: string;
    username: string;
  }
};

export type ProductSimulationItem = {
  id: string;
  simulationId: string;
  baseProductId: string;
  quantity: number;
  useDefault: boolean;
  overrideCostPerUnit?: number;
  overrideUnit?: string;
};

export type ProductSimulation = {
  id: string;
  name: string;
  categoryId: string | null;
  lineId: string | null;
  userId: string;
  status: 'draft' | 'finalized' | 'archived';
  salePrice: number;
  operationPercentage: number;
  profitGoal?: number | null;
  totalCmv: number;
  grossCost: number;
  profitValue: number;
  profitPercentage: number;
  markup: number;
  notes?: string;
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
};


export type PermissionSet = {
    products: { add: boolean; edit: boolean; delete: boolean; };
    lots: { add: boolean; edit: boolean; move: boolean; delete: boolean; viewMovementHistory: boolean; };
    users: { add: boolean; edit: boolean; delete: boolean; impersonate: boolean; };
    kiosks: { add: boolean; delete: boolean; };
    predefinedLists: { add: boolean; edit: boolean; delete: boolean; };
    forms: { manage: boolean; fill: boolean; viewHistory: boolean; deleteHistory: boolean; };
    stockAnalysis: { upload: boolean; configure: boolean; viewHistory: boolean; deleteHistory: boolean; };
    consumptionAnalysis: { upload: boolean; viewHistory: boolean; deleteHistory: boolean; };
    returns: { add: boolean; updateStatus: boolean; delete: boolean; };
    team: { manage: boolean, view: boolean };
    purchasing: { suggest: boolean; approve: boolean; viewHistory: boolean; };
    stockCount: { perform: boolean; approve: boolean; };
    itemRequests: { manage: boolean; };
    pricing: { simulate: boolean; manageParameters: boolean; };
    reports: { view: boolean; };
    help: { view: boolean; };
    tasks: { view: true, manage: boolean; };
    audit: { start: boolean; approve: boolean; };
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
    password?: string;
    profileId: string;
    assignedKioskIds: string[];
    turno: 'T1' | 'T2' | null;
    folguista: boolean;
    operacional: boolean;
    avatarUrl?: string;
    valeTransporte?: number;
    color?: string | null;
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

export type StockCountItem = {
    productId: string;
    productName: string;
    lotId: string;
    lotNumber: string;
    expiryDate: string; // ISO String
    systemQuantity: number;
    countedQuantity: number;
    difference: number;
    notes?: string;
};

export type StockCount = {
    id: string;
    kioskId: string;
    kioskName: string;
    status: 'pending' | 'approved' | 'rejected';
    countedBy: {
        userId: string;
        username: string;
    };
    countedAt: string; // ISO String
    reviewedBy?: {
        userId: string;
        username: string;
    };
    reviewedAt?: string; // ISO String
    items: StockCountItem[];
};

export type StockAuditDivergence = {
    id: string;
    reason: string;
    quantity: number;
    notes?: string;
};

export type StockAuditItem = {
    productId: string;
    productName: string;
    lotId: string;
    lotNumber: string;
    expiryDate: string; // ISO String
    systemQuantity: number;
    countedQuantity: number;
    divergences: StockAuditDivergence[];
};

export type StockAuditSession = {
    id: string;
    kioskId: string;
    kioskName: string;
    status: 'pending_review' | 'completed';
    auditedBy: {
        userId: string;
        username: string;
    };
    startedAt: string; // ISO String
    completedAt?: string; // ISO String
    items: StockAuditItem[];
};


export type FormTaskAction = {
    title: string;
    assigneeType: 'user' | 'profile';
    assigneeId: string; // userId or profileId
    requiresApproval: boolean;
    approverType?: 'user' | 'profile';
    approverId?: string; // userId or profileId
    description?: string;
    dueInDays?: number;
};

export type FormQuestion = {
    id: string;
    label: string;
    type: 'yes-no' | 'text' | 'number' | 'single-choice' | 'multiple-choice' | 'file-attachment';
    isRequired: boolean;
    attachmentConfig?: {
        allowMultiple: boolean;
        allowedFileTypes: ('image' | 'pdf' | 'video')[];
        allowCamera: boolean;
    };
    options?: {
        id: string;
        value: string;
        subQuestions: FormQuestion[];
        action?: FormTaskAction;
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
    value: string | number | string[] | { name: string; url: string; type: string }[];
    subAnswers?: FormAnswer[];
};

export type FormSubmission = {
    id: string;
    templateId: string;
    templateName: string;
    title: string;
    status: 'completed' | 'in_progress';
    userId: string;
    username: string;
    kioskId: string;
    kioskName: string;
    createdAt: string; // ISO string
    answers: FormAnswer[];
};

export type ReturnRequestStatus = 'em_andamento' | 'finalizado_sucesso' | 'finalizado_erro';

export const returnRequestStatuses: { [key in ReturnRequestStatus]: { label: string; color: string } } = {
    em_andamento: { label: 'Em andamento', color: 'bg-orange-500' },
    finalizado_sucesso: { label: 'Finalizado (sucesso)', color: 'bg-green-600' },
    finalizado_erro: { label: 'Finalizado (erro)', color: 'bg-red-600' },
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
    dataPrevisaoRetorno: string; // Data em formato ISO
    dataContatoRepresentante?: string; // Data em formato ISO
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
  addReturnRequest: (data: { tipo: 'devolucao' | 'bonificacao'; insumoId: string; lote: string; quantidade: number; motivo: string; }) => Promise<void>;
  updateReturnRequest: (requestId: string, payload: Partial<ReturnRequest>) => Promise<void>;
  deleteReturnRequest: (requestId: string) => Promise<void>;
}

export type Entity = {
  id: string;
  type: 'pessoa_fisica' | 'pessoa_juridica';
  name: string;
  fantasyName?: string;
  document: string; // CPF ou CNPJ
  address?: {
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  };
  contact?: {
    phone?: string;
    email?: string;
  };
  responsible?: string; // Only for pessoa_juridica
};

// Purchase Module Types
export type PurchaseSession = {
  id: string;
  baseProductIds: string[];
  userId: string;
  entityId: string;
  description: string;
  status: 'open' | 'closed';
  createdAt: string; // ISO String
  closedAt?: string; // ISO String
};

export type PurchaseItem = {
  id: string;
  sessionId: string;
  productId: string; // Insumo Vinculado ID
  price: number;
  isConfirmed: boolean;
  confirmedBy?: string; // userId
  confirmedAt?: string; // ISO String
  confirmationComment?: string;
};

export type ItemAdditionRequest = {
  id: string;
  kioskId: string;
  kioskName: string;
  requestedBy: {
    userId: string;
    username: string;
  };
  productName: string;
  brand?: string;
  notes?: string;
  status: 'pending' | 'completed' | 'rejected';
  createdAt: string; // ISO String
  reviewedBy?: {
    userId: string;
    username: string;
  };
  reviewedAt?: string; // ISO String
};

export type RepositionSuggestedLot = {
  lotId: string;
  productId: string;
  productName: string;
  quantityToMove: number;
  receiptNotes?: string;
};

export type RepositionItem = {
  baseProductId: string;
  productName: string;
  quantityNeeded: number;
  suggestedLots: RepositionSuggestedLot[];
  receivedLots?: (RepositionSuggestedLot & { receivedQuantity: number })[];
};

export type RepositionActivityStatus = 'Aguardando despacho' | 'Aguardando recebimento' | 'Recebido com divergência' | 'Recebido sem divergência' | 'Concluído';

export type SignatureData = {
    dataUrl?: string; // digital signature
    physicalCopyUrl?: string; // uploaded photo of physical doc
    signedBy: string; // username of transporter or receiver
    signedAt: string; // ISO date
};

export type RepositionActivity = {
  id: string;
  status: RepositionActivityStatus;
  kioskOriginId: string;
  kioskOriginName: string;
  kioskDestinationId: string;
  kioskDestinationName: string;
  requestedBy: {
    userId: string;
    username: string;
  };
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
  items: RepositionItem[];
  transportDocumentUrl?: string;
  transportSignature?: SignatureData;
  receiptNotes?: string;
  receiptSignature?: SignatureData;
};

export type ProfitRange = {
  id: string;
  from: number;
  to: number;
  color: string;
};

export type PricingParameters = {
  defaultOperationPercentage: number;
  profitRanges: ProfitRange[];
  profitGoals: number[];
};

export type TaskHistoryItem = {
    timestamp: string; // ISO date string
    author: {
        id: string;
        name: string;
    };
    action: string; // e.g., 'created', 'reopened', 'completed'
    details?: string; // e.g., justification for reopening
};

export type TaskProject = {
  id: string;
  name: string;
  memberIds: string[];
  sections: { id: string; name: string }[];
};

export type TaskType = {
  id: string;
  name: string;
  color: string;
};

export type Task = {
    id: string;
    title: string;
    description?: string;
    
    // New Hierarchy & Categorization
    projectId: string;
    taskTypeId: string;
    sectionId: string; // Replaces 'status' for Kanban columns
    parentId?: string; // For subtasks

    status: 'pending' | 'in_progress' | 'awaiting_approval' | 'completed' | 'reopened' | 'rejected';
    
    // Assignment
    assigneeType: 'user' | 'profile';
    assigneeId: string; // userId or profileId
    
    // Approval
    requiresApproval: boolean;
    approverType?: 'user' | 'profile';
    approverId?: string; // userId or profileId
    
    // Context
    origin: {
        type: 'form_submission';
        submissionId: string;
        questionId: string;
        optionId: string;
    };
    
    // Timestamps and History
    createdAt: string;
    updatedAt: string;
    dueDate?: string; // ISO string
    completedAt?: string; // ISO string
    history: TaskHistoryItem[];
};


export const defaultGuestPermissions: PermissionSet = {
    products: { add: false, edit: false, delete: false },
    lots: { add: false, edit: false, move: false, delete: false, viewMovementHistory: false },
    users: { add: false, edit: false, delete: false, impersonate: false },
    kiosks: { add: false, delete: false },
    predefinedLists: { add: false, edit: false, delete: false },
    forms: { manage: false, fill: false, viewHistory: false, deleteHistory: false },
    stockAnalysis: { upload: false, configure: false, viewHistory: false, deleteHistory: false },
    consumptionAnalysis: { upload: false, viewHistory: false, deleteHistory: false },
    returns: { add: false, updateStatus: false, delete: false },
    team: { manage: false, view: false },
    purchasing: { suggest: false, approve: false, viewHistory: false },
    stockCount: { perform: false, approve: false },
    itemRequests: { manage: false },
    pricing: { simulate: false, manageParameters: false },
    reports: { view: false },
    help: { view: true },
    tasks: { view: true, manage: false },
    audit: { start: false, approve: false },
};

export const defaultUserPermissions: PermissionSet = {
    ...defaultGuestPermissions,
    products: { add: true, edit: false, delete: false },
    lots: { add: true, edit: true, move: true, delete: false, viewMovementHistory: true },
    predefinedLists: { add: true, edit: true, delete: false },
    forms: { manage: false, fill: true, viewHistory: true, deleteHistory: false },
    stockAnalysis: { upload: true, configure: false, viewHistory: true, deleteHistory: false },
    consumptionAnalysis: { upload: true, viewHistory: true, deleteHistory: false },
    returns: { add: true, updateStatus: true, delete: false },
    team: { view: true, manage: false },
    purchasing: { suggest: true, approve: false, viewHistory: true },
    stockCount: { perform: true, approve: false },
    pricing: { simulate: true, manageParameters: false },
};

export const defaultAdminPermissions: PermissionSet = {
    products: { add: true, edit: true, delete: true },
    lots: { add: true, edit: true, move: true, delete: true, viewMovementHistory: true },
    users: { add: true, edit: true, delete: true, impersonate: true },
    kiosks: { add: true, delete: true },
    predefinedLists: { add: true, edit: true, delete: true },
    forms: { manage: true, fill: true, viewHistory: true, deleteHistory: true },
    stockAnalysis: { upload: true, configure: true, viewHistory: true, deleteHistory: true },
    consumptionAnalysis: { upload: true, viewHistory: true, deleteHistory: true },
    returns: { add: true, updateStatus: true, delete: true },
    team: { manage: true, view: true },
    purchasing: { suggest: true, approve: true, viewHistory: true },
    stockCount: { perform: true, approve: true },
    itemRequests: { manage: true },
    pricing: { simulate: true, manageParameters: true },
    reports: { view: true },
    help: { view: true },
    tasks: { view: true, manage: true },
    audit: { start: true, approve: true },
};


export interface StockAuditContextType {
  auditSessions: StockAuditSession[];
  loading: boolean;
  addAuditSession: (session: Omit<StockAuditSession, 'id'>) => Promise<string | null>;
  updateAuditSession: (sessionId: string, updates: Partial<StockAuditSession>) => Promise<void>;
  deleteAuditSession: (sessionId: string) => Promise<void>;
}
