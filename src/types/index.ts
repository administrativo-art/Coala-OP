"use client"
import { type Timestamp } from 'firebase/firestore';
export const unitCategories = ["Volume", "Massa", "Unidade", "Embalagem"] as const;
export const packageTypes = ['Unidade', 'Caixa', 'Pacote', 'Lata', 'Garrafa', 'Frasco', 'Sachê', 'Pote', 'Balde', 'Galão', 'Bag'] as const;

export type UnitCategory = (typeof unitCategories)[number];
export type PackageType = (typeof packageTypes)[number];

export const absenceReasons = ["Atestado Médico", "Falta Injustificada", "Atraso", "Outros"] as const;
export type AbsenceReason = (typeof absenceReasons)[number];

export type Kiosk = {
  id: string;
  name: string;
  pdvFilialId?: string;
  bizneoId?: string;
  signageEnabled?: boolean;
};

export type Location = {
  id: string;
  name: string;
  kioskId: string;
  code?: string;
};

export type Classification = {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
};

export type PriceHistoryEntry = {
  id: string;
  baseProductId: string;
  productId: string;
  price: number;
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
  createdAt?: any;
  updatedAt?: any;
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
    | 'SAIDA_ESTORNO'
    | 'Divergência na contagem do turno - decréscimo';


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
  day?: number;
  kioskId: string;
  kioskName?: string;
  createdAt: string; // ISO String
  status?: 'completed' | 'processing' | 'error';
  results: ConsumptionAnalysisItem[];
};

export type SalesReportItem = {
  sku: string;
  productName: string;
  simulationId: string;
  quantity: number;
  timestamp?: string; // ISO String ou HH:mm
  unitPrice?: number;
};
 
export type SalesReport = {
  id: string;
  reportName?: string;
  month: number;
  year: number;
  day?: number; // Optional: for daily reports
  kioskId: string;
  kioskName?: string;
  createdAt: string;
  consumptionReportId?: string;
  items: SalesReportItem[];
  hourlySales?: { [hour: string]: number };
  productHourlySales?: { [simulationId: string]: { [hour: string]: number } };
  productQtyByOperator?: { [pdvOperatorId: string]: { [simulationId: string]: number } };
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

export type SalesChannelType = 'balcao' | 'delivery_proprio' | 'ifood' | 'rappi' | 'custom';

export type SalesChannelDefaultPriceRule = {
  mode: 'none' | 'markup';
  value: number;
} | null;

export type SalesChannel = {
  id: string;
  name: string;
  type: SalesChannelType;
  active: boolean;
  defaultPriceRule: SalesChannelDefaultPriceRule;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    userId: string;
    username: string;
  };
  updatedBy?: {
    userId: string;
    username: string;
  };
};

export type PriceOverrideSource =
  | 'override:unit+channel'
  | 'override:unit'
  | 'override:channel'
  | 'channel-default-rule'
  | 'global'
  | 'unit-disabled'
  | 'channel-inactive';

export type PriceOverride = {
  id: string;
  simulationId: string;
  unitId: string | null;
  channelId: string | null;
  finalPrice: number | null;
  available: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    userId: string;
    username: string;
  };
  updatedBy: {
    userId: string;
    username: string;
  };
};

export type EffectivePriceResolution = {
  price: number | null;
  available: boolean;
  source: PriceOverrideSource;
  override: PriceOverride | null;
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
  profitGoal?: number | null;
  totalCmv: number;
  profitValue: number;
  profitPercentage: number;
  markup: number;
  notes?: string;
  ppo?: Partial<PPO>;
  historicoAlteracoes?: SimulationChangeHistory[];
  isArchived?: boolean;
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
  stock: {
    view: boolean;
    inventoryControl: { view: boolean; addLot: boolean; editLot: boolean; writeDown: boolean; transfer: boolean; viewHistory: boolean; };
    // `audit` permissions are now synced with `stockCount` for backward compatibility with Firestore rules, but UI uses `stockCount`.
    stockCount: { view: boolean; perform: boolean; approve: boolean; requestItem: boolean; };
    audit: { view: boolean; start: boolean; approve: boolean; };
    analysis: { view: boolean, restock: boolean, consumption: boolean, projection: boolean, valuation: boolean },
    purchasing: { view: boolean; suggest: boolean; approve: boolean; deleteHistory: boolean; };
    returns: { view: boolean; add: boolean; updateStatus: boolean; delete: boolean; };
    conversions: { view: boolean },
    predefinedLists: { view: true, manage: true }
  };
  pricing: { view: boolean; simulate: boolean; manageParameters: boolean; };
  settings: { view: boolean; manageUsers: boolean; manageKiosks: boolean; manageProfiles: boolean; manageLabels: boolean; };
  tasks: { view: boolean; manage: boolean; };
  goals: { view: boolean; manage: boolean; };
  help: { view: true };
  reposition: { cancel: boolean; };
  // itemRequests is now managed under stock.stockCount
  itemRequests: { add: boolean; approve: boolean; };
  signage: { view: boolean; manage: boolean; };
  dp: {
    view: boolean;
    schedules: { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean; };
    vacation: { viewAll: boolean; request: boolean; approve: boolean; manageSettings: boolean; };
    collaborators: { view: boolean; add: boolean; edit: boolean; terminate: boolean; };
    checklists: { view: boolean; operate: boolean; create: boolean; manageTemplates: boolean; viewAnalytics: boolean; };
    settings: { manageUnits: boolean; manageShifts: boolean; manageCalendars: boolean; manageChecklistTypes: boolean; };
  };
  financial: {
    view: boolean;
    dashboard: boolean;
    cashFlow: { view: boolean; create: boolean; };
    financialFlow: boolean;
    dre: boolean;
    expenses: { view: boolean; create: boolean; edit: boolean; pay: boolean; import: boolean; delete: boolean; };
    settings: { view: boolean; manageAccountPlans: boolean; manageResultCenters: boolean; manageBankAccounts: boolean; manageImportAliases: boolean; };
  };
  purchasing: {
    view: boolean;
    createQuotation: boolean;
    finalizeQuotation: boolean;
    createPurchase: boolean;
    receivePurchase: boolean;
    cancelPurchase: boolean;
    manageFinancialLink: boolean;
    manageBaseItems: boolean;
  };
  // Conceptual groupers — granular fields defined in Plano Técnico de Formulários
  hr: {
    view: boolean;
    employees: { view: boolean; manage: boolean };
    org_chart: { view: boolean; manage: boolean };
    roles: { view: boolean; manage: boolean; propagate: boolean };
    functions: { view: boolean; manage: boolean };
    navigation: { view: boolean };
  };
  recruitment: {
    view: boolean;
    manage: boolean;
    pipeline: { view: boolean; manage: boolean };
    templates: { view: boolean; manage: boolean };
    talent_pool: { view: boolean; manage: boolean };
    hire: boolean;
  };
  forms: {
    global: {
      view_all_projects: boolean;
      create_projects: boolean;
      manage_templates: boolean;
      view_analytics: boolean;
    };
    projects: Record<
      string,
      { view: boolean; operate: boolean; manage: boolean }
    >;
  };
};

export type Profile = {
    id: string;
    name: string;
    isDefaultAdmin?: boolean;
    permissions: Partial<PermissionSet>;
}

export type User = {
  id: string; // Firebase Auth UID
  username: string;
  email: string;
  profileId: string;
  assignedKioskIds: string[];
  avatarUrl?: string;
  color?: string;              // hex color for avatar/schedule display
  // Operacional (PDV)
  operacional?: boolean;
  participatesInGoals?: boolean;
  pdvOperatorIds?: { [kioskId: string]: number };
  // Departamento Pessoal (RH)
  registrationIdBizneo?: string;   // matrícula no Bizneo HR
  registrationIdPdv?: string;      // código no PDV
  jobRoleId?: string;
  jobRoleName?: string;
  jobFunctionIds?: string[];
  jobFunctionNames?: string[];
  jobRoleProfileSyncDisabled?: boolean;
  unitIds?: string[];               // unidade(s) de trabalho
  admissionDate?: Timestamp;
  birthDate?: Timestamp;
  shiftDefinitionId?: string;
  loginRestrictionEnabled?: boolean;
  needsTransportVoucher?: boolean;
  transportVoucherValue?: number;
  isActive?: boolean;
  terminationDate?: Timestamp;
  terminationReason?: 'Sem Justa Causa' | 'Pedido de Demissão' | 'Acordo' | 'Justa Causa';
  terminationCause?: string;
  terminationNotes?: string;
};

export type HrQuestionType =
  | "text"
  | "yes_no"
  | "select"
  | "multi_select"
  | "number_range"
  | "date"
  | "location"
  | "file_upload";

export type HrQuestionWeight = "low" | "medium" | "high";

export type HrFormQuestion = {
  id: string;
  text: string;
  type: HrQuestionType;
  required: boolean;
  scored: boolean;
  weight: HrQuestionWeight;
  eliminatory: boolean;
  expectedAnswer?: unknown;
  tags?: string[];
  config?: Record<string, unknown>;
};

export type JobRoleSalaryRange = {
  min?: number;
  max?: number;
  currency: string;
  visible?: boolean;
};

export type CandidateStatus = 'applied' | 'screening' | 'interview' | 'technical_test' | 'offer' | 'hired' | 'rejected' | 'withdrawn';

export type Candidate = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  resumeUrl?: string;
  jobRoleId: string;
  jobRoleName?: string;
  status: CandidateStatus;
  notes?: string;
  rating?: number; // 1-5
  source?: string;
  appliedAt: string;
  updatedAt: string;
  createdBy: string;
};

export type JobRole = {
// ...
  id: string;
  name: string;
  publicTitle: string;
  slug: string;
  reportsTo?: string | null;
  description?: string;
  publicDescription?: string;
  responsibilities?: string[];
  publicResponsibilities?: string[];
  requirements?: string[];
  publicRequirements?: string[];
  competencies?: string[];
  benefits?: string[];
  workSchedule?: string;
  salaryRange?: JobRoleSalaryRange;
  publicSalaryRange?: JobRoleSalaryRange;
  defaultProfileId?: string;
  loginRestricted?: boolean;
  formQuestions?: HrFormQuestion[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type JobFunction = {
  id: string;
  name: string;
  publicTitle: string;
  slug: string;
  description?: string;
  publicDescription?: string;
  responsibilities?: string[];
  publicResponsibilities?: string[];
  requirements?: string[];
  compatibleRoleIds?: string[];
  formQuestions?: HrFormQuestion[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SignageSlideType = 'image' | 'video' | 'text';

export type SignageSlide = {
  id: string;
  title: string;
  type: SignageSlideType;
  durationMs: number;
  order: number;
  kioskIds: string[];
  isActive: boolean;
  assetUrl?: string;
  assetPath?: string;
  assetKind?: 'image' | 'video';
  text?: string;
  background?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    userId: string;
    username: string;
  };
  updatedBy: {
    userId: string;
    username: string;
  };
};

export type PublishedPlayerSlide = {
  id: string;
  title: string;
  type: SignageSlideType;
  durationMs: number;
  order: number;
  assetUrl?: string;
  assetKind?: 'image' | 'video';
  text?: string;
  background?: string;
};

export type PublishedPlayerDocument = {
  kioskId: string;
  kioskName?: string;
  updatedAt: string;
  generatedBy: {
    userId: string;
    username: string;
  };
  slides: PublishedPlayerSlide[];
};

export type PlayerHeartbeat = {
  kioskId: string;
  kioskName?: string;
  lastSeenAt: string;
  status: 'cache' | 'realtime';
  currentSlideId?: string;
  updatedAt?: string;
};

export type Product = {
  id: string;
  baseName: string;
  brand?: string;
  barcode?: string;
  imageUrl?: string;
  packageType?: PackageType;
  category: UnitCategory;
  packageSize: number;
  unit: string;
  notes?: string;
  countingInstruction?: string;
  countingInstructionImageUrl?: string;
  defaultCountingUnit?: 'package' | 'base' | 'content';
  multiplo_caixa?: number;
  rotulo_caixa?: string;
  pdfUnit?: string;
  alertThreshold?: number; // e.g., 30 days
  urgentThreshold?: number; // e.g., 7 days
  secondaryUnit?: string;
  secondaryUnitValue?: number;
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

export type BaseProduct = {
  id: string;
  name: string;
  barcode?: string;
  barcodes?: string[];
  classification?: string;
  category: UnitCategory;
  unit: string;
  initialCostPerUnit?: number;
  stockLevels: { [kioskId: string]: BaseProductStockLevel };
  consumptionMonths?: number;
  lastEffectivePrice?: PriceHistoryEntry;
  isArchived?: boolean;
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

export type StockAuditDivergence = {
    id: string;
    reason: MovementType;
    quantity?: number;
    notes?: string;
};

export type StockAuditAdjustment = {
    id: string;
    reason: 'ENTRADA_CORRECAO';
    quantity?: number;
    notes?: string;
};

export type StockAuditItem = {
    productId: string;
    productName: string;
    lotId: string;
    lotNumber: string;
    expiryDate: string; // ISO String
    systemQuantity: number;
    displayUnit: string;
    finalQuantity: number;
    adjustment?: { // Kept for compatibility, but `divergences` array is the new source of truth.
        type: 'positive' | 'negative';
        quantity: number;
        notes?: string;
    } | null;
    divergences: StockAuditDivergence[];
    adjustments: StockAuditAdjustment[]; // New field for positive adjustments
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
    createdAt: string; // ISO String
    updatedAt: string; // ISO String
    isArchived?: boolean;
    createdBy: {
        userId: string;
        username: string;
    };
    taskId?: string;
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

// Purchase Module Types (legacy — cotação v1)
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
  valor_total_estimado?: number;
  type: 'manual' | 'automatic';
  status: 'open' | 'closed';
  createdAt: string; // ISO String
  closedAt?: string; // ISO String
};

// ─── Purchasing v2 — Cotação ───────────────────────────────────────────────

export type QuotationMode = 'remote' | 'in_loco';

export type QuotationStatus =
  | 'draft'
  | 'quoted'
  | 'partially_converted'
  | 'converted'
  | 'archived'
  | 'expired'
  | 'cancelled';

export type Quotation = {
  id: string;
  workspaceId: string;
  supplierId: string; // ref → entities collection
  mode: QuotationMode;
  status: QuotationStatus;
  validUntil?: string; // ISO date
  notes?: string;
  createdAt: string;
  createdBy: string; // userId
  finalizedAt?: string;
  archivedAt?: string;
};

export type QuotationItemConversionStatus = 'pending' | 'selected' | 'converted' | 'discarded';
export type PurchaseUnitType = 'content' | 'logistic';

export type QuotationItem = {
  id: string;
  quotationId: string;
  baseItemId?: string; // ref → baseProducts; null = free item
  productId?: string; // ref → products; used when the purchased derivative is known
  freeText?: string;   // used when baseItemId is null
  barcode?: string;    // EAN scanned in in_loco mode
  unit: string;
  purchaseUnitType?: PurchaseUnitType;
  purchaseUnitLabel?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  totalPrice: number;  // unitPrice * quantity
  deliveryEstimateDays?: number;
  observation?: string;
  conversionStatus: QuotationItemConversionStatus;
  convertedToPurchaseItemId?: string;
};

// ─── Purchasing v2 — Compra ────────────────────────────────────────────────

export type PurchaseOrigin = 'quotation' | 'direct';
export type PurchaseReceiptMode = 'future_delivery' | 'immediate_pickup';
export type PaymentMethod = 'pix' | 'card_credit' | 'card_debit' | 'cash' | 'boleto' | 'term';
export type PurchasePaymentCondition = 'cash' | 'installments';

export type PurchaseOrderStatus = 'created' | 'confirmed' | 'cancelled';

export type PurchaseOrder = {
  id: string;
  workspaceId: string;
  origin: PurchaseOrigin;
  quotationId?: string;
  supplierId: string; // ref → entities collection
  receiptMode: PurchaseReceiptMode;
  status: PurchaseOrderStatus;
  estimatedReceiptDate: string; // ISO date; equals createdAt for immediate_pickup
  paymentDueDate: string;
  paymentMethod: PaymentMethod;
  paymentCondition?: PurchasePaymentCondition;
  installmentsCount?: number;
  accountPlanId?: string;
  accountPlanName?: string;
  freightAccountPlanId?: string;
  freightAccountPlanName?: string;
  resultCenterId?: string;
  resultCenterName?: string;
  deliveryFee?: number;
  totalEstimated: number;
  totalConfirmed?: number; // filled after receipt
  notes?: string;
  linkedExpenseId?: string;
  createdAt: string;
  createdBy: string; // userId
  confirmedAt?: string;
  confirmedBy?: string; // userId
  receivedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
};

export type PurchaseOrderItem = {
  id: string;
  purchaseOrderId: string;
  baseItemId: string; // always required (item already normalized)
  productId?: string; // ref → products; needed to confirm base-unit cost at purchase time
  quotationItemId?: string; // null in direct purchases
  unit: string;
  purchaseUnitType?: PurchaseUnitType;
  purchaseUnitLabel?: string;
  quantityOrdered: number;
  unitPriceOrdered: number;
  discountOrdered?: number;
  totalOrdered: number;
  notes?: string;
  // filled during receipt
  quantityReceived?: number;
  unitPriceConfirmed?: number;
  totalConfirmed?: number;
};

// ─── Purchasing v2 — Recebimento ──────────────────────────────────────────

export type PurchaseReceiptStatus =
  | 'awaiting_delivery'       // future_delivery only
  | 'in_conference'
  | 'awaiting_stock'
  | 'in_stock_entry'
  | 'partially_stocked'
  | 'stocked'
  | 'stocked_with_divergence'
  | 'cancelled';

export type PurchaseReceipt = {
  id: string;
  workspaceId: string;
  purchaseOrderId: string;
  supplierId: string; // ref → entities collection
  supplierName?: string;
  receiptMode: PurchaseReceiptMode;
  status: PurchaseReceiptStatus;
  expectedDate: string;
  totalEstimated?: number;
  totalConfirmed?: number;
  totalExpected?: number;
  conferenceStartedAt?: string;
  conferenceCompletedAt?: string;
  stockEntryStartedAt?: string;
  stockEnteredAt?: string;
  receivedAt?: string;
  receiptProofUrl?: string;
  receiptProofDescription?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseReceiptItemStatus = 'pending' | 'received' | 'partial' | 'divergent' | 'cancelled';

export type PurchaseReceiptItem = {
  id: string;
  purchaseReceiptId: string;
  purchaseOrderItemId: string;
  baseItemId: string;
  productId?: string;
  unit: string;
  purchaseUnitType?: PurchaseUnitType;
  purchaseUnitLabel?: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitPriceOrdered: number;
  unitPriceConfirmed: number;
  totalConfirmed: number;
  status: PurchaseReceiptItemStatus;
  divergenceReason?: string;
  // subcollection lots are fetched separately; this array is used in-memory only
  lots?: PurchaseReceiptLot[];
};

export type PurchaseReceiptLot = {
  id: string;
  purchaseReceiptItemId: string;
  baseItemId: string;
  lotCode: string; // e.g. MOR-2026-04-A
  expiryDate?: string;
  quantity: number; // quantidade recebida na unidade comprada
  stockQuantity?: number; // quantidade convertida para a unidade de estoque
  purchaseUnitType?: PurchaseUnitType;
  purchaseUnitLabel?: string;
  unitCost: number; // = unitPriceConfirmed
  occurredAt?: string;
};

// ─── Purchasing v2 — Financeiro ───────────────────────────────────────────

export type PurchaseFinancialStatus = 'forecasted' | 'confirmed' | 'divergent' | 'paid' | 'cancelled';

export type PurchaseFinancial = {
  id: string;
  workspaceId: string;
  purchaseOrderId: string;
  supplierId: string;
  receiptMode: PurchaseReceiptMode;
  status: PurchaseFinancialStatus;
  accountPlanId?: string;
  accountPlanName?: string;
  freightAccountPlanId?: string;
  freightAccountPlanName?: string;
  resultCenterId?: string;
  resultCenterName?: string;
  deliveryFee?: number;
  amountEstimated: number;
  amountConfirmed?: number;
  paymentMethod: PaymentMethod;
  paymentDueDate: string;
  paymentCondition?: PurchasePaymentCondition;
  installmentsCount?: number;
  linkedExpenseId?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
};

// ─── Purchasing v2 — Custo Efetivo ────────────────────────────────────────

export type EffectiveCostEntry = {
  id: string;
  workspaceId: string;
  baseItemId: string;   // ref → baseProducts
  supplierId: string;   // ref → entities
  unitCost: number; // custo por unidade base
  quantity: number; // quantidade em unidade base
  purchasePrice?: number; // preço pago na unidade comprada
  purchaseQuantity?: number; // quantidade recebida na unidade comprada
  purchaseUnitType?: PurchaseUnitType;
  purchaseUnitLabel?: string;
  stockProductId?: string;
  stockProductQuantity?: number;
  // full reverse traceability chain
  purchaseReceiptId: string;
  purchaseReceiptLotId: string;
  purchaseOrderId: string;
  quotationId?: string;
  quotationItemId?: string;
  occurredAt: string; // ISO date of receipt
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
    dataUrl?: string;
    physicalCopyUrl?: string;
    signedBy?: string;
    signedAt?: string; // ISO String
};

export type RepositionActivity = {
  id: string;
  taskId?: string;
  status: RepositionActivityStatus;
  kioskOriginId: string;
  kioskOriginName: string;
  kioskDestinationId: string;
  kioskDestinationName: string;
  requestedBy: {
    userId: string;
    username: string;
  };
  updatedBy?: {
    userId: string;
    username: string;
  };
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
  items: RepositionItem[];
  transportDocumentUrl?: string;
  transportSignature?: Partial<SignatureData>;
  receiptNotes?: string;
  receiptSignature?: Partial<SignatureData>;
  isSeparated?: boolean;
};

export type ProfitRange = {
  id: string;
  from: number;
  to: number;
  color: string;
};

export type PricingParameters = {
  averageTaxPercentage: number;
  averageCardFeePercentage: number;
  profitGoals: number[];
  profitRanges: ProfitRange[];
};

export const defaultGuestPermissions: PermissionSet = {
    dashboard: { view: false, operational: false, pricing: false, audit: false, technicalSheets: false },
    registration: { view: false, items: { add: false, edit: false, delete: false }, baseProducts: { add: false, edit: false, delete: false }, entities: { add: false, edit: false, delete: false } },
    stock: { 
      view: false, 
      inventoryControl: { view: false, addLot: false, editLot: false, writeDown: false, transfer: false, viewHistory: false }, 
      // `audit` permissions are now synced with `stockCount` for backward compatibility with Firestore rules, but UI uses `stockCount`.
      stockCount: { view: false, perform: false, approve: false, requestItem: false }, 
      audit: { view: false, start: false, approve: false }, 
      analysis: { view: false, restock: false, consumption: false, projection: false, valuation: false }, 
      purchasing: { view: false, suggest: false, approve: false, deleteHistory: false }, 
      returns: { view: false, add: false, updateStatus: false, delete: false }, 
      conversions: { view: false }, 
      predefinedLists: { view: true, manage: true }
    },
    pricing: { view: false, simulate: false, manageParameters: false },
    settings: { view: false, manageUsers: false, manageKiosks: false, manageProfiles: false, manageLabels: false },
    tasks: { view: false, manage: false },
    goals: { view: false, manage: false },
    help: { view: true },
    reposition: { cancel: false },
    // itemRequests is now managed under stock.stockCount
    itemRequests: { add: false, approve: false },
    signage: { view: false, manage: false },
    dp: {
      view: false,
      schedules: { view: false, create: false, edit: false, delete: false, export: false },
      vacation: { viewAll: false, request: false, approve: false, manageSettings: false },
      collaborators: { view: false, add: false, edit: false, terminate: false },
      checklists: { view: false, operate: false, create: false, manageTemplates: false, viewAnalytics: false },
      settings: { manageUnits: false, manageShifts: false, manageCalendars: false, manageChecklistTypes: false },
    },
    financial: {
      view: false,
      dashboard: false,
      cashFlow: { view: false, create: false },
      financialFlow: false,
      dre: false,
      expenses: { view: false, create: false, edit: false, pay: false, import: false, delete: false },
      settings: { view: false, manageAccountPlans: false, manageResultCenters: false, manageBankAccounts: false, manageImportAliases: false },
    },
    purchasing: {
      view: false,
      createQuotation: false,
      finalizeQuotation: false,
      createPurchase: false,
      receivePurchase: false,
      cancelPurchase: false,
      manageFinancialLink: false,
      manageBaseItems: false,
    },
    hr: {
      view: false,
      employees: { view: false, manage: false },
      org_chart: { view: false, manage: false },
      roles: { view: false, manage: false, propagate: false },
      functions: { view: false, manage: false },
      navigation: { view: false },
    },
    recruitment: {
      view: false,
      manage: false,
      pipeline: { view: false, manage: false },
      templates: { view: false, manage: false },
      talent_pool: { view: false, manage: false },
      hire: false,
    },
    forms: {
      global: {
        view_all_projects: false,
        create_projects: false,
        manage_templates: false,
        view_analytics: false,
      },
      projects: {},
    },
};


export const defaultAdminPermissions: PermissionSet = {
    dashboard: { view: true, operational: true, pricing: true, audit: true, technicalSheets: true },
    registration: { view: true, items: { add: true, edit: true, delete: true }, baseProducts: { add: true, edit: true, delete: true }, entities: { add: true, edit: true, delete: true } },
    stock: { view: true, inventoryControl: { view: true, addLot: true, editLot: true, writeDown: true, transfer: true, viewHistory: true }, stockCount: { view: true, perform: true, approve: true, requestItem: true }, audit: { view: true, start: true, approve: true }, analysis: { view: true, restock: true, consumption: true, projection: true, valuation: true }, purchasing: { view: true, suggest: true, approve: true, deleteHistory: true }, returns: { view: true, add: true, updateStatus: true, delete: true }, conversions: { view: true }, predefinedLists: { view: true, manage: true } },
    pricing: { view: true, simulate: true, manageParameters: true },
    settings: { view: true, manageUsers: true, manageKiosks: true, manageProfiles: true, manageLabels: true },
    tasks: { view: true, manage: true },
    goals: { view: true, manage: true },
    reposition: { cancel: true },
    help: { view: true },
    itemRequests: { add: true, approve: true },
    signage: { view: true, manage: true },
    dp: {
      view: true,
      schedules: { view: true, create: true, edit: true, delete: true, export: true },
      vacation: { viewAll: true, request: true, approve: true, manageSettings: true },
      collaborators: { view: true, add: true, edit: true, terminate: true },
      checklists: { view: true, operate: true, create: true, manageTemplates: true, viewAnalytics: true },
      settings: { manageUnits: true, manageShifts: true, manageCalendars: true, manageChecklistTypes: true },
    },
    financial: {
      view: true,
      dashboard: true,
      cashFlow: { view: true, create: true },
      financialFlow: true,
      dre: true,
      expenses: { view: true, create: true, edit: true, pay: true, import: true, delete: true },
      settings: { view: true, manageAccountPlans: true, manageResultCenters: true, manageBankAccounts: true, manageImportAliases: true },
    },
    purchasing: {
      view: true,
      createQuotation: true,
      finalizeQuotation: true,
      createPurchase: true,
      receivePurchase: true,
      cancelPurchase: true,
      manageFinancialLink: true,
      manageBaseItems: true,
    },
    hr: {
      view: true,
      employees: { view: true, manage: true },
      org_chart: { view: true, manage: true },
      roles: { view: true, manage: true, propagate: true },
      functions: { view: true, manage: true },
      navigation: { view: true },
    },
    recruitment: {
      view: true,
      manage: true,
      pipeline: { view: true, manage: true },
      templates: { view: true, manage: true },
      talent_pool: { view: true, manage: true },
      hire: true,
    },
    forms: {
      global: {
        view_all_projects: true,
        create_projects: true,
        manage_templates: true,
        view_analytics: true,
      },
      projects: {},
    },
};

export const defaultUserPermissions: PermissionSet = { ...defaultGuestPermissions };


export type LegacyTaskOriginType =
  | 'form'
  | 'return_request'
  | 'reposition_activity'
  | 'stock_count_approval'
  | 'author_board_diary'
  | 'consumption-projection'
  | 'item_addition_request';

export type TaskOrigin =
  | {
      kind: 'manual';
      details?: any;
    }
  | {
      kind: 'form_trigger';
      execution_id: string;
      template_item_id: string;
      template_section_id: string;
      questionId?: string;
      details?: any;
    }
  | {
      kind: 'purchase_receipt';
      receipt_id: string;
      purchase_order_id: string;
      details?: any;
    }
  | {
      kind: 'legacy';
      type: LegacyTaskOriginType;
      id: string; // ID do documento de origem legado
      questionId?: string;
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
    projectId?: string;
    statusId?: string;
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

export type MoveLotParams = {
  lotId: string;
  toKioskId: string;
  quantityToMove: number;
  fromKioskId: string;
  fromKioskName: string;
  toKioskName: string;
  productName: string; 
  lotNumber: string;
  productId: string;
};

export interface RepositionContextType {
  activities: RepositionActivity[];
  loading: boolean;
  createRepositionActivity: (data: Omit<RepositionActivity, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'requestedBy' | 'updatedBy'>) => Promise<string | null>;
  updateRepositionActivity: (activityId: string, updates: Partial<RepositionActivity>) => Promise<void>;
  cancelRepositionActivity: (activityId: string) => Promise<void>;
  finalizeRepositionActivity: (activity: RepositionActivity, resolution?: 'trust_receipt' | 'trust_dispatch') => Promise<void>;
  revertRepositionActivity: (activityId: string) => Promise<void>;
}

// ── METAS ──────────────────────────────────────────────────────────────────
export type GoalType = 'revenue' | 'ticket' | 'product_line' | 'product_specific'
export type GoalPeriod = 'daily' | 'weekly' | 'monthly'
export type GoalStatus = 'active' | 'closed' | 'cancelled'

export interface GoalShift {
  id: string
  label: string
  fraction: number
}

export interface GoalTemplate {
  id: string
  kioskId: string
  type: GoalType
  period: GoalPeriod
  targetValue: number
  upValue: number
  productRef?: string      // product_specific: ProductSimulation.id or name
  productLineRef?: string  // product_line: SimulationCategory.id
  productLineName?: string // product_line: display label
  productName?: string     // product_specific: display label
  createdAt: Timestamp
}

export interface GoalPeriodDoc {
  id: string
  templateId: string
  kioskId: string
  startDate: Timestamp
  endDate: Timestamp
  targetValue: number
  upValue: number
  currentValue: number
  dailyProgress?: { [date: string]: number }
  shifts?: GoalShift[]
  status: GoalStatus
  closedAt?: Timestamp
  closedBy?: string
  closureNote?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface EmployeeGoal {
  id: string
  periodId: string
  employeeId: string
  kioskId: string
  shiftId?: string
  fraction: number
  targetValue: number
  currentValue: number
  dailyProgress?: { [date: string]: number }
  updatedAt: Timestamp
  createdAt: Timestamp
}

// ─── Departamento Pessoal ─────────────────────────────────────────────────────
// Colaboradores = usuários do sistema (users/). Não há coleção separada.

export type DPUnit = {
  id: string;
  name: string;
  groupId?: string;
  bizneoTaxonId?: number; // ID do taxon (local) no Bizneo
  auditChecklistThreshold?: number;
  createdAt: Timestamp;
};

export type DPUnitGroup = {
  id: string;
  name: string;
  unitCount?: number;
  createdAt: Timestamp;
};

export type DPShiftDefinition = {
  id: string;
  code: string;
  name: string;
  startTime: string;   // HH:mm — início do primeiro range
  endTime: string;     // HH:mm — fim do último range
  breakStart?: string; // HH:mm — início do intervalo (opcional); gera dois time_ranges no Bizneo
  breakEnd?: string;   // HH:mm — fim do intervalo
  unitId?: string;     // legado: primeira unidade vinculada
  unitName?: string;   // legado: nome da primeira unidade vinculada
  unitIds?: string[];
  unitNames?: string[];
  daysOfWeek: number[]; // 0=Dom, 1=Seg, ...
  bizneoTemplateId?: string; // ID numérico do modelo no Bizneo (usado no shift_id do export)
  createdAt: Timestamp;
};

export type DPScheduleSnapshot = {
  users: Record<string, { username: string; color?: string; avatarUrl?: string; needsTransportVoucher?: boolean; transportVoucherValue?: number }>;
};

export type DPSchedule = {
  id: string;
  name: string;
  month: number; // 1–12
  year: number;
  shiftCount: number;
  unitId?: string;     // per-unit schedule; absent = legacy (all units)
  calendarId?: string; // optional: linked holiday calendar
  locked?: boolean;    // when true, snapshot is frozen
  snapshot?: DPScheduleSnapshot; // frozen user data at lock time
  createdAt: Timestamp;
};

export type DPShift = {
  id: string;
  scheduleId: string;
  unitId: string;
  userId: string;            // referência ao users/ (Firebase UID)
  shiftDefinitionId?: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  type: 'work' | 'day_off';
  hasConflict?: boolean;
  consecutiveDayCount?: number;
  createdAt: Timestamp;
};

export type DPCalendar = {
  id: string;
  name: string;
  year: number;
  state?: string;
  city?: string;
  holidayCount: number;
  createdAt: Timestamp;
};

export type DPHolidayType = 'national' | 'state' | 'municipal' | 'optional';

export type DPHoliday = {
  id: string;
  name: string;
  date: Timestamp;
  type: DPHolidayType;
  createdAt: Timestamp;
};

export type DPVacationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PLANNED';
export type DPVacationRecordType = 'gozo' | 'venda';

export type DPVacationRecord = {
  id: string;
  userId: string;            // referência ao users/ (Firebase UID)
  cycleId: string; // e.g. "2023-2024"
  recordType: DPVacationRecordType;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;
  days: number;
  status: DPVacationStatus;
  paymentDate?: string;
  returnDate?: string;
  warnings: string[];
  createdAt: Timestamp;
};

export type DPChecklistItemType =
  | "checkbox"
  | "text"
  | "number"
  | "temperature"
  | "select"
  | "photo"
  | "signature"
  | "yes_no"
  | "multi_select"
  | "date";

export type DPChecklistTemplateType = string;

export type DPChecklistTypeColorScheme =
  | "emerald"
  | "indigo"
  | "amber"
  | "violet"
  | "blue"
  | "orange"
  | "red"
  | "gray";

export type DPChecklistType = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  examples: string;
  behavior: string;
  configBanner: string;
  isSchedulable: boolean;
  colorScheme: DPChecklistTypeColorScheme;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type DPChecklistOccurrenceType =
  | "manual"
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "annual"
  | "custom";

export type CustomScheduleMode = "weekdays" | "monthdays" | "interval" | "once";

export type CustomSchedule = {
  modes: CustomScheduleMode[];
  weekdays?: number[]; // 0=Dom..6=Sáb
  monthdays?: number[]; // 1..31
  intervalDays?: number;
  onceDates?: string[]; // YYYY-MM-DD
};

export type DPChecklistCriticality = "low" | "medium" | "high" | "critical";

export type DPChecklistConditionalOperator =
  | "equals"
  | "not_equals"
  | "gt"
  | "lt"
  | "contains";

export type DPChecklistConditionalRule = {
  itemId: string;
  operator: DPChecklistConditionalOperator;
  value?: unknown;
};

export type DPChecklistVersionHistoryEntry = {
  version: number;
  updatedBy: string;
  updatedAt: Timestamp | string;
  changeNotes?: string;
};

export type DPChecklistBranchPathEntry = {
  parentItemId: string;
  triggerValue?: unknown;
};

export type DPChecklistItemConfig = {
  min?: number;
  max?: number;
  unit?: string;
  alertOutOfRange?: boolean;
  options?: string[];
  minPhotos?: number;
  maxPhotos?: number;
};

export type DPChecklistTemplateItem = {
  id: string;
  order: number;
  title: string;
  description?: string;
  type: DPChecklistItemType;
  required: boolean;
  weight: number;
  blockNext: boolean;
  criticality: DPChecklistCriticality;
  referenceValue?: number;
  tolerancePercent?: number;
  actionRequired?: boolean;
  notifyRoleIds?: string[];
  escalationMinutes?: number;
  showIf?: DPChecklistConditionalRule;
  conditionalBranches?: Array<{
    value?: unknown;
    label: string;
    items: DPChecklistTemplateItem[];
  }>;
  config?: DPChecklistItemConfig;
};

export type DPChecklistSection = {
  id: string;
  title: string;
  order: number;
  showIf?: DPChecklistConditionalRule;
  requirePhoto?: boolean;
  requireSignature?: boolean;
  items: DPChecklistTemplateItem[];
};

export type DPChecklistTemplate = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  templateType: DPChecklistTemplateType;
  occurrenceType?: DPChecklistOccurrenceType;
  annualSchedule?: { month: number; day: number };
  customSchedule?: CustomSchedule;
  unitIds?: string[];
  unitNames?: string[];
  jobRoleIds?: string[];
  jobRoleNames?: string[];
  jobFunctionIds?: string[];
  jobFunctionNames?: string[];
  shiftDefinitionIds?: string[];
  shiftDefinitionNames?: string[];
  isActive: boolean;
  version: number;
  versionHistory?: DPChecklistVersionHistoryEntry[];
  lastExecutionAt?: string | null;
  sections: DPChecklistSection[];
  createdAt: Timestamp | string;
  updatedAt?: Timestamp | string;
  createdBy?: { userId: string; username: string; };
  updatedBy?: { userId: string; username: string; };
};

export type DPChecklistExecutionStatus = "pending" | "claimed" | "completed" | "overdue";

export type DPChecklistExecutionItem = {
  templateItemId: string;
  sectionId: string;
  sectionTitle: string;
  order: number;
  title: string;
  description?: string;
  type: DPChecklistItemType;
  required: boolean;
  weight: number;
  blockNext: boolean;
  criticality: DPChecklistCriticality;
  referenceValue?: number;
  tolerancePercent?: number;
  actionRequired?: boolean;
  notifyRoleIds?: string[];
  escalationMinutes?: number;
  branchPath?: DPChecklistBranchPathEntry[];
  showIf?: DPChecklistConditionalRule;
  sectionShowIf?: DPChecklistConditionalRule;
  config?: DPChecklistItemConfig;
  checked?: boolean | null;
  yesNoValue?: boolean | null;
  textValue?: string;
  numberValue?: number;
  multiValues?: string[];
  dateValue?: string;
  photoUrls?: string[];
  signatureUrl?: string;
  isLate?: boolean;
  isOutOfRange?: boolean;
  completedAt?: string | null;
  completedByUserId?: string | null;
  linkedTaskId?: string | null;
};

export type DPChecklistExecutionSection = {
  id: string;
  title: string;
  order: number;
  showIf?: DPChecklistConditionalRule;
  requirePhoto?: boolean;
  requireSignature?: boolean;
};

export type DPChecklistExecution = {
  id: string;
  checklistDate: string;
  templateId: string;
  templateName: string;
  templateType: DPChecklistTemplateType;
  templateVersion: number;
  occurrenceType?: DPChecklistOccurrenceType;
  scheduleId: string;
  shiftId: string;
  unitId: string;
  unitName?: string;
  shiftDefinitionId?: string;
  shiftDefinitionName?: string;
  assignedUserId: string;
  assignedUsername: string;
  collaboratorUserIds?: string[];
  collaboratorUsernames?: string[];
  createdByUserId?: string;
  createdByUsername?: string;
  sections: DPChecklistExecutionSection[];
  shiftStartTime: string;
  shiftEndTime: string;
  shiftEndDate: string;
  status: DPChecklistExecutionStatus;
  score?: number;
  items: DPChecklistExecutionItem[];
  incidentContext?: string | null;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  scheduledDate?: string | null;
  claimedByUserId?: string | null;
  claimedByUsername?: string | null;
  claimedAt?: string | null;
  completedByUserId?: string | null;
  completedByUsername?: string | null;
  completedAt?: string | null;
  reviewedBy?: string | null;
  reviewNotes?: string | null;
  createdAt: Timestamp | string;
  updatedAt?: Timestamp | string;
};

export type OperationalTaskStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "escalated"
  | "closed";

export type OperationalTask = {
  id: string;
  executionId: string;
  sectionId: string;
  itemId: string;
  itemTitle: string;
  unitId: string;
  unitName: string;
  description: string;
  status: OperationalTaskStatus;
  assignedToRoleIds: string[];
  assignedToUserId?: string;
  assignedToUserName?: string;
  slaMinutes: number;
  slaDeadlineAt: Timestamp | string;
  escalatedAt?: Timestamp | string;
  resolvedAt?: Timestamp | string;
  resolvedBy?: string;
  resolutionNotes?: string;
  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
};

// ─── New task motor — Etapa 8 (task_projects / task_statuses / tasks) ──────────

export type TaskStatusCategory = 'not_started' | 'active' | 'done' | 'canceled';

export type TaskStatusDoc = {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  category: TaskStatusCategory;
  is_initial: boolean;
  is_terminal: boolean;
  order: number;
  color?: string;
};

export type TaskProject = {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  members: { user_id: string; username: string; role: 'viewer' | 'operator' | 'manager' }[];
  created_at: string;
  updated_at: string;
  created_by: { user_id: string; username: string };
};

// Origin data for tasks generated from a FormExecution
export type FormOrigin = {
  execution_id: string;
  template_id: string;
  form_project_id: string;
  form_type_id: string;
  form_subtype_id?: string;
  // section_id: seção do FormExecution que originou a tarefa (rastreabilidade reversa)
  section_id: string;
  template_item_id: string;
  trigger_id: string;
};

// Task in the project-based motor; id is deterministic SHA-256 via buildDeterministicTaskId()
export type FormTask = {
  id: string;
  workspace_id: string;
  project_id: string;
  status_id: string;
  title: string;
  description?: string;
  assignee_type: 'user' | 'role';
  assignee_id: string;
  assignee_name?: string;
  requires_approval: boolean;
  approver_id?: string;
  approver_name?: string;
  form_origin: FormOrigin;
  dedupe_key: string;
  // section_id mirrors form_origin.section_id — kept at top level for Firestore indexing
  section_id: string;
  order: number;
  due_date?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
};
