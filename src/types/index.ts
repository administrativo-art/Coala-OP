import { type Timestamp } from 'firebase/firestore';
export const unitCategories = ["Volume", "Massa", "Unidade", "Embalagem", "Vestimenta"] as const;
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
  deviceToken?: string;
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

export type OperationalItemDestination = 'stock' | 'uniform' | 'asset';
export type UniformCondition = 'novo' | 'usado';
export type UniformStockStatus = 'disponivel' | 'em_avaliacao';

export type OperationalItemCategory = {
  id: string;
  name: string;
  slug: string;
  destination: OperationalItemDestination;
  isArchived?: boolean;
  workspaceId?: string;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
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
    },
    Vestimenta: {
      'peça': 1,
      'un': 1,
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
  condition?: UniformCondition;
  uniformStockStatus?: UniformStockStatus;
  workspaceId?: string;
  apparelType?: string;
  apparelSize?: string;
  apparelColor?: string;
  uniformCareInstructions?: InstructionSection[];
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
    | 'SAIDA_ENTREGA_UNIFORME'
    | 'SAIDA_DESCARTE_VENCIMENTO'
    | 'SAIDA_DESCARTE_AVARIA'
    | 'SAIDA_DESCARTE_PERDA'
    | 'SAIDA_DESCARTE_OUTROS'
    | 'SAIDA_CORRECAO'
    | 'ENTRADA_CORRECAO'
    | 'ENTRADA_DEVOLUCAO_UNIFORME'
    | 'MIGRACAO_ESTOQUE_UNIFORME'
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
  sourceType?: string;
  sourceId?: string;
  uniformEventId?: string;
  deliveredToUserId?: string;
  deliveredToUserName?: string;
  deliveredAt?: string;
  itemClass?: 'uniform';
};

export type AssetStatus =
  | 'ativo'
  | 'em_manutencao'
  | 'fora_de_uso'
  | 'extraviado'
  | 'vendido'
  | 'descartado'
  | 'baixado';

export type AssetMovementType =
  | 'CRIACAO'
  | 'EDICAO'
  | 'TRANSFERENCIA'
  | 'ALTERACAO_STATUS'
  | 'BAIXA'
  | 'ETIQUETA_REIMPRESSA'
  | 'RETIRADA'
  | 'COMPONENTE';

export type Asset = {
  id: string;
  code: string;
  name: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  assetTag?: string;
  description?: string;
  currentKioskId: string;
  currentKioskName?: string;
  department?: string;
  exactLocation?: string;
  responsibleUserId?: string;
  responsibleName?: string;
  responsibilityStatus?: 'assigned' | 'pending_assignment';
  previousResponsibleUserId?: string;
  previousResponsibleName?: string;
  responsibilityVacatedAt?: string;
  inUse?: boolean;
  possessionStatus?: string;
  status: AssetStatus;
  purchaseDate?: string;
  purchaseValue?: number;
  supplierId?: string;
  supplierName?: string;
  invoiceNumber?: string;
  paymentMethod?: string;
  costCenter?: string;
  accountingAccount?: string;
  documentUrl?: string;
  usefulLifeYears?: number;
  residualValue?: number;
  depreciationMethod?: string;
  accumulatedDepreciation?: number;
  bookValue?: number;
  marketValue?: number;
  conservationState?: string;
  operationalCondition?: string;
  conditionNotes?: string;
  lastInspectionDate?: string;
  inspectedBy?: string;
  nextInspectionDate?: string;
  hasWarranty?: boolean;
  warrantyEndsAt?: string;
  serviceCompany?: string;
  serviceContact?: string;
  maintenanceFrequency?: string;
  lastMaintenanceDate?: string;
  nextMaintenanceDate?: string;
  maintenanceCostTotal?: number;
  retiredAt?: string;
  retirementReason?: string;
  saleValue?: number;
  buyerOrDestination?: string;
  retirementAuthorizedBy?: string;
  retirementDocumentUrl?: string;
  imageUrl?: string;
  notes?: string;
  sourceType?: 'manual' | 'purchase_receipt';
  plateStatus?: 'vinculada' | 'pendente';
  plateLinkedAt?: string;
  plateLinkedBy?: string;
  purchaseOrderId?: string;
  purchaseReceiptId?: string;
  purchaseReceiptItemId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export type AssetCategory = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export type AssetMovement = {
  id: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  type: AssetMovementType;
  fromKioskId?: string;
  fromKioskName?: string;
  toKioskId?: string;
  toKioskName?: string;
  fromStatus?: AssetStatus;
  toStatus?: AssetStatus;
  userId: string;
  username: string;
  occurredAt: string;
  notes?: string;
  sourceType?: string;
  sourceId?: string;
};

export type UniformEventType =
  | 'UNIFORME_ENTREGA'
  | 'UNIFORME_TROCA'
  | 'UNIFORME_DEVOLUCAO'
  | 'UNIFORME_PERDA'
  | 'UNIFORME_DANO'
  | 'UNIFORME_DESCARTE'
  | 'UNIFORME_COBRANCA';

export type UniformReturnedCondition = 'bom_estado' | 'usado' | 'danificado' | 'inutilizavel';
export type UniformStockDisposition = 'retorna_estoque' | 'descartar' | 'reter_avaliacao';
export type UniformChargeStatus = 'pendente' | 'aprovada' | 'cancelada' | 'quitada';

export type UniformEvent = {
  id: string;
  eventType: UniformEventType;
  movementId?: string;
  lotId?: string;
  productId: string;
  productName: string;
  kioskId: string;
  kioskName?: string;
  quantity: number;
  collaboratorUserId: string;
  collaboratorName: string;
  occurredAt: string;
  registeredByUserId: string;
  registeredByUserName: string;
  notes?: string;
  returnedQuantity?: number;
  returnedCondition?: UniformReturnedCondition;
  stockDisposition?: UniformStockDisposition;
  returnLotId?: string;
  chargeAmount?: number;
  chargeReason?: string;
  chargeStatus?: UniformChargeStatus;
  apparelType?: string;
  apparelSize?: string;
  apparelColor?: string;
  uniformCareInstructions?: InstructionSection[];
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
  workspaceId?: string;
  assignmentId?: string;
  sourceDeliveryEventId?: string;
  issuedCondition?: UniformCondition;
  uniformTransactionId?: string;
  termDocumentId?: string;
  termStoragePath?: string;
  termContentHash?: string;
  signatureStatus?: 'signed';
  exchangedFromAssignmentId?: string;
  exchangedToAssignmentId?: string;
  exchangedFromProductId?: string;
  exchangedFromProductName?: string;
};

export type UniformAssignmentStatus = 'em_posse' | 'devolvido_parcial' | 'devolvido';

export type UniformAssignment = {
  id: string;
  workspaceId: string;
  deliveryEventId: string;
  sourceLotId: string;
  productId: string;
  productName: string;
  collaboratorUserId: string;
  collaboratorName: string;
  issuedCondition: UniformCondition;
  quantityDelivered: number;
  quantityReturned: number;
  quantityInPossession: number;
  status: UniformAssignmentStatus;
  deliveredAt: string;
  apparelType?: string;
  apparelSize?: string;
  apparelColor?: string;
  uniformCareInstructions?: InstructionSection[];
  imageUrl?: string;
  deliveryTransactionId?: string;
  deliveryTermDocumentId?: string;
  createdAt: string;
  updatedAt: string;
};

export type UniformTransactionType = 'delivery' | 'exchange' | 'return';

export type UniformTransactionItem = {
  direction: 'outgoing' | 'incoming';
  assignmentId?: string;
  lotId?: string;
  productId: string;
  productName: string;
  quantity: number;
  condition: UniformCondition | UniformReturnedCondition;
  stockDisposition?: UniformStockDisposition;
  apparelType?: string;
  apparelSize?: string;
  apparelColor?: string;
};

export type UniformTransaction = {
  id: string;
  workspaceId: string;
  type: UniformTransactionType;
  status: 'signed_committed';
  collaboratorUserId: string;
  collaboratorName: string;
  occurredAt: string;
  notes?: string;
  items: UniformTransactionItem[];
  eventIds: string[];
  movementIds: string[];
  assignmentIds: string[];
  signatures: {
    collaborator: { name: string; imageHash: string; capturedAt: string };
    responsible: { name: string; userId: string; imageHash: string; capturedAt: string };
  };
  term: {
    documentId: string;
    templateId?: string;
    fileName: string;
    storagePath: string;
    contentHash: string;
    mimeType: 'application/pdf';
    size: number;
    archiveStatus: 'archived' | 'pending' | 'failed';
  };
  registeredByUserId: string;
  registeredByUserName: string;
  createdAt: string;
  updatedAt: string;
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

export type InstructionSection = {
  id: string;
  name: string;
  etapas: {
    id: string;
    text: string;
    quantity?: number;
    unit?: string;
    imageUrl?: string;
  }[];
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
  dashboard: { view: boolean; operational: boolean; pricing: boolean; audit: boolean; technicalSheets: boolean; collaborator?: boolean; };
  registration: { view: boolean; items: { add: boolean; edit: boolean; delete: boolean; }; baseProducts: { add: boolean; edit: boolean; delete: boolean; }; entities: { add: boolean; edit: boolean; delete: boolean; }; };
  stock: {
    view: boolean;
    inventoryControl: { view: boolean; addLot: boolean; editLot: boolean; writeDown: boolean; transfer: boolean; viewHistory: boolean; };
    uniforms: { view: boolean; deliver: boolean; return: boolean; dispose: boolean; manageEvaluation: boolean; };
    // `audit` permissions are now synced with `stockCount` for backward compatibility with Firestore rules, but UI uses `stockCount`.
    stockCount: { view: boolean; perform: boolean; approve: boolean; requestItem: boolean; };
    audit: { view: boolean; start: boolean; approve: boolean; };
    analysis: { view: boolean, restock: boolean, consumption: boolean, projection: boolean, valuation: boolean },
    purchasing: { view: boolean; suggest: boolean; approve: boolean; deleteHistory: boolean; };
    returns: { view: boolean; add: boolean; updateStatus: boolean; delete: boolean; };
    conversions: { view: boolean },
    predefinedLists: { view: true, manage: true }
  };
  assets: { view: boolean; create: boolean; edit: boolean; transfer: boolean; retire: boolean; printLabels: boolean; viewHistory: boolean; };
  pricing: { view: boolean; simulate: boolean; manageParameters: boolean; };
  commercial: {
    technicalSheets: {
      view: boolean;
      create: boolean;
      edit: boolean;
      delete: boolean;
      export: boolean;
    };
  };
  settings: { view: boolean; manageUsers: boolean; manageKiosks: boolean; manageProfiles: boolean; manageLabels: boolean; };
  tasks: { view: boolean; manage: boolean; };
  goals: { view: boolean; manage: boolean; };
  help: { view: true };
  reposition: {
    view: boolean;
    prepareDispatch: boolean;
    receive: boolean;
    finalize: boolean;
    cancel: boolean;
  };
  // itemRequests is now managed under stock.stockCount
  itemRequests: { add: boolean; approve: boolean; };
  signage: { view: boolean; manage: boolean; };
  dp: {
    view: boolean;
    schedules: { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean; };
    vacation: { viewAll: boolean; request: boolean; approve: boolean; manageSettings: boolean; };
    collaborators: { view: boolean; ownProfileOnly?: boolean; add: boolean; edit: boolean; terminate: boolean; syncProfile: boolean; };
    settings: { manageUnits: boolean; manageShifts: boolean; manageCalendars: boolean; };
    rh_role?: 'employee' | 'manager' | 'admin';
    rh?: {
      collaborators: { view: boolean; edit: boolean; };
      can_view_salary: boolean;
    };
  };
  financial: {
    view: boolean;
    dashboard: boolean;
    cashFlow: { view: boolean; create: boolean; };
    financialFlow: boolean;
    dre: boolean;
    expenses: { view: boolean; create: boolean; edit: boolean; pay: boolean; import: boolean; delete: boolean; };
    beneficiaries: { view: boolean; viewMaskedPaymentData: boolean; managePaymentData: boolean; };
    paymentRequests: { view: boolean; create: boolean; authorize: boolean; submit: boolean; refresh: boolean; viewProof: boolean; };
    interIntegration: { manage: boolean; };
    settings: { view: boolean; manageAccountPlans: boolean; manageResultCenters: boolean; manageBankAccounts: boolean; manageImportAliases: boolean; manageExpenseDescriptions: boolean; };
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
    formalization: {
      view: boolean;
      onboarding: { manage: boolean };
      aso: { view: boolean; manage: boolean };
      accountant: { view: boolean; manage: boolean };
      documents: { view: boolean; generate: boolean; review: boolean };
      companyDocuments: { view: boolean; manage: boolean };
      templates: { view: boolean; manage: boolean; publish: boolean };
      signatures: { view: boolean; send: boolean };
      consents: { view: boolean; manage: boolean };
      sensitiveData: { view: boolean };
    };
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
    analytics: {
      view: boolean;
      manage_taxonomy: boolean;
      configure_templates: boolean;
      view_occurrences: boolean;
      edit_occurrences_admin: boolean;
      export_occurrences: boolean;
      reprocess_occurrences: boolean;
      view_personal_targets: boolean;
      export_personal_targets: boolean;
      view_collaborator_rankings: boolean;
      manage_retention_policy: boolean;
      manage_task_rules: boolean;
      resolve_occurrences: boolean;
      validate_occurrence_resolution: boolean;
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

export type UserPdvAccess = {
  externalUserId: string;
  unitId?: string | null;
  unitName?: string | null;
  filialId: string;
  filialName?: string | null;
  profileId: string;
  profileName?: string | null;
  status: 'active' | 'inactive' | 'error';
  updatedAt?: string | null;
};

export type UnitAccessScope = 'linked' | 'selected' | 'all';
export type PersonRecordType = 'employee' | 'director' | 'partner' | 'pj' | 'internship' | 'test';

export type User = {
  id: string; // Firebase Auth UID
  username: string;
  email: string;
  phone?: string;
  phoneVerifiedAt?: Timestamp | string;
  phoneVerificationSource?: 'hr' | 'onboarding' | 'user';
  profileId: string;
  assignedKioskIds: string[];
  avatarUrl?: string;
  color?: string;              // hex color for avatar/schedule display
  // Operacional (PDV)
  operacional?: boolean;
  participatesInGoals?: boolean;
  pdvOperatorIds?: { [kioskId: string]: number };
  pdvAccessProfileId?: string;
  pdvAccessProfileName?: string;
  pdvAccessFilialId?: string;
  pdvAccessFilialName?: string;
  pdvAccesses?: UserPdvAccess[];
  // Departamento Pessoal (RH)
  /** ID canônico do cadastro em coala-rh/employees. */
  hrEmployeeId?: string;
  /** Natureza cadastral da pessoa; não concede permissões de acesso. */
  personRecordType?: PersonRecordType;
  profileCompliance?: {
    status: 'pending' | 'complete' | 'overdue';
    policyVersion: number;
    missingFields?: string[];
    invalidFields?: string[];
    evaluatedAt?: Timestamp | string | null;
    completedAt?: Timestamp | string | null;
    lastConfirmedAt?: Timestamp | string | null;
    nextReviewAt?: Timestamp | string | null;
  };
  registrationIdBizneo?: string;   // matrícula no Bizneo HR
  registrationIdPdv?: string;      // código no PDV
  jobRoleId?: string;
  jobRoleName?: string;
  jobFunctionIds?: string[];
  jobFunctionNames?: string[];
  employmentRelationshipType?: 'clt' | 'pj' | 'internship';
  responsibleUnitIds?: string[];
  /**
   * Limite territorial do acesso aos dados.
   * Ausente equivale a `linked`, preservando o comportamento legado.
   */
  unitAccessScope?: UnitAccessScope;
  /** Usado somente quando unitAccessScope === `selected`. */
  unitAccessUnitIds?: string[];
  jobRoleProfileSyncDisabled?: boolean;
  mustChangePassword?: boolean;
  passwordChangedAt?: Timestamp;
  lastLoginAt?: Timestamp;
  unitIds?: string[];               // unidade(s) de trabalho
  admissionDate?: Timestamp;
  birthDate?: Timestamp;
  shiftDefinitionId?: string;
  loginRestrictionEnabled?: boolean;
  needsTransportVoucher?: boolean;
  transportVoucherValue?: number;
  transportVoucherHistory?: Array<{
    id: string;
    fromStatus: 'none' | 'active' | 'suspended';
    toStatus: 'active' | 'suspended';
    effectiveDate: string;
    reason: string;
    value?: number;
    changedAt: string;
    changedBy?: {
      userId: string;
      username: string;
    };
  }>;
  isActive?: boolean;
  inactivationType?: 'temporary' | 'contract_termination';
  inactivationHistory?: Array<{
    type: 'temporary' | 'contract_termination' | 'reactivation';
    at: string;
    actorUid?: string;
    reason?: string | null;
    cause?: string | null;
    notes?: string | null;
    terminationDate?: string | null;
    employmentRelationshipType?: 'clt' | 'pj' | 'internship' | null;
  }>;
  terminationDate?: Timestamp;
  terminationReason?: string;
  terminationCause?: string;
  terminationNotes?: string;
  terminationRelationshipType?: 'clt' | 'pj' | 'internship';
  terminationProcessId?: string;
  employmentStatus?: 'active' | 'terminated';
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

export type HrQuestionWeight = "low" | "medium" | "high" | "critical";

export type RecruitmentCriterionCategory =
  | "availability"
  | "experience"
  | "technical"
  | "behavioral"
  | "interest"
  | "retention"
  | "differentials";

export type RecruitmentQuestionScoringUse = "informational" | "scored" | "eliminatory";
export type RecruitmentScoringSourceLayer = "role" | "function" | "opening";
export type RecruitmentCompositionPreset =
  | "role_100"
  | "role_70_function_30"
  | "role_60_function_40"
  | "role_50_function_50";
export type RecruitmentQuestionConditionOperator =
  | "equals"
  | "not_equals"
  | "includes"
  | "answered"
  | "not_answered";

export type RecruitmentQuestionCondition = {
  questionId: string;
  operator: RecruitmentQuestionConditionOperator;
  value?: unknown;
};

export type RecruitmentQuestionScoringConfig = {
  criterionCode?: string;
  criterionLabel?: string;
  category?: RecruitmentCriterionCategory;
  groupId?: string;
  groupName?: string;
  use?: RecruitmentQuestionScoringUse;
  importance?: HrQuestionWeight;
  justification?: string;
  sourceLayer?: RecruitmentScoringSourceLayer;
  answerFactors?: Record<string, number>;
  finalWeight?: number;
  rubric?: Array<{
    factor: number;
    label: string;
    description?: string;
  }>;
};

export type RecruitmentQuestionScoringSnapshot = RecruitmentQuestionScoringConfig & {
  finalWeight: number;
  layerWeight: number;
  originalLayerWeight: number;
  duplicateOf?: string | null;
  duplicateStrategy?: string | null;
  alerts?: string[];
};

export type RecruitmentScoringAlertSeverity = "info" | "warning" | "blocking";

export type RecruitmentScoringAlert = {
  code: string;
  message: string;
  severity: RecruitmentScoringAlertSeverity;
  questionId?: string;
  criterionCode?: string;
};

export type RecruitmentScoringSnapshot = {
  version: number;
  preset: RecruitmentCompositionPreset;
  totalPoints: number;
  layerWeights: Record<RecruitmentScoringSourceLayer, number>;
  questionWeights: Record<string, RecruitmentQuestionScoringSnapshot>;
  categoryTotals: Partial<Record<RecruitmentCriterionCategory, number>>;
  duplicateCriteria: Array<{
    criterionCode: string;
    keptQuestionId: string;
    mergedQuestionIds: string[];
    strategy: string;
  }>;
  alerts: RecruitmentScoringAlert[];
  createdAt: string;
};

export type RecruitmentScoringAlertAcknowledgement = {
  note: string;
  alertCodes: string[];
  acknowledgedAt: string;
  acknowledgedBy: string;
};

export type RecruitmentEligibilityStatus = "eligible" | "not_eligible" | "not_evaluated";

export type RecruitmentQuestionScore = {
  questionId: string;
  criterionCode?: string;
  category?: RecruitmentCriterionCategory;
  label: string;
  weight: number;
  factor: number;
  points: number;
  answer?: unknown;
  eliminatory: boolean;
  failedEliminatory: boolean;
};

export type RecruitmentScoreResult = {
  status: RecruitmentEligibilityStatus;
  rankingEligible: boolean;
  score: number;
  maxScore: number;
  percentage: number;
  failedEliminatory: RecruitmentQuestionScore[];
  questionScores: RecruitmentQuestionScore[];
  categoryScores: Partial<Record<RecruitmentCriterionCategory, { points: number; max: number; percentage: number }>>;
  calculatedAt: string;
};

export type HrFormQuestion = {
  id: string;
  text: string;
  type: HrQuestionType;
  sectionId?: string;
  sectionTitle?: string;
  sectionOrder?: number;
  parentQuestionId?: string;
  subquestionOrder?: number;
  required: boolean;
  active?: boolean;
  scored: boolean;
  weight: HrQuestionWeight;
  eliminatory: boolean;
  expectedAnswer?: unknown;
  tags?: string[];
  config?: Record<string, unknown>;
  conditions?: RecruitmentQuestionCondition[];
  scoring?: RecruitmentQuestionScoringConfig;
};

export type RecruitmentFormKind = 'talent_pool' | 'job_opening';
export type RecruitmentFormStatus = 'draft' | 'published';

export type RecruitmentFormConfig = {
  id: string;
  kind: RecruitmentFormKind;
  title: string;
  description?: string;
  status: RecruitmentFormStatus;
  questions: HrFormQuestion[];
  consentText?: string;
  lgpdContractText?: string;
  successMessage?: string;
  submitLabel?: string;
  version: number;
  createdAt?: string;
  updatedAt: string;
  updatedBy?: string;
  publishedAt?: string | null;
};

export type JobRoleSalaryRange = {
  label?: string;
  min?: number;
  max?: number;
  currency: string;
  visible?: boolean;
};

export type RecruitmentDisplaySettings = {
  locationLabel?: string;
  workType?: 'presencial' | 'remoto' | 'hibrido';
  contractTypeLabel?: string;
  deadlineLabel?: string;
  buttonText?: string;
  successMessage?: string;
  lgpdContractText?: string;
};

export type CandidateStatus = 'applied' | 'screening' | 'interview' | 'technical_test' | 'offer' | 'hired' | 'rejected' | 'withdrawn' | 'talent_pool';

export type CandidateDecisionAction =
  | 'created'
  | 'advanced'
  | 'status_changed'
  | 'hired'
  | 'rejected'
  | 'withdrawn'
  | 'talent_pool';

export type CandidateStageHistoryEntry = {
  id: string;
  fromStatus?: CandidateStatus | null;
  toStatus: CandidateStatus;
  action: CandidateDecisionAction;
  note?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  createdAt: string;
};

export type RecruitmentStage = {
  id: CandidateStatus;
  label: string;
  order: number;
  required?: boolean;
  dueDays?: number | null;
};

export type OnboardingStageId =
  | 'documents'
  | 'document_review'
  | 'accountant'
  | 'signature_preparation'
  | 'signature'
  | 'formalization_validation'
  | 'integration'
  | 'probation'
  | 'done';

export type OnboardingStage = {
  id: OnboardingStageId;
  label: string;
  order: number;
  required?: boolean;
  dueDays?: number | null;
};

export type OnboardingDocumentTemplate = {
  id: string;
  label: string;
  documentTypeCode?: string;
  description?: string;
  required?: boolean;
  order?: number;
};

export type OnboardingDocument = OnboardingDocumentTemplate & {
  status: 'pending' | 'received' | 'ai_approved' | 'review_required' | 'approved' | 'rejected';
  fileUrl?: string | null;
  filePath?: string | null;
  fileHashSha256?: string | null;
  receivedAt?: string | null;
  approvedAt?: string | null;
  updatedAt?: string | null;
  note?: string | null;
  extractedFields?: Record<string, unknown>;
  fieldConfidences?: Record<string, number>;
  promotedDocumentId?: string | null;
  promotedAt?: string | null;
  promotedBy?: string | null;
};

export type OnboardingFinalizationSettings = {
  operational?: boolean;
  participatesInGoals?: boolean;
  loginRestrictionEnabled?: boolean;
  needsTransportVoucher?: boolean;
  transportVoucherValue?: number | null;
  shiftDefinitionId?: string | null;
};

export type OnboardingTrainingItem = {
  id: string;
  label: string;
  detail?: string | null;
  status: 'pending' | 'current' | 'done';
  order: number;
  completedAt?: string | null;
  createdAt?: string | null;
};

export type OnboardingFirstAccessState = {
  status?: 'pending' | 'used' | 'revoked' | 'expired';
  tokenId?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
  usedAt?: string | null;
  createdBy?: string | null;
};

export type OnboardingAccessProvisioningState = {
  status?: 'pending' | 'awaiting_delivery' | 'awaiting_password' | 'completed' | 'failed';
  userCreatedAt?: string | null;
  completedAt?: string | null;
  operationalChecks?: {
    odontoprev?: {
      completed: boolean;
      updatedAt: string;
      updatedBy: string;
    };
    transportVoucherSystem?: {
      completed: boolean;
      updatedAt: string;
      updatedBy: string;
    };
  };
  email?: {
    status?: 'not_sent' | 'pending' | 'accepted' | 'delivered' | 'delayed' | 'bounced' | 'failed' | 'complained';
    providerId?: string | null;
    recipient?: string | null;
    acceptedAt?: string | null;
    deliveredAt?: string | null;
    failedAt?: string | null;
    lastEventAt?: string | null;
    lastError?: string | null;
  };
};

export type PjOnboardingStepId =
  | 'contract_definition'
  | 'provider_registration'
  | 'registration_review'
  | 'contract_preparation'
  | 'contract_signature'
  | 'financial_registration'
  | 'access_configuration'
  | 'provider_activation';

export type PjOnboardingStepStatus = 'pending' | 'active' | 'completed' | 'correction_required';

export type PjServiceScopeItem = {
  id: string;
  front: string;
  deliverable: string;
  order: number;
};

export type PjOnboardingWorkflow = {
  version: 1;
  currentStep: PjOnboardingStepId;
  steps: Record<PjOnboardingStepId, {
    status: PjOnboardingStepStatus;
    completedAt?: string | null;
    completedBy?: string | null;
    note?: string | null;
  }>;
  provider: {
    cnpj: string;
    legalName: string;
    tradeName?: string | null;
    email: string;
  };
  terms: {
    contractStartDate: string;
    termType: 'fixed' | 'indefinite';
    contractEndDate?: string | null;
    monthlyValue: number;
    paymentDay: number;
    invoiceRequired: true;
    serviceItems: PjServiceScopeItem[];
  };
  review?: {
    status?: 'pending' | 'approved' | 'correction_required';
    issues?: Array<{
      id: string;
      target: string;
      message: string;
      resolvedAt?: string | null;
    }>;
    reviewedAt?: string | null;
    reviewedBy?: string | null;
  };
  contract?: {
    status?: 'not_generated' | 'draft' | 'approved' | 'sent' | 'signed' | 'rejected' | 'failed';
    version?: number;
    storagePath?: string | null;
    signedStoragePath?: string | null;
    hashSha256?: string | null;
    generatedAt?: string | null;
    generatedBy?: string | null;
    approvedAt?: string | null;
    approvedBy?: string | null;
    signatureRequestId?: string | null;
    providerDocumentId?: string | null;
    providerSignatures?: unknown[];
    sentAt?: string | null;
    signedAt?: string | null;
    lastError?: string | null;
    contractorRepresentative?: {
      name?: string | null;
      email?: string | null;
      role?: string | null;
      qualification?: string | null;
      cpf?: string | null;
      professionalId?: string | null;
    };
    signatureCity?: string | null;
    forumCity?: string | null;
  };
  finance?: {
    status?: 'pending' | 'submitted' | 'correction_required' | 'approved';
    submittedAt?: string | null;
    submittedBy?: string | null;
    reviewedAt?: string | null;
    reviewedBy?: string | null;
    note?: string | null;
  };
  access?: {
    status?: 'pending' | 'configured' | 'invitation_sent' | 'completed';
    userName?: string | null;
    userCpf?: string | null;
    profileId?: string | null;
    profileName?: string | null;
    unitIds?: string[];
    unitNames?: string[];
    pdvRequired?: boolean;
    pdvUnitId?: string | null;
    pdvUnitName?: string | null;
    pdvFilialId?: string | null;
    pdvFilialName?: string | null;
    pdvProfileId?: string | null;
    pdvProfileName?: string | null;
    configuredAt?: string | null;
    configuredBy?: string | null;
  };
  activatedAt?: string | null;
  activatedBy?: string | null;
};

export type OnboardingPrivacyAcceptance = {
  noticeVersion: string;
  noticeHash: string;
  noticeTitle: string;
  noticeSummary?: string;
  noticeText: string;
  acknowledgementText: string;
  confirmationNote?: string;
  acknowledged: true;
  firstAcceptedAt: string;
  lastConfirmedAt: string;
  privacyNoticeSnapshotId?: string | null;
  allergyNoticeVersion?: string | null;
  allergyNoticeHash?: string | null;
  allergyNoticeSnapshotId?: string | null;
  allergyNoticeTitle?: string | null;
  allergyNoticeContext?: string | null;
  allergyAcknowledgementText?: string | null;
  allergyConfirmationNote?: string | null;
  allergyAcknowledged?: boolean;
  allergyAcknowledgedAt?: string | null;
  // Campos legados mantidos apenas para leitura de formalizações anteriores.
  sensitiveDataConsentText?: string | null;
  sensitiveDataTitle?: string | null;
  sensitiveDataContext?: string | null;
  sensitiveDataConsentAccepted?: boolean;
  sensitiveDataConsentAcceptedAt?: string | null;
  lastProtocol: string;
};

export type OnboardingProcess = {
  id: string;
  candidateId: string;
  candidateName?: string | null;
  candidateEmail?: string | null;
  applicationId?: string | null;
  jobOpeningId?: string | null;
  jobRoleId?: string | null;
  jobRoleName?: string | null;
  functionId?: string | null;
  functionName?: string | null;
  employmentRelationshipType?: 'clt' | 'pj' | 'internship' | null;
  unitId?: string | null;
  unitName?: string | null;
  employerUnitId?: string | null;
  employerUnitName?: string | null;
  employerCnpj?: string | null;
  employerAddress?: string | null;
  monthlySalary?: number | null;
  shiftDefinitionId?: string | null;
  shiftDefinitionName?: string | null;
  expectedAdmissionDate?: string | null;
  generateSignatureDocuments?: boolean;
  collaboratorUserId?: string | null;
  employeeId?: string | null;
  publicToken?: string | null;
  publicTokenClosedAt?: string | null;
  publicTokenExpiresAt?: string | null;
  publicTokenExtensionUsed?: boolean;
  publicTokenExtendedAt?: string | null;
  publicTokenExtendedBy?: string | null;
  publicFormAnswers?: Record<string, unknown>;
  publicFormSubmittedAt?: string | null;
  publicFormLastSubmittedAt?: string | null;
  publicPrivacyAcceptance?: OnboardingPrivacyAcceptance | null;
  asoWorkflow?: {
    status?: 'pending' | 'guide_generated' | 'guide_validated' | 'email_sent' | 'clinic_response_received' | 'appointment_pending_review' | 'appointment_confirmed' | 'candidate_notified' | 'awaiting_exam' | 'aso_received' | 'aso_under_review' | 'completed';
    latestGuideId?: string | null;
    latestGuideHashSha256?: string | null;
    latestGuideGeneratedAt?: string | null;
    clinicEntityId?: string | null;
    paymentRequestId?: string | null;
    paymentStatus?: 'draft' | 'awaiting_financial_authorization' | 'ready_to_submit' | 'submitting' | 'awaiting_bank_approval' | 'processing' | 'paid' | 'rejected' | 'approval_expired' | 'failed' | 'cancelled' | null;
    paymentProofStoragePath?: string | null;
    paymentConfirmedAt?: string | null;
    appointmentStatus?: 'not_requested' | 'awaiting_clinic' | 'confirmed';
    appointmentAt?: string | null;
    guideValidation?: {
      documentId?: string | null;
      validatedAt?: string | null;
      validatedBy?: string | null;
      validatedByEmail?: string | null;
    } | null;
    clinic?: {
      email?: string | null;
      name?: string | null;
      communicationId?: string | null;
      providerId?: string | null;
      emailStatus?: 'pending' | 'accepted' | 'delivered' | 'delayed' | 'bounced' | 'failed' | 'complained' | null;
      sentAt?: string | null;
      deliveredAt?: string | null;
      openedAt?: string | null;
      repliedAt?: string | null;
      lastError?: string | null;
    } | null;
    appointment?: {
      date?: string | null;
      time?: string | null;
      location?: string | null;
      instructions?: string | null;
      source?: 'clinic_form' | 'inbound_email' | 'manual' | null;
      responseText?: string | null;
      confidence?: number | null;
      proposedAt?: string | null;
      confirmedAt?: string | null;
      confirmedBy?: string | null;
    } | null;
    candidateNotification?: {
      providerId?: string | null;
      emailStatus?: string | null;
      sentAt?: string | null;
      deliveredAt?: string | null;
      openedAt?: string | null;
      uploadExpiresAt?: string | null;
    } | null;
    asoDocument?: {
      fileName?: string | null;
      storagePath?: string | null;
      hashSha256?: string | null;
      mimeType?: string | null;
      uploadedAt?: string | null;
      status?: 'received' | 'approved' | 'rejected' | null;
      reviewedAt?: string | null;
      reviewedBy?: string | null;
      rejectionReason?: string | null;
    } | null;
    updatedAt?: string | null;
  };
  accountantWorkflow?: {
    status?: 'pending' | 'form_generated' | 'form_validated' | 'email_sent' | 'registry_received' | 'completed';
    latestFormId?: string | null;
    latestFormHashSha256?: string | null;
    latestFormGeneratedAt?: string | null;
    formValidation?: {
      documentId?: string | null;
      validatedAt?: string | null;
      validatedBy?: string | null;
      validatedByEmail?: string | null;
    } | null;
    selectedDocumentIds?: string[];
    email?: {
      recipient?: string | null;
      communicationId?: string | null;
      providerId?: string | null;
      status?: 'pending' | 'accepted' | 'delivered' | 'delayed' | 'bounced' | 'failed' | 'complained' | null;
      sentAt?: string | null;
      deliveredAt?: string | null;
      openedAt?: string | null;
      clickedAt?: string | null;
      lastError?: string | null;
    } | null;
    package?: {
      attachmentCount?: number;
      attachmentLabels?: string[];
      selectedDocumentIds?: string[];
      sentAt?: string | null;
    } | null;
    registryDocument?: {
      versionId?: string | null;
      fileName?: string | null;
      storagePath?: string | null;
      hashSha256?: string | null;
      mimeType?: string | null;
      size?: number | null;
      uploadedAt?: string | null;
      status?: 'received' | 'approved' | 'rejected' | null;
      reviewedAt?: string | null;
      reviewedBy?: string | null;
      rejectionReason?: string | null;
    } | null;
    updatedAt?: string | null;
  };
  finalizationSettings?: OnboardingFinalizationSettings;
  firstAccess?: OnboardingFirstAccessState;
  accessProvisioning?: OnboardingAccessProvisioningState;
  pdvAccess?: {
    required: boolean;
    profileId?: string | null;
    profileName?: string | null;
    filialId?: string | null;
    filialName?: string | null;
    status?: 'not_required' | 'pending_password' | 'completed' | 'failed';
    userId?: string | null;
    provisionedAt?: string | null;
    lastError?: string | null;
  };
  status: 'pending_setup' | 'collecting_documents' | 'reviewing_documents' | 'accountant_pending' | 'contract_pending' | 'ready_to_create_user' | 'awaiting_first_access' | 'active' | 'completed' | 'cancelled';
  currentStage?: OnboardingStageId;
  stages?: OnboardingStage[];
  documents?: OnboardingDocument[];
  integrationAlerts?: Array<{
    id: string;
    label: string;
    status: 'pending' | 'resolved';
    message?: string;
    checkedAt?: string;
    externalId?: string;
    source?: string;
  }>;
  integrationV2?: {
    mode: 'import' | 'blank';
    templateId: string | null;
    templateVersion: number | null;
    snapshot: import('@/features/hr/integration/schemas').IntegrationTemplateVersion;
    answers: Record<string, unknown>;
    uploads: Record<string, unknown>;
    stageStatuses: Record<string, 'pending' | 'active' | 'completed' | 'skipped'>;
    currentStageId: string | null;
    startedAt: string;
    updatedAt: string;
    assignees?: Record<string, { strategy: string; referenceId?: string; resolvedId?: string; resolvedType?: string }>;
    actionResults?: Record<string, { status: 'completed' | 'failed'; executedAt: string; output?: Record<string, unknown>; error?: string }>;
    optionFilters?: Record<string, unknown>;
    completionRequestedAt?: string | null;
  };
  probationV2?: import('@/features/hr/integration/probation-process').ProbationProcessState;
  pjWorkflow?: PjOnboardingWorkflow | null;
  trainingItems?: OnboardingTrainingItem[];
  approvedAt?: string | null;
  approvedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

export type Candidate = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  resumeUrl?: string;
  resumePath?: string;
  jobRoleId: string;
  jobRoleName?: string;
  functionId?: string | null;
  functionName?: string | null;
  unitId?: string | null;
  unitName?: string | null;
  employerUnitId?: string | null;
  employerUnitName?: string | null;
  employerCnpj?: string | null;
  shiftDefinitionId?: string | null;
  shiftDefinitionName?: string | null;
  jobOpeningId?: string;
  latestApplicationId?: string;
  latestApplication?: {
    id: string;
    stage?: CandidateStatus;
    status?: string;
    onboardingId?: string | null;
    stageHistory?: CandidateStageHistoryEntry[];
    formAnswers?: Record<string, unknown>;
    formQuestionSnapshot?: HrFormQuestion[];
    recruitmentScoring?: RecruitmentScoringSnapshot;
    recruitmentScore?: RecruitmentScoreResult;
    eligibilityStatus?: RecruitmentEligibilityStatus;
    rankingEligible?: boolean;
  };
  status: CandidateStatus;
  recruitmentHistory?: CandidateStageHistoryEntry[];
  notes?: string;
  formAnswers?: Record<string, unknown>;
  formQuestionSnapshot?: HrFormQuestion[];
  recruitmentScoring?: RecruitmentScoringSnapshot;
  recruitmentScore?: RecruitmentScoreResult;
  eligibilityStatus?: RecruitmentEligibilityStatus;
  rankingEligible?: boolean;
  talentPool?: {
    rolePreference?: string | null;
    unitPreference?: string | null;
    submittedAt?: string;
    formId?: string;
    formVersion?: number;
  };
  rating?: number; // 1-5
  source?: string;
  onboardingId?: string | null;
  hiredAt?: string | null;
  appliedAt: string;
  updatedAt: string;
  createdBy: string;
};

export type JobOpeningStatus = 'open' | 'paused' | 'closed';

export type JobOpening = {
  id: string;
  jobRoleId: string;
  jobRoleName?: string;
  functionId?: string | null;
  functionName?: string | null;
  unitId?: string | null;
  unitName?: string | null;
  shiftDefinitionId?: string | null;
  shiftDefinitionName?: string | null;
  title: string;
  slug: string;
  description?: string;
  requirements?: string[];
  benefits?: string[];
  publicSalaryRange?: JobRoleSalaryRange;
  applyButtonLabel?: string;
  applicationSuccessMessage?: string | null;
  lgpdContractText?: string | null;
  formQuestions?: HrFormQuestion[];
  recruitmentScoring?: RecruitmentScoringSnapshot;
  compositionPreset?: RecruitmentCompositionPreset;
  recruitmentScoringAlertAcknowledgement?: RecruitmentScoringAlertAcknowledgement | null;
  pipelineStages?: RecruitmentStage[];
  location?: string;
  workType?: 'presencial' | 'remoto' | 'hibrido';
  contractTypeLabel?: string | null;
  workSchedule?: string | null;
  slots: number;
  status: JobOpeningStatus;
  applicationStartAt?: string | null;
  applicationEndAt?: string | null;
  closesAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export type JobDepartment = {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  order?: number;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type JobRole = {
// ...
  id: string;
  name: string;
  cbo?: string;
  publicTitle: string;
  slug: string;
  departmentId?: string | null;
  departmentName?: string | null;
  parentId?: string | null;
  order?: number;
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
  recruitmentDisplay?: RecruitmentDisplaySettings;
  applicationSuccessMessage?: string | null;
  lgpdContractText?: string | null;
  recruitmentModelSavedAt?: string | null;
  defaultProfileId?: string;
  loginRestricted?: boolean;
  formQuestions?: HrFormQuestion[];
  compositionPreset?: RecruitmentCompositionPreset;
  pipelineStages?: RecruitmentStage[];
  onboardingStages?: OnboardingStage[];
  onboardingDocuments?: OnboardingDocumentTemplate[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type JobFunction = {
  id: string;
  name: string;
  publicTitle: string;
  slug: string;
  departmentId?: string | null;
  departmentName?: string | null;
  parentId?: string | null;
  order?: number;
  description?: string;
  publicDescription?: string;
  responsibilities?: string[];
  publicResponsibilities?: string[];
  requirements?: string[];
  publicRequirements?: string[];
  benefits?: string[];
  workSchedule?: string;
  salaryRange?: JobRoleSalaryRange;
  publicSalaryRange?: JobRoleSalaryRange;
  recruitmentDisplay?: RecruitmentDisplaySettings;
  applicationSuccessMessage?: string | null;
  lgpdContractText?: string | null;
  recruitmentModelSavedAt?: string | null;
  compatibleRoleIds?: string[];
  defaultProfileId?: string;
  formQuestions?: HrFormQuestion[];
  compositionPreset?: RecruitmentCompositionPreset;
  pipelineStages?: RecruitmentStage[];
  onboardingStages?: OnboardingStage[];
  onboardingDocuments?: OnboardingDocumentTemplate[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SignageSlideType = 'image' | 'video' | 'text';

export type SignageSchedule = {
  startTime?: string;  // "HH:MM"
  endTime?: string;    // "HH:MM"
  startDate?: string;  // "YYYY-MM-DD"
  endDate?: string;    // "YYYY-MM-DD"
};

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
  schedule?: SignageSchedule;
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
  schedule?: SignageSchedule;
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

export type NutritionalNutrient = {
  name: string;
  amount: string;
  unit: string;
  dailyValue?: string;
};

export type NutritionalData = {
  portionSize: string;
  portionDescription?: string;
  nutrients: NutritionalNutrient[];
  extractedAt: string;
};

export type Product = {
  id: string;
  baseName: string;
  brand?: string;
  aliases?: string[];
  barcode?: string;
  gtin?: string;
  imageUrl?: string;
  description?: string;
  externalCategory?: string;
  ingredients?: string;
  nutritionFacts?: Record<string, unknown>;
  ncm?: string;
  cest?: string;
  dataSource?: 'internal' | 'open_food_facts' | 'gs1' | 'brazilian_commercial' | 'manual' | string;
  confidence?: number;
  lastBarcodeLookupAt?: string;
  // Campos normalizados do cadastro inteligente por codigo de barras.
  codigo_barras?: string;
  nome?: string;
  marca?: string;
  descricao?: string;
  categoria_id?: string;
  quantidade?: number;
  unidade_medida?: string;
  imagem_url?: string;
  ingredientes?: string;
  informacoes_nutricionais?: Record<string, unknown>;
  origem_dados?: string;
  confianca?: number;
  data_consulta?: string;
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
  operationalCategoryId?: string;
  operationalCategoryName?: string;
  operationalDestination?: OperationalItemDestination;
  apparelType?: string;
  apparelSize?: string;
  apparelColor?: string;
  apparelFit?: string;
  apparelMaterial?: string;
  apparelUsage?: string;
  uniformCareInstructions?: InstructionSection[];
  nutritionalTableImageUrl?: string;
  compositionImageUrl?: string;
  nutritionalData?: NutritionalData;
  compositionText?: string;
  detectedAllergens?: string[];
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
    taskId?: string;
    workspaceId?: string;
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
  nickname?: string;
  document: string; // CPF ou CNPJ
  documentNormalized?: string;
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
  documentSignatoryUserId?: string;
  documentSignatoryName?: string;
  documentSignatoryEmail?: string;
  documentSignatoryScope?: 'entity' | 'cnpj_root';
  cnpjRoot?: string;
  status?: 'active' | 'inactive';
  inactivatedAt?: string;
  inactivatedBy?: string;
  rg?: string; // Only for pessoa_fisica
  birthDate?: string; // Only for pessoa_fisica
  notes?: string;
  imageUrl?: string; // avatar
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  situacao_cadastral?: string;
  data_abertura?: string;
  natureza_juridica?: string;
  cnae_principal_codigo?: string;
  cnae_principal_descricao?: string;
  cnaes_secundarios_json?: Array<{ codigo: string; descricao: string }>;
  inscricao_estadual?: string;
  contribuinte_icms?: 'sim' | 'nao' | 'nao_informado';
  situacao_inscricao_estadual?: 'ativa' | 'inativa' | 'suspensa' | 'baixada' | 'nao_consultada' | 'nao_informado';
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  telefone?: string;
  email?: string;
  tipo_empresa?: string;
  origem_dados?: 'internal' | 'brasilapi' | 'viacep' | 'cache' | 'manual' | 'sintegra';
  data_ultima_consulta_cnpj?: string;
  observacoes?: string;
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
  itemName?: string;
  operationalCategoryId?: string;
  operationalCategoryName?: string;
  itemDestination?: OperationalItemDestination;
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
export type PurchaseFreightPaymentMode = 'included_with_goods' | 'separate';

export type PurchaseOrderStatus = 'created' | 'confirmed' | 'cancelled';

export type PurchaseOrder = {
  id: string;
  workspaceId: string;
  origin: PurchaseOrigin;
  quotationId?: string;
  supplierId: string; // ref → entities collection
  supplierName?: string;
  receiptMode: PurchaseReceiptMode;
  status: PurchaseOrderStatus;
  estimatedReceiptDate: string; // ISO date; equals createdAt for immediate_pickup
  paymentDueDate: string;
  paymentMethod: PaymentMethod;
  paymentAccountId?: string | null;
  paymentAccountName?: string | null;
  paymentMethodId?: string | null;
  paymentMethodLabel?: string | null;
  paymentCondition?: PurchasePaymentCondition;
  installmentsCount?: number;
  installmentDueDates?: string[];
  purchaseDate?: string;
  invoiceNumber?: string;
  invoiceAccessKey?: string;
  fiscal?: {
    operationNature?: string;
    operationType?: string;
    model?: string;
    series?: string;
    number?: string;
    issuedAt?: string;
    protocol?: string;
    authorizedAt?: string;
    issuerCnpj?: string;
    issuerIe?: string;
    issuerName?: string;
    issuerCity?: string;
    issuerUf?: string;
    recipientName?: string;
    recipientCity?: string;
    recipientUf?: string;
    digestValue?: string;
  };
  accountPlanId?: string;
  accountPlanName?: string;
  freightAccountPlanId?: string;
  freightAccountPlanName?: string;
  freightPaymentMode?: PurchaseFreightPaymentMode;
  resultCenterId?: string;
  resultCenterName?: string;
  deliveryFee?: number;
  totalEstimated: number;
  totalConfirmed?: number; // filled after receipt
  trackingInfo?: string;
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
  baseItemId: string; // required for stock/uniform items
  productId?: string; // ref → products; needed to confirm base-unit cost at purchase time
  itemName?: string;
  operationalCategoryId?: string;
  operationalCategoryName?: string;
  itemDestination?: OperationalItemDestination;
  quotationItemId?: string; // null in direct purchases
  unit: string;
  purchaseUnitType?: PurchaseUnitType;
  purchaseUnitLabel?: string;
  quantityOrdered: number;
  unitPriceOrdered: number;
  discountOrdered?: number;
  totalOrdered: number;
  notes?: string;
  entryType?: PurchaseStockEntryType;
  itemTreatment?: PurchaseItemTreatment;
  linkedAssetId?: string | null;
  linkedAssetCode?: string | null;
  linkedAssetName?: string | null;
  componentAction?: PurchaseAssetComponentAction | null;
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
export type PurchaseDivergenceResolutionAction =
  | 'accept_charged'
  | 'bonus'
  | 'return_excess'
  | 'keep_pending'
  | 'close_shortage'
  | 'request_replacement'
  | 'credit_discount'
  | 'correct_entry';
export type PurchaseDivergenceExcessBillingMode = 'same_unit_price' | 'custom_unit_price';
export type PurchaseStockEntryType = 'stock' | 'uniform' | 'asset';
export type PurchaseItemTreatment =
  | 'stock'
  | 'uniform'
  | 'asset'
  | 'asset_component'
  | 'service'
  | 'expense';
export type PurchaseAssetComponentAction = 'replacement' | 'improvement' | 'repair' | 'installation' | 'other';

export type PurchaseReceiptItem = {
  id: string;
  purchaseReceiptId: string;
  purchaseOrderItemId: string;
  baseItemId: string;
  productId?: string;
  itemName?: string;
  operationalCategoryId?: string;
  operationalCategoryName?: string;
  itemDestination?: OperationalItemDestination;
  unit: string;
  purchaseUnitType?: PurchaseUnitType;
  purchaseUnitLabel?: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityPendingStockEntry?: number;
  unitPriceOrdered: number;
  unitPriceConfirmed: number;
  totalConfirmed: number;
  status: PurchaseReceiptItemStatus;
  receiptDisposition?: 'pending' | 'receive' | 'receive_less' | 'receive_more' | 'exchange_pending' | 'returned';
  divergenceReason?: string;
  divergenceResolutionAction?: PurchaseDivergenceResolutionAction | null;
  divergenceExcessBillingMode?: PurchaseDivergenceExcessBillingMode | null;
  divergenceExcessUnitPrice?: number | null;
  divergenceResolvedAt?: string;
  divergenceResolvedBy?: string;
  resolutionNotes?: string;
  entryType?: PurchaseStockEntryType;
  itemTreatment?: PurchaseItemTreatment;
  linkedAssetId?: string | null;
  linkedAssetCode?: string | null;
  linkedAssetName?: string | null;
  componentAction?: PurchaseAssetComponentAction | null;
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
  freightPaymentMode?: PurchaseFreightPaymentMode;
  resultCenterId?: string;
  resultCenterName?: string;
  deliveryFee?: number;
  amountEstimated: number;
  goodsAmountEstimated?: number;
  freightAmountEstimated?: number;
  goodsAmountPaid?: number;
  freightAmountPaid?: number;
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

export type RepositionPartialFulfillmentReason =
  | "Falta de mercadoria"
  | "Substituição por item equivalente"
  | "Quantidade ajustada por embalagem"
  | "Solicitação acima da necessidade"
  | "Erro na solicitação"
  | "Item descontinuado"
  | "Item incluído pelo CD"
  | "Outro";

// Insumo derivado escolhido pelo solicitante (com a quantidade em embalagens e o equivalente na unidade base).
export type RepositionRequestedProduct = {
  productId: string;
  productName: string;
  packages: number;
  quantityBase: number;
};

export type RepositionItem = {
  baseProductId: string;
  productName: string;
  quantityNeeded: number;
  suggestedLots: RepositionSuggestedLot[];
  // Preenchido apenas durante a montagem da solicitação (não usado na atividade).
  requestedProducts?: RepositionRequestedProduct[];
  fulfillmentDivergence?: {
    requestedQuantity: number;
    fulfilledQuantity: number;
    unit: string;
    reason: RepositionPartialFulfillmentReason;
    notes?: string;
  };
  receivedLots?: (RepositionSuggestedLot & { receivedQuantity: number })[];
};

export type RepositionRequestStatus = "Pendente" | "Em separação" | "Atendida" | "Cancelada";

export type RepositionRequestItem = {
  baseProductId: string;
  productName: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
  requestedQuantity: number;
  // Insumos derivados (tamanhos) escolhidos pelo solicitante para este insumo base.
  requestedProducts?: RepositionRequestedProduct[];
  notes?: string;
};

export type RepositionRequest = {
  id: string;
  status: RepositionRequestStatus;
  kioskId: string;
  kioskName: string;
  requestedBy: {
    userId: string;
    username: string;
  };
  reviewedBy?: {
    userId: string;
    username: string;
  };
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  activityId?: string;
  notes?: string;
  items: RepositionRequestItem[];
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
  requestId?: string;
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
  separationSignature?: Partial<SignatureData>;
  transportSignature?: Partial<SignatureData>;
  receiptNotes?: string;
  receiptSignature?: Partial<SignatureData>;
  isSeparated?: boolean;
  separationChecklist?: Record<string, boolean>;
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
    dashboard: { view: false, operational: false, pricing: false, audit: false, technicalSheets: false, collaborator: false },
    registration: { view: false, items: { add: false, edit: false, delete: false }, baseProducts: { add: false, edit: false, delete: false }, entities: { add: false, edit: false, delete: false } },
    stock: { 
      view: false, 
      inventoryControl: { view: false, addLot: false, editLot: false, writeDown: false, transfer: false, viewHistory: false }, 
      uniforms: { view: false, deliver: false, return: false, dispose: false, manageEvaluation: false },
      // `audit` permissions are now synced with `stockCount` for backward compatibility with Firestore rules, but UI uses `stockCount`.
      stockCount: { view: false, perform: false, approve: false, requestItem: false }, 
      audit: { view: false, start: false, approve: false }, 
      analysis: { view: false, restock: false, consumption: false, projection: false, valuation: false }, 
      purchasing: { view: false, suggest: false, approve: false, deleteHistory: false }, 
      returns: { view: false, add: false, updateStatus: false, delete: false }, 
      conversions: { view: false }, 
      predefinedLists: { view: true, manage: true }
    },
    assets: { view: false, create: false, edit: false, transfer: false, retire: false, printLabels: false, viewHistory: false },
    pricing: { view: false, simulate: false, manageParameters: false },
    commercial: {
      technicalSheets: { view: false, create: false, edit: false, delete: false, export: false },
    },
    settings: { view: false, manageUsers: false, manageKiosks: false, manageProfiles: false, manageLabels: false },
    tasks: { view: false, manage: false },
    goals: { view: false, manage: false },
    help: { view: true },
    reposition: { view: false, prepareDispatch: false, receive: false, finalize: false, cancel: false },
    // itemRequests is now managed under stock.stockCount
    itemRequests: { add: false, approve: false },
    signage: { view: false, manage: false },
    dp: {
      view: false,
      schedules: { view: false, create: false, edit: false, delete: false, export: false },
      vacation: { viewAll: false, request: false, approve: false, manageSettings: false },
      collaborators: { view: false, ownProfileOnly: false, add: false, edit: false, terminate: false, syncProfile: false },
      settings: { manageUnits: false, manageShifts: false, manageCalendars: false },
      rh_role: undefined,
      rh: { collaborators: { view: false, edit: false }, can_view_salary: false },
    },
    financial: {
      view: false,
      dashboard: false,
      cashFlow: { view: false, create: false },
      financialFlow: false,
      dre: false,
      expenses: { view: false, create: false, edit: false, pay: false, import: false, delete: false },
      beneficiaries: { view: false, viewMaskedPaymentData: false, managePaymentData: false },
      paymentRequests: { view: false, create: false, authorize: false, submit: false, refresh: false, viewProof: false },
      interIntegration: { manage: false },
      settings: { view: false, manageAccountPlans: false, manageResultCenters: false, manageBankAccounts: false, manageImportAliases: false, manageExpenseDescriptions: false },
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
      formalization: {
        view: false,
        onboarding: { manage: false },
        aso: { view: false, manage: false },
        accountant: { view: false, manage: false },
        documents: { view: false, generate: false, review: false },
        companyDocuments: { view: false, manage: false },
        templates: { view: false, manage: false, publish: false },
        signatures: { view: false, send: false },
        consents: { view: false, manage: false },
        sensitiveData: { view: false },
      },
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
      analytics: {
        view: false,
        manage_taxonomy: false,
        configure_templates: false,
        view_occurrences: false,
        edit_occurrences_admin: false,
        export_occurrences: false,
        reprocess_occurrences: false,
        view_personal_targets: false,
        export_personal_targets: false,
        view_collaborator_rankings: false,
        manage_retention_policy: false,
        manage_task_rules: false,
        resolve_occurrences: false,
        validate_occurrence_resolution: false,
      },
      projects: {},
    },
};


export const defaultAdminPermissions: PermissionSet = {
    dashboard: { view: true, operational: true, pricing: true, audit: true, technicalSheets: true, collaborator: true },
    registration: { view: true, items: { add: true, edit: true, delete: true }, baseProducts: { add: true, edit: true, delete: true }, entities: { add: true, edit: true, delete: true } },
    stock: { view: true, inventoryControl: { view: true, addLot: true, editLot: true, writeDown: true, transfer: true, viewHistory: true }, uniforms: { view: true, deliver: true, return: true, dispose: true, manageEvaluation: true }, stockCount: { view: true, perform: true, approve: true, requestItem: true }, audit: { view: true, start: true, approve: true }, analysis: { view: true, restock: true, consumption: true, projection: true, valuation: true }, purchasing: { view: true, suggest: true, approve: true, deleteHistory: true }, returns: { view: true, add: true, updateStatus: true, delete: true }, conversions: { view: true }, predefinedLists: { view: true, manage: true } },
    assets: { view: true, create: true, edit: true, transfer: true, retire: true, printLabels: true, viewHistory: true },
    pricing: { view: true, simulate: true, manageParameters: true },
    commercial: {
      technicalSheets: { view: true, create: true, edit: true, delete: true, export: true },
    },
    settings: { view: true, manageUsers: true, manageKiosks: true, manageProfiles: true, manageLabels: true },
    tasks: { view: true, manage: true },
    goals: { view: true, manage: true },
    reposition: { view: true, prepareDispatch: true, receive: true, finalize: true, cancel: true },
    help: { view: true },
    itemRequests: { add: true, approve: true },
    signage: { view: true, manage: true },
    dp: {
      view: true,
      schedules: { view: true, create: true, edit: true, delete: true, export: true },
      vacation: { viewAll: true, request: true, approve: true, manageSettings: true },
      collaborators: { view: true, ownProfileOnly: false, add: true, edit: true, terminate: true, syncProfile: true },
      settings: { manageUnits: true, manageShifts: true, manageCalendars: true },
      rh_role: 'admin' as const,
      rh: { collaborators: { view: true, edit: true }, can_view_salary: true },
    },
    financial: {
      view: true,
      dashboard: true,
      cashFlow: { view: true, create: true },
      financialFlow: true,
      dre: true,
      expenses: { view: true, create: true, edit: true, pay: true, import: true, delete: true },
      beneficiaries: { view: true, viewMaskedPaymentData: true, managePaymentData: true },
      paymentRequests: { view: true, create: true, authorize: true, submit: true, refresh: true, viewProof: true },
      interIntegration: { manage: true },
      settings: { view: true, manageAccountPlans: true, manageResultCenters: true, manageBankAccounts: true, manageImportAliases: true, manageExpenseDescriptions: true },
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
      formalization: {
        view: true,
        onboarding: { manage: true },
        aso: { view: true, manage: true },
        accountant: { view: true, manage: true },
        documents: { view: true, generate: true, review: true },
        companyDocuments: { view: true, manage: true },
        templates: { view: true, manage: true, publish: true },
        signatures: { view: true, send: true },
        consents: { view: true, manage: true },
        sensitiveData: { view: true },
      },
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
      analytics: {
        view: true,
        manage_taxonomy: true,
        configure_templates: true,
        view_occurrences: true,
        edit_occurrences_admin: true,
        export_occurrences: true,
        reprocess_occurrences: true,
        view_personal_targets: true,
        export_personal_targets: true,
        view_collaborator_rankings: true,
        manage_retention_policy: true,
        manage_task_rules: true,
        resolve_occurrences: true,
        validate_occurrence_resolution: true,
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

export type TaskAssigneeType = 'user' | 'profile' | 'role' | 'team' | 'unit';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskVisibilityScope =
  | 'assignee'
  | 'assignee_and_watchers'
  | 'unit'
  | 'project'
  | 'workspace';

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
    workspaceId?: string;
    projectId?: string;
    subprojectId?: string;
    subprojectName?: string;
    statusId?: string;
    title: string;
    description?: string;
    status: 'pending' | 'in_progress' | 'awaiting_approval' | 'completed' | 'reopened' | 'rejected';
    lifecycleState?: TaskLifecycleState;
    completionResult?: TaskCompletionResult;
    version?: number;
    assigneeType: TaskAssigneeType;
    assigneeId: string; // userId or profileId
    requiresApproval: boolean;
    approverType?: TaskAssigneeType;
    approverId?: string;
    priority?: TaskPriority;
    unitId?: string;
    unitName?: string;
    createdByUserId?: string;
    createdByUsername?: string;
    watcherUserIds?: string[];
    watcherProfileIds?: string[];
    watcherRoleIds?: string[];
    visibilityScope?: TaskVisibilityScope;
    originLink?: string;
    origin: TaskOrigin;
    history: TaskHistoryItem[];
    createdAt: string; // ISO string
    updatedAt: string; // ISO string
    dueDate?: string; // ISO string
    completedAt?: string; // ISO string
    cancelledAt?: string; // ISO string
    sourceStatus?: string;
    requiresRelinkDecision?: boolean;
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

export interface RepositionRequestContextType {
  requests: RepositionRequest[];
  loading: boolean;
  createRepositionRequest: (data: Pick<RepositionRequest, "kioskId" | "kioskName" | "items" | "notes">) => Promise<string | null>;
  updateRepositionRequest: (requestId: string, updates: Partial<RepositionRequest>) => Promise<void>;
  refreshRepositionRequests: () => Promise<void>;
}

// ── METAS ──────────────────────────────────────────────────────────────────
export type GoalType = 'revenue' | 'ticket' | 'product_line' | 'product_specific'
export type GoalPeriod = 'daily' | 'weekly' | 'monthly'
export type GoalStatus = 'active' | 'closed' | 'cancelled'
export type GoalDistributionMode = 'calendar_days' | 'scheduled_days'
export type GoalMethod = 'manual' | 'tiered_unit_bonus' | 'historical_average' | 'growth_rate' | 'custom'
export type GoalParticipantSource = 'schedule' | 'manual'
export type GoalParticipantRole = 'fixed' | 'relief' | 'leader'
export type GoalBonusSplitMode = 'equal' | 'weighted_by_presence' | 'manual'
export type GoalReliefWorkerSplitMode = 'proportional_by_covered_shifts'
export type GoalIncentiveTone = 'info' | 'warning' | 'success'
export type GoalIncentiveTriggerType = 'distance_to_next_tier_percent' | 'distance_to_next_tier_amount' | 'tier_reached'

export interface GoalBonusTierConfig {
  id: string
  label: string
  fromAmount: number
  toAmount: number | null
  displayTargetAmount?: number
  fixedBonusAmount: number
  excessPercent: number
  description?: string
}

export interface GoalIncentiveMessageRule {
  id: string
  label: string
  triggerType: GoalIncentiveTriggerType
  thresholdPercent?: number
  thresholdAmount?: number
  tierId?: string
  message: string
  tone: GoalIncentiveTone
}

export interface GoalMethodConfig {
  id: string
  name: string
  type: GoalMethod
  active: boolean
  description?: string
  unitProfile?: string
  targetPeriod: GoalPeriod
  referenceRevenue: number
  tiers: GoalBonusTierConfig[]
  teamBonus: {
    enabled: boolean
    splitMode: GoalBonusSplitMode
    eligibleCollaboratorRule: 'all_goal_participants' | 'manual_eligible'
    prorateByAttendance: boolean
    reliefWorker?: {
      enabled: boolean
      splitMode: GoalReliefWorkerSplitMode
      turnsPerDay: number
      fixedCollaboratorRule: 'remaining_equal_split'
      description?: string
    }
  }
  leadershipBonus: {
    enabled: boolean
    factorNumerator: number
    factorDenominator: number
  }
  incentiveMessages: GoalIncentiveMessageRule[]
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export type GoalMethodSnapshot = Omit<GoalMethodConfig, 'createdAt' | 'updatedAt'>

export interface GoalClosureSnapshot {
  distributionMode: GoalDistributionMode
  periodDateKeys: string[]
  periodDayCount: number
  dailyTarget: number
  dailyUpTarget: number
  dailyTopTarget?: number
  employeeDateKeysByGoalId: Record<string, string[]>
  employeeDayCountsByGoalId: Record<string, number>
  employeeDailyTargetsByGoalId: Record<string, number>
  capturedAt?: Timestamp
}

export interface GoalShift {
  id: string
  label: string
  fraction: number
}

export type GoalLeadershipRecipientSource =
  | 'unit_group_responsible'
  | 'unit_organization_responsible'
  | 'responsible_unit_ids'

export interface GoalLeadershipRecipient {
  userId: string
  userName: string
  source: GoalLeadershipRecipientSource
  sourceLabel: string
}

export interface GoalTemplate {
  id: string
  kioskId: string
  type: GoalType
  period: GoalPeriod
  version?: number
  method?: GoalMethod
  goalMethodConfigId?: string
  goalMethodSnapshot?: GoalMethodSnapshot
  targetValue: number
  upValue: number
  topValue?: number        // metas criadas antes do 3º nível não têm TOP
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
  templateType?: GoalType
  version?: number
  method?: GoalMethod
  goalMethodConfigId?: string
  goalMethodSnapshot?: GoalMethodSnapshot
  startDate: Timestamp
  endDate: Timestamp
  targetValue: number
  upValue: number
  topValue?: number        // metas criadas antes do 3º nível não têm TOP
  currentValue: number
  dailyProgress?: { [date: string]: number }
  distributionMode?: GoalDistributionMode
  shifts?: GoalShift[]
  leadershipRecipients?: GoalLeadershipRecipient[]
  status: GoalStatus
  closedAt?: Timestamp
  closedBy?: string
  closureNote?: string
  closureSnapshot?: GoalClosureSnapshot
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface EmployeeGoal {
  id: string
  periodId: string
  employeeId: string
  kioskId: string
  shiftId?: string
  participantSource?: GoalParticipantSource
  participantRole?: GoalParticipantRole
  scheduledDays?: number
  scheduledTurnCount?: number
  fraction: number
  targetValue: number
  currentValue: number
  dailyProgress?: { [date: string]: number }
  distributionMode?: GoalDistributionMode
  updatedAt: Timestamp
  createdAt: Timestamp
}

// ─── Departamento Pessoal ─────────────────────────────────────────────────────
// Colaboradores = usuários do sistema (users/). Não há coleção separada.

export type DPUnit = {
  id: string;
  name: string;
  isArchived?: boolean;
  mergedIntoUnitId?: string;
  mergedIntoUnitName?: string;
  archivedAt?: Timestamp;
  cnpj?: string;
  address?: string;
  unitType?: string;
  organizationId?: string;
  groupId?: string;
  externalSource?: 'manual' | 'kiosk' | 'pdvlegal' | 'bizneo';
  externalId?: string;
  pdvFilialId?: string;
  bizneoTaxonId?: number; // ID do taxon (local) no Bizneo
  auditChecklistThreshold?: number;
  createdAt: Timestamp;
};

export type DPUnitResponsibilitySource = 'job_role' | 'job_function';

export type DPUnitResponsibility = {
  responsibleSourceType?: DPUnitResponsibilitySource;
  responsibleSourceId?: string;
  responsibleSourceName?: string;
  responsibleUserId?: string;
  responsibleUserName?: string;
  responsibilityStatus?: 'assigned' | 'replacement_required';
  responsibilityVacatedAt?: string;
  responsibilityVacatedByTerminationUserId?: string;
};

export type DPUnitOrganization = {
  id: string;
  name: string;
  description?: string;
  isArchived?: boolean;
  archivedAt?: Timestamp;
  createdAt: Timestamp;
} & DPUnitResponsibility;

export type DPUnitGroup = {
  id: string;
  name: string;
  organizationId?: string;
  unitCount?: number;
  createdAt: Timestamp;
} & DPUnitResponsibility;

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
  userName?: string;         // snapshot mínimo para a escala não depender do diretório carregado
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

// ─── New task motor — Etapa 8 (task_projects / task_statuses / tasks) ──────────

export type TaskStatusCategory = 'not_started' | 'active' | 'done' | 'canceled';
export type TaskLifecycleState =
  | 'open'
  | 'in_progress'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'cancelled';
export type TaskCompletionResult =
  | 'resolved'
  | 'not_resolved'
  | 'partially_resolved'
  | 'cancelled'
  | 'duplicate'
  | 'not_applicable';

export type TaskStatusDoc = {
  id: string;
  project_id: string;
  subproject_id?: string;
  name: string;
  slug: string;
  category: TaskStatusCategory;
  lifecycle_state?: TaskLifecycleState;
  is_initial: boolean;
  is_terminal: boolean;
  order: number;
  color?: string;
  requires_completion_note?: boolean;
  requires_evidence?: boolean;
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

export type TaskSubproject = {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description?: string;
  slug?: string;
  order?: number;
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
  subproject_id?: string;
  status_id: string;
  title: string;
  description?: string;
  assignee_type: 'user' | 'role' | 'team' | 'unit';
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
