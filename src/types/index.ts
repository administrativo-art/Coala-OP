
"use client"
export const unitCategories = ["Volume", "Massa", "Unidade", "Embalagem"] as const;

export type UnitCategory = (typeof unitCategories)[number];

export const absenceReasons = ["Atestado Médico", "Falta Injustificada", "Atraso", "Outros"] as const;
export type AbsenceReason = (typeof absenceReasons)[number];

export type PriceHistoryEntry = {
  id: string;
  baseProductId: string;
  productId: string;
  pricePerUnit: number;
  entityId: string;
  confirmedBy: string; // userId
  confirmedAt: string; // ISO String
}

export type BaseProductStockLevel = {
    min?: number;
    safetyStock?: number;
    leadTime?: number;
    override: boolean;
};

export type Classification = {
  id: string;
  name: string;
  slug: string;
  createdAt?: number;
  updatedAt?: number;
  usageCount?: number;
};

export type BaseProduct = {
  id: string;
  name: string;
  unit: string;
  stockLevels: { [kioskId: string]: BaseProductStockLevel };
  category: UnitCategory;
  classification?: string;
  initialCostPerUnit?: number;
  lastEffectivePrice?: PriceHistoryEntry;
  consumptionMonths?: number;
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
  countingInstruction?: string;
  countingInstructionImageUrl?: string;
  multiplo_caixa?: number;
  rotulo_caixa?: string;
  pdfUnit?: string;
  alertThreshold?: number; // e.g., 30 days
  urgentThreshold?: number; // e.g., 7 days
  isArchived?: boolean;
  baseProductId?: string;
};

export type ProductDefinition = {
    baseName: string;
    brand?: string;
    packageSize: number;
    category: UnitCategory;
    unit: string;
}

export type ConversionUnits = {
  [key in UnitCategory]: { [unit: string]: number };
};


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

export type Kiosk = {
    id: string;
    name: string;
}

export type LotEntry = {
  id:string;
  productId: string;
  productName: string;
  lotNumber: string;
  expiryDate: string | null; // ISO String or null
  kioskId: string;
  quantity: number;
  reservedQuantity?: number;
  imageUrl?: string;
  locationId?: string | null;
  locationName?: string | null;
  locationCode?: string | null;
};

export type MovementType = 
    | 'ENTRADA' 
    | 'SAIDA_CONSUMO' 
    | 'SAIDA_DESCARTE_VENCIMENTO'
    | 'SAIDA_DESCARTE_AVARIA'
    | 'SAIDA_DESCARTE_PERDA'
    | 'SAIDA_DESCARTE_OUTROS'
    | 'SAIDA_CORRECAO'
    | 'ENTRADA_CORRECAO'
    | 'TRANSFERENCIA_SAIDA' 
    | 'TRANSFERENCIA_ENTRADA' 
    | 'ENTRADA_ESTORNO' 
    | 'SAIDA_ESTORNO';


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
  activityId?: string;
  reverted?: boolean;
  revertedFromId?: string;
};


export type ConsumptionAnalysisItem = {
  productId: string;
  productName: string;
  consumedQuantity: number;
  baseProductId: string | null;
};

export type ConsumptionReport = {
  id: string;
  reportName?: string;
  month: number;
  year: number;
  kioskId: string;
  kioskName?: string;
  createdAt: string; // ISO String
  status?: 'completed' | 'processing' | 'error';
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

export type AbsenceEntry = {
  userId: string;
  reason: AbsenceReason;
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
  createFullMonthSchedule: (scheduleData: Record<string, any>, year: number, month: number) => Promise<void>;
  bulkUpdateSchedules: (dayIds: string[], kioskId: string, turn: string, employeeNames: string[], action: 'add' | 'replace') => Promise<void>;
  currentYear: number;
  currentMonth: number;
}

// Pricing Simulator Types
export type SimulationCategory = {
  id: string;
  name: string;
  color?: string;
  type: 'category' | 'line' | 'group';
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

export type SimulationChangeHistory = {
  timestamp: string; // ISO String
  userId: string;
  username: string;
  action: 'batch_edit';
  details: {
    field: 'lineId' | 'categoryIds' | 'groupIds';
    from: string | string[] | null;
    to: string | string[] | null;
  }[];
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

export type PPO = {
  sku?: string;
  ncm?: string;
  cest?: string;
  cfop?: string;
  assemblyInstructions?: {
    id: string;
    name: string;
    etapas: {
      id: string;
      text: string;
      quantity?: number;
      unit?: string;
      imageUrl?: string;
    }[];
  }[];
  qualityStandard?: { id: string; text: string }[];
  allergens?: { id: string; text: string }[];
  preparationTime?: number; // in seconds
  portionWeight?: number; // in grams or mL
  portionTolerance?: number;
  referenceImageUrl?: string;
  assemblyVideoUrl?: string;
};


export type ProductSimulation = {
  id: string;
  name: string;
  kioskIds?: string[];
  categoryIds: string[];
  lineId: string | null;
  groupIds: string[];
  userId: string;
  salePrice: number;
  operationPercentage: number;
  profitGoal?: number | null;
  totalCmv: number;
  grossCost: number;
  profitValue: number;
  profitPercentage: number;
  markup: number;
  notes?: string;
  ppo?: Partial<PPO>;
  historicoAlteracoes?: SimulationChangeHistory[];
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
  updatedBy?: {
    userId: string;
    username: string;
  };
};

// Manager's Diary Types
export type DiaryOccurrence = {};
export type DiaryActivity = {};
export type DailyLog = {
    id: string;
    logDate: string;
    status: 'draft' | 'submitted' | 'validated' | 'aberto' | 'em andamento' | 'finalizado';
    author: {
        userId: string;
        username: string;
    },
    totalDurationMinutes?: number;
    totalActivities?: number;
    notes?: string;
};


export type PermissionSet = {
  dashboard: { view: boolean; operational: boolean; pricing: boolean; audit: boolean; technicalSheets: boolean; };
  registration: { view: boolean; items: { add: boolean; edit: boolean; delete: boolean; }; baseProducts: { add: boolean; edit: boolean; delete: boolean; }; entities: { add: boolean; edit: boolean; delete: boolean; }; };
  stock: { view: boolean; inventoryControl: { view: boolean; addLot: boolean; editLot: boolean; writeDown: boolean; transfer: boolean; viewHistory: boolean; }; stockCount: { view: boolean; perform: boolean; approve: boolean; requestItem: boolean; }; audit: { view: boolean; start: boolean; approve: boolean; }; analysis: { view: boolean; restock: boolean; consumption: boolean; projection: boolean; valuation: boolean; }; purchasing: { view: boolean; suggest: boolean; approve: boolean; deleteHistory: boolean; }; returns: { view: boolean; add: boolean; updateStatus: boolean; delete: boolean; }; conversions: { view: boolean; }; };
  team: { view: boolean; manage: boolean; };
  pricing: { view: boolean; simulate: boolean; manageParameters: boolean; };
  settings: { view: boolean; manageUsers: boolean; manageKiosks: boolean; manageProfiles: boolean; manageLabels: boolean; impersonate: boolean; };
  tasks: { view: boolean; manage: boolean; };
  help: { view: boolean; };
  itemRequests: { add: boolean; approve: boolean; };
  reposition: { cancel: boolean; };
};

export type Profile = {
    id: string;
    name: string;
    isDefaultAdmin?: boolean;
    permissions: Partial<PermissionSet>;
}

export type User = {
    id:string; // This will be the Firebase Auth UID
    username: string;
    email: string;
    profileId: string;
    assignedKioskIds: string[];
    avatarUrl?: string;
    operacional?: boolean;
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
    reason: MovementType;
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
    finalQuantity: number;
    adjustment?: {
        type: 'positive' | 'negative';
        quantity: number;
        notes?: string;
    } | null;
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

export type Entity = {
  id: string;
  type: 'pessoa_fisica' | 'pessoa_juridica';
  name: string;
  fantasyName?: string;
  document: string; // CPF ou CNPJ
  address: {
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
export type PurchaseItem = {
  id: string;
  sessionId: string;
  productId: string;
  entityId?: string;
  price: number;
  isConfirmed: boolean;
  confirmedBy?: string; // userId
  confirmedAt?: string; // ISO String
  createdAt: string; // ISO String
};

export type PurchaseSession = {
  id: string;
  description: string;
  userId: string;
  entityId?: string;
  baseProductIds: string[];
  confirmedItemIds?: string[]; // Array of PurchaseItem IDs that were bought
  type: 'manual' | 'automatic';
  status: 'open' | 'closed';
  createdAt: string; // ISO String
  closedAt?: string; // ISO String
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
  lote?: string;
  barcode?: string;
  expiryDate?: string | null;
  notes?: string;
  status: 'pending' | 'completed' | 'rejected';
  createdAt: string; // ISO String
  reviewedBy?: {
    userId: string;
    username: string;
  };
  reviewedAt?: string; // ISO String
  taskId?: string;
};

export type RepositionSuggestedLot = {
  lotId: string;
  productId: string;
  productName: string;
  lotNumber: string;
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

export type RepositionActivityStatus = 'Aguardando despacho' | 'Aguardando recebimento' | 'Recebido com divergência' | 'Recebido sem divergência' | 'Concluído' | 'Cancelada';

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
  profitGoals: number[];
  profitRanges: ProfitRange[];
};

export const defaultGuestPermissions: PermissionSet = {
    dashboard: { view: false, operational: false, pricing: false, audit: false, technicalSheets: false },
    registration: { view: false, items: { add: false, edit: false, delete: false }, baseProducts: { add: false, edit: false, delete: false }, entities: { add: false, edit: false, delete: false } },
    stock: { view: false, inventoryControl: { view: false, addLot: false, editLot: false, writeDown: false, transfer: false, viewHistory: false }, stockCount: { view: false, perform: false, approve: false, requestItem: false }, audit: { view: false, start: false, approve: false }, analysis: { view: false, restock: false, consumption: false, projection: false, valuation: false }, purchasing: { view: false, suggest: false, approve: false, deleteHistory: false }, returns: { view: false, add: false, updateStatus: false, delete: false }, conversions: { view: false } },
    team: { view: false, manage: false },
    pricing: { view: false, simulate: false, manageParameters: false },
    settings: { view: false, manageUsers: false, manageKiosks: false, manageProfiles: false, manageLabels: false, impersonate: false },
    tasks: { view: false, manage: false },
    help: { view: true },
    itemRequests: { add: true, approve: false },
    reposition: { cancel: false },
};


export const defaultAdminPermissions: PermissionSet = {
    dashboard: { view: true, operational: true, pricing: true, audit: true, technicalSheets: true },
    registration: { view: true, items: { add: true, edit: true, delete: true }, baseProducts: { add: true, edit: true, delete: true }, entities: { add: true, edit: true, delete: true } },
    stock: { view: true, inventoryControl: { view: true, addLot: true, editLot: true, writeDown: true, transfer: true, viewHistory: true }, stockCount: { view: true, perform: true, approve: true, requestItem: true }, audit: { view: true, start: true, approve: true }, analysis: { view: true, restock: true, consumption: true, projection: true, valuation: true }, purchasing: { view: true, suggest: true, approve: true, deleteHistory: true }, returns: { view: true, add: true, updateStatus: true, delete: true }, conversions: { view: true } },
    team: { view: true, manage: true },
    pricing: { view: true, simulate: true, manageParameters: true },
    settings: { view: true, manageUsers: true, manageKiosks: true, manageProfiles: true, manageLabels: true, impersonate: true },
    tasks: { view: true, manage: true },
    reposition: { cancel: true },
    help: { view: true },
    itemRequests: { add: true, approve: true },
};

export const defaultUserPermissions: PermissionSet = { ...defaultGuestPermissions };


export type TaskOrigin = {
    type: 'form' | 'return_request' | 'stock_count_approval' | 'author_board_diary' | 'consumption-projection' | 'item_addition_request';
    id: string; // ID of the originating document (e.g., submissionId, returnRequestId)
    questionId?: string; // Optional: for tasks generated from specific form questions
    details?: any;
};

export type TaskHistoryItem = {
    timestamp: string; // ISO string
    author: {
        id: string;
        name: string;
    };
    action: 'created' | 'assigned' | 'status_changed' | 'commented' | 'completed' | 'reopened' | 'approved' | 'rejected';
    details?: string;
};

export interface LegacyTask {
  id: string;
  type: string;
  title: string;
  description: string;
  link: string;
  icon: React.FC<any>;
}

export type Task = {
    id: string;
    title: string;
    description?: string;
    status: 'pending' | 'in_progress' | 'awaiting_approval' | 'completed' | 'reopened' | 'rejected';
    assigneeType: 'user' | 'profile';
    assigneeId: string; // userId or profileId
    requiresApproval: boolean;
    approverType?: 'user' | 'profile';
    approverId?: string;
    origin: TaskOrigin;
    history: TaskHistoryItem[];
    createdAt: string; // ISO string
    updatedAt: string; // ISO string
    dueDate?: string; // ISO string
    completedAt?: string; // ISO string
    // Properties for adapted legacy tasks
    legacyLink?: string;
    legacyIcon?: React.FC<any>;
};
    
// Competition Analysis Types
export type CompetitorGroup = {
    id: string;
    name: string;
};

export type Competitor = {
    id: string;
    name: string; // Name of the specific unit, e.g., "Shopping São Luís"
    competitorGroupId: string; // ID of the macro group, e.g., "McDonald's"
    address?: string;
    city?: string;
    state?: string;
    active: boolean;
};

export type CompetitorProduct = {
    id: string;
    competitorId: string;
    itemName: string;
    packageSize?: string;
    unit?: string;
    ksProductId?: string | null; // Correlates to our ProductSimulation id
    active: boolean;
};

export type CompetitorPrice = {
    id: string;
    competitorProductId: string;
    price: number;
    data_coleta: string; // ISO String
    fonte: string;
    promocional?: boolean;
};

export type PriceDecision = {
    id: string;
    productSimulationId: string;
    oldPrice: number;
    newPrice: number;
    oldCostData?: any;
    newCostData?: any;
    racional: string; // Rationale for the price change
    userId: string;
    username: string;
    changedAt: string; // ISO String
    origin: 'manual' | 'sugerido';
};
    

    
