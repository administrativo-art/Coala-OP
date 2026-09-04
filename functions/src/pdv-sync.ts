import { createHash } from 'node:crypto';
import { convertValue } from './conversion.js';
import {
  decidePdvSnapshot,
  type PendingDecrease,
  type PdvSnapshotMetrics,
} from './pdv-reconciliation-policy.js';

function getEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`[PDV Sync] Variável de ambiente ${name} não configurada.`);
  return val;
}

const BASE_URL = 'https://api.tabletcloud.com.br';
const CATALOG_LIMITS = {
  simulations: 500,
  simulationItems: 3000,
  baseProducts: 500,
} as const;
const GOAL_QUERY_LIMITS = {
  periodsPerKiosk: 4,
  usersPerKiosk: 100,
  employeeGoalsPerPeriod: 200,
  schedulesPerMonth: 20,
  shiftsPerScheduleChunk: 1000,
} as const;

type CatalogSimulation = { id: string; name?: string; ppo?: { sku?: unknown } } & Record<string, any>;
type CatalogSimulationItem = { id: string; simulationId?: string; baseProductId?: string } & Record<string, any>;
type CatalogBaseProduct = { id: string; name?: string; unit?: string; category?: string } & Record<string, any>;

export type PdvSyncCatalog = {
  simulationBySku: Map<string, CatalogSimulation>;
  simulationItemsBySimulation: Map<string, CatalogSimulationItem[]>;
  baseProductById: Map<string, CatalogBaseProduct>;
};

export type PdvSyncOptions = {
  accessToken?: string;
  catalog?: PdvSyncCatalog;
  mode?: 'live' | 'reconciliation' | 'manual';
  runId?: string;
};

/**
 * Erro estruturado para qualquer falha de comunicação ou formato inesperado
 * vindo da API do PDV Legal. Carrega um `code` legível para diagnóstico, de
 * forma que a UI consiga distinguir "não houve venda" de "a integração quebrou".
 */
export class PdvApiError extends Error {
  constructor(message: string, public code: string, public detail?: string) {
    super(message);
    this.name = 'PdvApiError';
  }
}

/**
 * Diagnóstico de uma sincronização diária. Permite saber, sem abrir os logs,
 * se a API respondeu, quantos cupons/itens vieram e quantos bateram com as
 * fichas técnicas — ou seja, se "não trouxe dados" foi venda zerada ou erro.
 */
export type SyncDiagnostics = {
  couponsReceived: number;
  couponsCancelled: number;
  couponsWithoutItems: number;
  itemsSeen: number;
  itemsCancelled: number;
  itemsMapped: number;
  itemsUnmapped: number;
  itemsZeroValue: number;
  /** SKUs vistos no PDV que não casaram com nenhuma ficha técnica (amostra). */
  unmappedSkus: { sku: string; name: string; count: number }[];
};

/**
 * Detecta e valida o formato da resposta de cupons. A API às vezes devolve um
 * array direto, às vezes um objeto paginado `{ data, links }`, às vezes um
 * objeto vazio. Qualquer outro formato é tratado como ERRO ESTRUTURAL (lança),
 * em vez de virar silenciosamente uma lista vazia.
 */
function parseCouponsResponse(raw: unknown): { coupons: any[]; format: string } {
  if (Array.isArray(raw)) return { coupons: raw, format: 'array' };

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, any>;

    // Formato paginado conhecido (mesmo com data: null quando vazio)
    if ('data' in obj) {
      return { coupons: Array.isArray(obj.data) ? obj.data : [], format: 'paginated' };
    }

    // A API sinalizou um erro no corpo da resposta
    const apiMsg = obj.Message || obj.message || obj.Error || obj.error;
    if (apiMsg) {
      throw new PdvApiError(
        `API do PDV Legal retornou erro: ${apiMsg}`,
        'API_ERROR_PAYLOAD',
        JSON.stringify(obj).slice(0, 300),
      );
    }

    // Objeto vazio {} → tratamos como "sem cupons"
    if (Object.keys(obj).length === 0) return { coupons: [], format: 'empty-object' };

    // Qualquer outra estrutura é desconhecida — falha alto para sabermos que quebrou
    throw new PdvApiError(
      'Estrutura inesperada na resposta de cupons do PDV Legal.',
      'UNEXPECTED_STRUCTURE',
      JSON.stringify(obj).slice(0, 300),
    );
  }

  throw new PdvApiError(
    'Resposta de cupons em formato não reconhecido (esperado array ou objeto).',
    'UNEXPECTED_TYPE',
    String(raw).slice(0, 100),
  );
}

// Extrai horários de início/fim do label do turno, ex: "Manhã (10:00–16:15)" → {start:"10:00",end:"16:15"}
function extractShiftTimes(label: string): { start: string; end: string } | null {
  const match = label.match(/\((\d{2}:\d{2})[–\-](\d{2}:\d{2})\)/u);
  return match ? { start: match[1], end: match[2] } : null;
}

function extractPdvTime(dateStr: string): string {
  if (!dateStr) return '00:00';
  const match = dateStr.trim().match(/[T ](\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '00:00';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function extractBrazilHour(dateStr: string): string {
  return extractPdvTime(dateStr).split(':')[0];
}

export async function getAccessToken() {
  const COD_EMPRESA = getEnv('PDVLEGAL_COD_EMPRESA');
  const API_TOKEN = getEnv('PDVLEGAL_TOKEN');
  const USERNAME = getEnv('PDVLEGAL_USERNAME');
  const PASSWORD = getEnv('PDVLEGAL_PASSWORD');
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('username', USERNAME);
  params.append('password', PASSWORD);
  const authString = Buffer.from(`${COD_EMPRESA}:${API_TOKEN}`).toString('base64');
  const response = await fetch(`${BASE_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${authString}`,
      'Token': API_TOKEN,
    },
    body: params.toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new PdvApiError(
      `Falha na autenticação com o PDV Legal (HTTP ${response.status}).`,
      'AUTH_FAILED',
      detail.slice(0, 300),
    );
  }
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new PdvApiError('Resposta de autenticação do PDV Legal não é JSON válido.', 'AUTH_BAD_JSON');
  }
  if (!data?.access_token) {
    throw new PdvApiError('Token de acesso ausente na resposta do PDV Legal.', 'AUTH_NO_TOKEN');
  }
  return data.access_token as string;
}

async function fetchAllCouponsForDay(accessToken: string, date: string, filialId: string) {
  const COD_EMPRESA = getEnv('PDVLEGAL_COD_EMPRESA');
  const API_TOKEN = getEnv('PDVLEGAL_TOKEN');
  const response = await fetch(`${BASE_URL}/cupom/get/${date}/${date}/${filialId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'CodEmpresa': COD_EMPRESA, 'Token': API_TOKEN },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // Antes retornava [] silenciosamente → erro de API virava "0 cupons".
    throw new PdvApiError(
      `Falha ao buscar cupons da filial ${filialId} (HTTP ${response.status}).`,
      'FETCH_FAILED',
      detail.slice(0, 300),
    );
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new PdvApiError(`Resposta de cupons (${date}) não é JSON válido.`, 'COUPONS_BAD_JSON');
  }
  const { coupons, format } = parseCouponsResponse(raw);
  console.log(`[PDV Sync] ${date} filial ${filialId}: ${coupons.length} cupons recebidos (formato: ${format})`);
  return coupons;
}

function emptyDiagnostics(): SyncDiagnostics {
  return {
    couponsReceived: 0, couponsCancelled: 0, couponsWithoutItems: 0,
    itemsSeen: 0, itemsCancelled: 0, itemsMapped: 0, itemsUnmapped: 0,
    itemsZeroValue: 0, unmappedSkus: [],
  };
}

function assertCatalogQueryWithinLimit(
  label: string,
  size: number,
  limit: number,
): void {
  if (size >= limit) {
    throw new PdvApiError(
      `Catálogo ${label} atingiu o limite seguro de ${limit} documentos.`,
      'CATALOG_LIMIT_REACHED',
    );
  }
}

export async function loadPdvSyncCatalog(
  db: FirebaseFirestore.Firestore,
): Promise<PdvSyncCatalog> {
  const [simulationsSnap, simulationItemsSnap, baseProductsSnap] = await Promise.all([
    db.collection('productSimulations').limit(CATALOG_LIMITS.simulations).get(),
    db.collection('productSimulationItems').limit(CATALOG_LIMITS.simulationItems).get(),
    db.collection('baseProducts').limit(CATALOG_LIMITS.baseProducts).get(),
  ]);

  assertCatalogQueryWithinLimit('de produtos', simulationsSnap.size, CATALOG_LIMITS.simulations);
  assertCatalogQueryWithinLimit('de fichas técnicas', simulationItemsSnap.size, CATALOG_LIMITS.simulationItems);
  assertCatalogQueryWithinLimit('de insumos', baseProductsSnap.size, CATALOG_LIMITS.baseProducts);

  const simulationBySku = new Map<string, CatalogSimulation>();
  for (const doc of simulationsSnap.docs) {
    const simulation = { id: doc.id, ...doc.data() } as CatalogSimulation;
    const sku = simulation.ppo?.sku?.toString().trim();
    if (sku) simulationBySku.set(sku, simulation);
  }

  const simulationItemsBySimulation = new Map<string, CatalogSimulationItem[]>();
  for (const doc of simulationItemsSnap.docs) {
    const item = { id: doc.id, ...doc.data() } as CatalogSimulationItem;
    if (!item.simulationId) continue;
    const entries = simulationItemsBySimulation.get(item.simulationId) ?? [];
    entries.push(item);
    simulationItemsBySimulation.set(item.simulationId, entries);
  }

  const baseProductById = new Map<string, CatalogBaseProduct>();
  for (const doc of baseProductsSnap.docs) {
    baseProductById.set(doc.id, { id: doc.id, ...doc.data() } as CatalogBaseProduct);
  }

  return { simulationBySku, simulationItemsBySimulation, baseProductById };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cents(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? Math.round(numberValue * 100) : 0;
}

function metricFromExistingReport(data: FirebaseFirestore.DocumentData | undefined): PdvSnapshotMetrics | null {
  if (!data) return null;
  const items = Array.isArray(data.items) ? data.items : [];
  const couponCount = Object.values(data.hourlySales ?? {})
    .reduce((sum: number, count) => sum + Number(count ?? 0), 0);
  const itemQuantity = items.reduce((sum: number, item: any) => sum + Number(item.quantity ?? 0), 0);
  const revenueCents = items.reduce(
    (sum: number, item: any) => sum + cents(Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0)),
    0,
  );
  return {
    couponCount: Number(data.sourceCouponCount ?? couponCount),
    itemQuantity: Number(data.sourceItemQuantity ?? itemQuantity),
    revenueCents: Number(data.sourceRevenueCents ?? revenueCents),
    fingerprint: typeof data.sourceFingerprint === 'string'
      ? data.sourceFingerprint
      : `legacy:${couponCount}:${itemQuantity}:${revenueCents}`,
  };
}

type PersistablePdvSnapshot = {
  reportId: string;
  report: FirebaseFirestore.DocumentData;
  consumptionReport: FirebaseFirestore.DocumentData;
  metrics: PdvSnapshotMetrics;
  dailyRevenue: number;
  revenueByOperator: Record<string, number>;
};

type EmployeeGoalEntry = {
  ref: FirebaseFirestore.DocumentReference;
  data: Record<string, any>;
};

function pendingDecreaseFromState(data: FirebaseFirestore.DocumentData | undefined): PendingDecrease | null {
  const pending = data?.pendingDecrease;
  if (!pending || typeof pending.fingerprint !== 'string') return null;
  const confirmations = Number(pending.confirmations);
  if (!Number.isInteger(confirmations) || confirmations < 1) return null;
  return { fingerprint: pending.fingerprint, confirmations };
}

function dateFallsWithinPeriod(dateStr: string, period: FirebaseFirestore.DocumentData): boolean {
  const date = new Date(`${dateStr}T12:00:00Z`);
  const start = period.startDate?.toDate?.() ?? new Date(0);
  const end = period.endDate?.toDate?.() ?? new Date(8640000000000000);
  return date >= start && date <= end;
}

async function persistPdvSnapshot(
  dateStr: string,
  kioskId: string,
  snapshot: PersistablePdvSnapshot,
  db: FirebaseFirestore.Firestore,
  options: PdvSyncOptions,
): Promise<'applied' | 'unchanged' | 'held'> {
  const reportRef = db.collection('salesReports').doc(`sales_${snapshot.reportId}`);
  const consumptionRef = db.collection('consumptionReports').doc(`cons_${snapshot.reportId}`);
  const stateRef = db.collection('pdvSyncReconciliationStates').doc(`${kioskId}_${dateStr}`);
  const syncDate = new Date(`${dateStr}T12:00:00Z`);
  const [year, month] = dateStr.split('-').map(Number);

  return db.runTransaction(async (transaction) => {
    const periodsQuery = db.collection('goalPeriods')
      .where('kioskId', '==', kioskId)
      .where('templateType', '==', 'revenue')
      .where('startDate', '<=', syncDate)
      .orderBy('startDate', 'desc')
      .limit(GOAL_QUERY_LIMITS.periodsPerKiosk);
    const usersQuery = db.collection('users')
      .where('assignedKioskIds', 'array-contains', kioskId)
      .limit(GOAL_QUERY_LIMITS.usersPerKiosk);
    const schedulesQuery = db.collection('dp_schedules')
      .where('year', '==', year)
      .where('month', '==', month)
      .limit(GOAL_QUERY_LIMITS.schedulesPerMonth);

    const [existingReport, stateDoc] = await Promise.all([
      transaction.get(reportRef),
      transaction.get(stateRef),
    ]);

    const existingMetrics = metricFromExistingReport(existingReport.data());
    const pendingDecrease = pendingDecreaseFromState(stateDoc.data());
    const decision = decidePdvSnapshot({ existing: existingMetrics, incoming: snapshot.metrics, pendingDecrease });
    const now = new Date();

    if (decision.action === 'hold') {
      transaction.set(stateRef, {
        kioskId,
        date: dateStr,
        status: 'attention_required',
        reason: decision.reason,
        existingMetrics,
        pendingDecrease: {
          ...snapshot.metrics,
          confirmations: decision.confirmations,
          firstObservedAt: pendingDecrease?.fingerprint === snapshot.metrics.fingerprint
            ? stateDoc.data()?.pendingDecrease?.firstObservedAt ?? now
            : now,
          lastObservedAt: now,
        },
        updatedAt: now,
        runId: options.runId ?? null,
      }, { merge: true });
      return 'held';
    }

    if (decision.action === 'unchanged') {
      if (decision.clearPending) {
        transaction.set(stateRef, {
          status: 'verified',
          reason: null,
          pendingDecrease: null,
          updatedAt: now,
          runId: options.runId ?? null,
        }, { merge: true });
      }
      return 'unchanged';
    }

    const periodsSnap = await transaction.get(periodsQuery);
    const periods = periodsSnap.docs.filter((doc) => {
      const period = doc.data();
      return period.status !== 'cancelled'
        && dateFallsWithinPeriod(dateStr, period);
    });

    const employeeGoalSnaps = await Promise.all(periods.map((periodDoc) => transaction.get(
      db.collection('employeeGoals')
        .where('periodId', '==', periodDoc.id)
        .limit(GOAL_QUERY_LIMITS.employeeGoalsPerPeriod),
    )));
    for (const goalsSnap of employeeGoalSnaps) {
      assertCatalogQueryWithinLimit('de metas individuais', goalsSnap.size, GOAL_QUERY_LIMITS.employeeGoalsPerPeriod);
    }

    const usersSnap = periods.length > 0
      ? await transaction.get(usersQuery)
      : null;
    if (usersSnap) {
      assertCatalogQueryWithinLimit('de usuários da unidade', usersSnap.size, GOAL_QUERY_LIMITS.usersPerKiosk);
    }
    const operatorIdToUserId: Record<string, string> = {};
    for (const userDoc of usersSnap?.docs ?? []) {
      const operatorId = userDoc.data().pdvOperatorIds?.[kioskId];
      if (operatorId != null) operatorIdToUserId[String(operatorId)] = userDoc.id;
    }
    const revenueByEmployeeId: Record<string, number> = {};
    for (const [operatorId, userId] of Object.entries(operatorIdToUserId)) {
      revenueByEmployeeId[userId] = snapshot.revenueByOperator[operatorId] ?? 0;
    }

    const goalsByPeriod = new Map<string, Map<string, EmployeeGoalEntry[]>>();
    const multiShiftEmployeeIds = new Set<string>();
    employeeGoalSnaps.forEach((goalsSnap, index) => {
      const byEmployee = new Map<string, EmployeeGoalEntry[]>();
      for (const goalDoc of goalsSnap.docs) {
        const goal = goalDoc.data() as Record<string, any>;
        if (!Object.prototype.hasOwnProperty.call(revenueByEmployeeId, goal.employeeId)) continue;
        const entries = byEmployee.get(goal.employeeId) ?? [];
        entries.push({ ref: goalDoc.ref, data: goal });
        byEmployee.set(goal.employeeId, entries);
      }
      for (const [employeeId, entries] of byEmployee) {
        if (entries.length > 1 && entries.some(entry => entry.data.shiftId)) {
          multiShiftEmployeeIds.add(employeeId);
        }
      }
      goalsByPeriod.set(periods[index].id, byEmployee);
    });

    const workedTimesByEmployee = new Map<string, string>();
    const employeeIds = [...multiShiftEmployeeIds];
    const schedulesSnap = employeeIds.length > 0
      ? await transaction.get(schedulesQuery)
      : null;
    if (schedulesSnap) {
      assertCatalogQueryWithinLimit('de escalas mensais', schedulesSnap.size, GOAL_QUERY_LIMITS.schedulesPerMonth);
    }
    for (const scheduleDoc of schedulesSnap?.docs ?? []) {
      for (let index = 0; index < employeeIds.length; index += 30) {
        const chunk = employeeIds.slice(index, index + 30);
        if (chunk.length === 0) continue;
        const shiftsSnap = await transaction.get(
          scheduleDoc.ref.collection('shifts')
            .where('userId', 'in', chunk)
            .where('date', '==', dateStr)
            .limit(GOAL_QUERY_LIMITS.shiftsPerScheduleChunk),
        );
        assertCatalogQueryWithinLimit('de turnos da escala', shiftsSnap.size, GOAL_QUERY_LIMITS.shiftsPerScheduleChunk);
        for (const shiftDoc of shiftsSnap.docs) {
          const shift = shiftDoc.data();
          if (shift.type !== 'work' || !shift.startTime || !shift.endTime || !shift.userId) continue;
          workedTimesByEmployee.set(shift.userId, `${shift.startTime}-${shift.endTime}`);
        }
      }
    }

    const existingCreatedAt = existingReport.data()?.createdAt;
    transaction.set(reportRef, {
      ...snapshot.report,
      createdAt: existingCreatedAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      sourceCouponCount: snapshot.metrics.couponCount,
      sourceItemQuantity: snapshot.metrics.itemQuantity,
      sourceRevenueCents: snapshot.metrics.revenueCents,
      sourceFingerprint: snapshot.metrics.fingerprint,
      reconciliationStatus: 'verified',
      reconciledAt: now,
      syncMode: options.mode ?? 'live',
      syncRunId: options.runId ?? null,
    });
    transaction.set(consumptionRef, {
      ...snapshot.consumptionReport,
      createdAt: existingCreatedAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    });
    transaction.set(stateRef, {
      kioskId,
      date: dateStr,
      status: 'verified',
      reason: decision.reason,
      appliedMetrics: snapshot.metrics,
      pendingDecrease: null,
      lastAppliedAt: now,
      updatedAt: now,
      runId: options.runId ?? null,
    });

    periods.forEach((periodDoc, periodIndex) => {
      const period = periodDoc.data();
      const progress = { ...(period.dailyProgress ?? {}), [dateStr]: snapshot.dailyRevenue };
      const currentValue = Object.values(progress)
        .reduce((sum: number, value) => sum + Number(value ?? 0), 0);
      transaction.update(periodDoc.ref, { dailyProgress: progress, currentValue, updatedAt: now });

      const shiftIdByTime = new Map<string, string>();
      for (const shift of Array.isArray(period.shifts) ? period.shifts : []) {
        const times = extractShiftTimes(shift.label ?? '');
        if (times) shiftIdByTime.set(`${times.start}-${times.end}`, shift.id);
      }

      const byEmployee = goalsByPeriod.get(periods[periodIndex].id)
        ?? new Map<string, EmployeeGoalEntry[]>();
      for (const [employeeId, goals] of byEmployee) {
        const employeeRevenue = revenueByEmployeeId[employeeId] ?? 0;
        const workedShiftId = shiftIdByTime.get(workedTimesByEmployee.get(employeeId) ?? '') ?? null;
        const hasMultipleShifts = goals.length > 1 && goals.some(goal => goal.data.shiftId);
        const totalTarget = goals.reduce((sum, goal) => sum + Number(goal.data.targetValue ?? 0), 0);

        for (const goal of goals) {
          let revenueForGoal = employeeRevenue;
          if (hasMultipleShifts && goal.data.shiftId && workedShiftId !== null) {
            revenueForGoal = goal.data.shiftId === workedShiftId ? employeeRevenue : 0;
          } else if (hasMultipleShifts) {
            const target = Number(goal.data.targetValue ?? 0);
            revenueForGoal = employeeRevenue * (totalTarget > 0 ? target / totalTarget : 1 / goals.length);
          }

          const previousValue = Number(goal.data.dailyProgress?.[dateStr] ?? 0);
          if (previousValue === revenueForGoal) continue;
          transaction.update(goal.ref, {
            dailyProgress: { ...(goal.data.dailyProgress ?? {}), [dateStr]: revenueForGoal },
            currentValue: Number(goal.data.currentValue ?? 0) - previousValue + revenueForGoal,
            updatedAt: now,
          });
        }
      }
    });

    return 'applied';
  });
}

async function recordEmptyPdvResponse(
  dateStr: string,
  kioskId: string,
  db: FirebaseFirestore.Firestore,
  options: PdvSyncOptions,
): Promise<'empty' | 'held'> {
  const reportId = `sync_${kioskId}_${dateStr.replace(/-/g, '_')}`;
  const reportRef = db.collection('salesReports').doc(`sales_${reportId}`);
  const stateRef = db.collection('pdvSyncReconciliationStates').doc(`${kioskId}_${dateStr}`);

  return db.runTransaction(async (transaction) => {
    const [existingReport, existingState] = await Promise.all([
      transaction.get(reportRef),
      transaction.get(stateRef),
    ]);
    const existingMetrics = metricFromExistingReport(existingReport.data());
    if (!existingMetrics) return 'empty';

    const now = new Date();
    const priorPending = existingState.data()?.pendingDecrease;
    transaction.set(stateRef, {
      kioskId,
      date: dateStr,
      status: 'attention_required',
      reason: 'empty_after_data',
      existingMetrics,
      pendingDecrease: {
        couponCount: 0,
        itemQuantity: 0,
        revenueCents: 0,
        fingerprint: 'empty-response',
        confirmations: 0,
        firstObservedAt: priorPending?.fingerprint === 'empty-response'
          ? priorPending.firstObservedAt ?? now
          : now,
        lastObservedAt: now,
      },
      updatedAt: now,
      runId: options.runId ?? null,
    }, { merge: true });
    return 'held';
  });
}

export async function syncDayAdmin(
  dateStr: string,
  kioskId: string,
  pdvFilialId: string,
  db: FirebaseFirestore.Firestore,
  options: PdvSyncOptions = {},
) {
  const token = options.accessToken ?? await getAccessToken();
  const coupons = await fetchAllCouponsForDay(token, dateStr, pdvFilialId);
  if (!coupons || coupons.length === 0) {
    const persistence = await recordEmptyPdvResponse(dateStr, kioskId, db, options);
    console.log(`[PDV Sync] ${dateStr} ${kioskId}: sem cupons; persistência ${persistence}.`);
    return {
      success: true,
      count: 0,
      dailyRevenue: 0,
      diagnostics: emptyDiagnostics(),
      warnings: [] as string[],
      persistence,
    };
  }

  // Log estrutura do primeiro cupom e primeiro item para diagnóstico
  const firstCoupon = coupons[0];
  console.log(`[PDV Sync] ${dateStr} cupom[0] keys:`, Object.keys(firstCoupon).join(', '));
  const firstItems = firstCoupon.Itens || firstCoupon.itens;
  if (Array.isArray(firstItems) && firstItems.length > 0) {
    console.log(`[PDV Sync] ${dateStr} item[0] keys:`, Object.keys(firstItems[0]).join(', '));
    console.log(`[PDV Sync] ${dateStr} item[0] sample:`, JSON.stringify(firstItems[0]).slice(0, 300));
  }

  const catalog = options.catalog ?? await loadPdvSyncCatalog(db);

  const date = new Date(dateStr + 'T12:00:00Z');
  const productTotals: Record<string, {
    sku: string;
    productName: string;
    quantity: number;
    simulationId: string;
    timestamp: string;
    revenueCents: number;
  }> = {};
  const hourlySales: Record<string, number> = {};
  const productHourlySales: Record<string, Record<string, number>> = {};
  const comboCounts: Record<string, number> = {};
  // Consumo teórico de insumos base (Vendas API), derivado das fichas técnicas
  const consumptionByBaseProduct: Record<string, { name: string; quantity: number }> = {};

  // Revenue tracking for goals
  let dailyRevenueCents = 0;
  const revenueCentsByOperator: Record<string, number> = {};
  // Quantity per operator per product (simulationId)
  const productQtyByOperator: Record<string, Record<string, number>> = {};

  // Diagnóstico — contabiliza tudo que entra para sabermos se a sync trouxe dados de verdade
  const diag = emptyDiagnostics();
  diag.couponsReceived = coupons.length;
  const unmappedSkuMap: Record<string, { sku: string; name: string; count: number }> = {};

  for (const coupon of coupons) {
    const rawItems = coupon.Itens || coupon.itens;
    if (!rawItems || !Array.isArray(rawItems)) { diag.couponsWithoutItems++; continue; }
    const isCupomCancelado = coupon.iscancelado || coupon.status === 'CANCELADO';
    const hasAnyItemExplicitlyCancelled = rawItems.some((item: any) => item.iscancelado === true);
    if (isCupomCancelado && !hasAnyItemExplicitlyCancelled) { diag.couponsCancelled++; continue; }
    const couponTime = coupon.dtrecebimento || coupon.dtabertura || rawItems.find((i: any) => i.dtmovimento)?.dtmovimento || '';
    const hour = extractBrazilHour(couponTime);
    hourlySales[hour] = (hourlySales[hour] || 0) + 1;
    const validMappedItemsForCombo: { name: string, qty: number }[] = [];

    // Operador do cupom (quem recebeu o pagamento)
    const couponOperatorId = coupon.usuariorecebimento_id ?? null;

    for (const item of rawItems) {
      diag.itemsSeen++;
      if (item.iscancelado) { diag.itemsCancelled++; continue; }
      const possibleSkus = [item.codigoVenda, item.codproduto, item.codProdutoExterno, item.CodRef, item.Codigo].filter(Boolean).map(c => c.toString().trim());
      const qty = Number(item.quantidade || item.Quantidade || 0);
      // valortotal já é o total do item (qty × preço − desconto + acréscimo)
      const itemRevenueCents = cents(item.valortotal ?? item.ValorTotal);
      if (!itemRevenueCents) diag.itemsZeroValue++;

      // Accumulate revenue for goals
      dailyRevenueCents += itemRevenueCents;
      // Operador preferencial: do item; fallback: do cupom
      const operatorId = item.usuariooperador_id ?? couponOperatorId;
      if (operatorId != null) {
        const opKey = String(operatorId);
        revenueCentsByOperator[opKey] = (revenueCentsByOperator[opKey] || 0) + itemRevenueCents;
      }

      const sim = possibleSkus.map(sku => catalog.simulationBySku.get(sku)).find(Boolean);
      const rawSku = possibleSkus[0] || 'SEM_SKU';
      const rawName = item.Descricao || item.nomeProduto || item.descricao || 'Produto sem descrição';
      if (!sim) {
        diag.itemsUnmapped++;
        if (!unmappedSkuMap[rawSku]) {
          unmappedSkuMap[rawSku] = { sku: rawSku, name: rawName, count: 0 };
        }
        unmappedSkuMap[rawSku].count++;
      } else {
        diag.itemsMapped++;
      }

      // Itens sem ficha também permanecem no relatório: receita não pode
      // desaparecer só porque o cadastro de custo ainda está incompleto.
      const simulationId = sim?.id ?? `pdv-unmapped:${rawSku}`;
      const productName = sim?.name || rawName;
      const sku = sim?.ppo?.sku?.toString().trim() || rawSku;

      // Track quantity per operator per product
      if (operatorId != null) {
        const opKey = String(operatorId);
        if (!productQtyByOperator[opKey]) productQtyByOperator[opKey] = {};
        productQtyByOperator[opKey][simulationId] = (productQtyByOperator[opKey][simulationId] || 0) + qty;
      }
      const existingComboItem = validMappedItemsForCombo.find(i => i.name === productName);
      if (existingComboItem) existingComboItem.qty += qty;
      else validMappedItemsForCombo.push({ name: productName, qty });

      const itTime = item.dtmovimento || coupon.dtabertura || coupon.dtrecebimento;
      const itemTimestamp = extractPdvTime(itTime || '') || `${hour}:00`;
      if (!productTotals[simulationId]) {
        productTotals[simulationId] = {
          sku,
          productName,
          quantity: 0,
          simulationId,
          timestamp: itemTimestamp,
          revenueCents: 0,
        };
      }
      productTotals[simulationId].quantity += qty;
      productTotals[simulationId].revenueCents += itemRevenueCents;
      if (!productHourlySales[simulationId]) productHourlySales[simulationId] = {};
      productHourlySales[simulationId][hour] = (productHourlySales[simulationId][hour] || 0) + qty;

      // Consumo teórico de insumos base: expande a ficha técnica da simulação
      if (!sim) continue;
      for (const simItem of catalog.simulationItemsBySimulation.get(sim.id) ?? []) {
        const bp = simItem.baseProductId
          ? catalog.baseProductById.get(simItem.baseProductId)
          : undefined;
        if (!bp?.unit || !bp.category) continue;
        try {
          const valuePerUnit = convertValue(
            simItem.quantity,
            simItem.overrideUnit || bp.unit,
            bp.unit,
            bp.category,
          );
          const consumed = qty * valuePerUnit;
          if (!consumptionByBaseProduct[bp.id]) {
            consumptionByBaseProduct[bp.id] = { name: bp.name || 'Insumo sem nome', quantity: 0 };
          }
          consumptionByBaseProduct[bp.id].quantity += consumed;
        } catch {
          /* unidade incompatível — ignora este insumo */
        }
      }
    }

    if (validMappedItemsForCombo.length > 0) {
      const comboString = validMappedItemsForCombo.sort((a, b) => a.name.localeCompare(b.name)).map(i => `${i.qty}x ${i.name}`).join(' + ');
      comboCounts[comboString] = (comboCounts[comboString] || 0) + 1;
    }
  }

  // Amostra dos SKUs sem ficha técnica (top 20 por frequência)
  diag.unmappedSkus = Object.values(unmappedSkuMap).sort((a, b) => b.count - a.count).slice(0, 20);

  // ── Checagens de integridade — sinalizam quando "sucesso" não trouxe dados ──
  const warnings: string[] = [];
  if (diag.couponsReceived > 0 && diag.itemsMapped === 0) {
    warnings.push('Cupons recebidos, mas nenhum item bateu com as fichas técnicas (SKUs não mapeados).');
  }
  if (diag.itemsSeen > 0 && diag.itemsUnmapped / diag.itemsSeen > 0.5) {
    warnings.push(`Mais da metade dos itens (${diag.itemsUnmapped}/${diag.itemsSeen}) sem ficha técnica.`);
  }
  if (diag.couponsReceived > 0 && dailyRevenueCents === 0) {
    warnings.push('Cupons recebidos, mas faturamento calculado foi R$ 0,00 — verifique o campo valortotal da API.');
  }
  if (warnings.length > 0) {
    console.warn(`[PDV Sync] ${dateStr} ${kioskId}: ⚠️ ${warnings.join(' | ')}`, JSON.stringify(diag));
  }

  const reportItems = Object.values(productTotals)
    .map(({ revenueCents, ...item }) => ({
      ...item,
      unitPrice: item.quantity > 0 ? (revenueCents / 100) / item.quantity : 0,
    }))
    .sort((left, right) => left.simulationId.localeCompare(right.simulationId));
  const reportRevenueCents = reportItems.reduce(
    (sum, item) => sum + cents(item.quantity * item.unitPrice),
    0,
  );
  if (reportRevenueCents !== dailyRevenueCents) {
    throw new PdvApiError(
      `Invariante de faturamento violada em ${kioskId}/${dateStr}.`,
      'REVENUE_INVARIANT_FAILED',
      `api=${dailyRevenueCents};report=${reportRevenueCents}`,
    );
  }

  const combos = Object.entries(comboCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  const revenueByOperator = Object.fromEntries(
    Object.entries(revenueCentsByOperator).map(([operatorId, value]) => [operatorId, value / 100]),
  );
  const dailyRevenue = dailyRevenueCents / 100;
  const sourceCouponCount = Object.values(hourlySales).reduce((sum, value) => sum + value, 0);
  const sourceItemQuantity = reportItems.reduce((sum, item) => sum + item.quantity, 0);
  const sourceFingerprint = createHash('sha256').update(stableStringify({
    items: reportItems,
    hourlySales,
    productHourlySales,
    combos,
    productQtyByOperator,
    revenueByOperator,
    diagnostics: diag,
  })).digest('hex');
  const reportId = `sync_${kioskId}_${dateStr.replace(/-/g, '_')}`;
  const persistence = await persistPdvSnapshot(dateStr, kioskId, {
    reportId,
    report: {
      reportName: `Sincronização Automática ${dateStr}`,
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      day: date.getDate(),
      kioskId,
      consumptionReportId: `cons_${reportId}`,
      items: reportItems,
      hourlySales,
      productHourlySales,
      combos,
      productQtyByOperator,
      syncDiagnostics: diag,
    },
    consumptionReport: {
      reportName: `Sincronização Automática ${dateStr}`,
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      day: date.getDate(),
      kioskId,
      status: 'completed',
      results: Object.entries(consumptionByBaseProduct).map(([id, data]) => ({
        productId: id,
        productName: data.name,
        consumedQuantity: data.quantity,
        baseProductId: id,
      })),
    },
    metrics: {
      couponCount: sourceCouponCount,
      itemQuantity: sourceItemQuantity,
      revenueCents: dailyRevenueCents,
      fingerprint: sourceFingerprint,
    },
    dailyRevenue,
    revenueByOperator,
  }, db, options);


  console.log(
    `[PDV Sync] ${dateStr} ${kioskId}: faturamento R$ ${dailyRevenue.toFixed(2)}, `
    + `cupons ${sourceCouponCount}, persistência ${persistence}.`,
  );

  return { success: true, count: coupons.length, dailyRevenue, diagnostics: diag, warnings, persistence };
}
