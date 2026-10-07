import { type Firestore, type Query, type DocumentData } from 'firebase-admin/firestore';
import { belemDate, calculateReplenishment, effectiveLeadTime, historyStart, historyEnd, type DemandDay, type DemandSource, type SupplyMode } from './replenishment-policy.js';

const PAGE_SIZE = 400;
const READ_CAP = 20_000;
type ProductInfo = { baseProductId: string; factor: number | null };
type Report = { kioskId: string; date: string; quantities: Map<string, number>; baseIds: Set<string>; usable: boolean };
type Transfer = { kioskId: string; date: string; baseProductId: string; quantity: number };

async function boundedDocs(query: Query<DocumentData>, label: string) {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(PAGE_SIZE).get();
    docs.push(...page.docs);
    if (docs.length > READ_CAP) throw new Error(`${label}: read cap exceeded; no partial recalculation committed`);
    if (page.size < PAGE_SIZE) return docs;
    cursor = page.docs[page.docs.length - 1];
  }
}

function conversionFactor(product: DocumentData, base: DocumentData): number | null {
  const size = Number(product.packageSize);
  if (!Number.isFinite(size) || size <= 0) return null;
  const category = String(base.category ?? '');
  const factors: Record<string, Record<string, number>> = {
    Volume: { l: 1, ml: 0.001, bag: 1 },
    Massa: { kg: 1, g: 0.001, mg: 0.000001 },
    Unidade: { un: 1, pacote: 1, bag: 1, caixa: 1 },
    Embalagem: { un: 1, pacote: 1, bag: 1, caixa: 1 },
    Vestimenta: { 'peça': 1, un: 1 },
  };
  const normalize = (value: unknown) => {
    const unit = String(value ?? '').trim().toLowerCase();
    return unit === 'unidade' ? 'un' : unit;
  };
  const from = normalize(product.unit), to = normalize(base.unit);
  const table = factors[category];
  if (!table || table[from] === undefined || table[to] === undefined) return null;
  return size * table[from] / table[to];
}

/** Unit relationship independent of the supply mode of each ingredient. */
export async function loadSupplyMap(db: Firestore): Promise<Map<string, Set<string>>> {
  const [unitDocs, groupDocs] = await Promise.all([
    boundedDocs(db.collection('dp_units'), 'dp_units'),
    boundedDocs(db.collection('dp_unitGroups'), 'dp_unitGroups'),
  ]);
  const groups = new Map(groupDocs.map(doc => [doc.id, doc.get('suppliedGroupIds') as string[] | undefined]));
  const units: Array<{ kioskId: string; groupId: string; role: string }> = [];
  for (const doc of unitDocs) {
    const data = doc.data();
    if (data.isArchived || data.externalSource !== 'kiosk' || typeof data.externalId !== 'string') continue;
    units.push({ kioskId: data.externalId, groupId: String(data.groupId ?? ''), role: data.stockRole ?? 'commercial' });
  }
  const map = new Map<string, Set<string>>();
  for (const supplier of units) {
    if (supplier.role !== 'supply' && supplier.role !== 'mixed') continue;
    const servedGroups = new Set(groups.get(supplier.groupId) ?? []);
    if (supplier.role === 'mixed') servedGroups.add(supplier.groupId);
    map.set(supplier.kioskId, new Set(units
      .filter(unit => unit.role !== 'supply' && servedGroups.has(unit.groupId))
      .map(unit => unit.kioskId)));
  }
  return map;
}

async function loadReports(db: Firestore, start: string, end: string, kioskIds?: Set<string>): Promise<Report[]> {
  const years = [...new Set([Number(start.slice(0, 4)), Number(end.slice(0, 4))])];
  const reports: Report[] = [];
  for (const year of years) {
    const firstMonth = year === Number(start.slice(0, 4)) ? Number(start.slice(5, 7)) : 1;
    const lastMonth = year === Number(end.slice(0, 4)) ? Number(end.slice(5, 7)) : 12;
    const queries = kioskIds
      ? [...kioskIds].map(id => db.collection('consumptionReports').where('kioskId', '==', id).where('year', '==', year))
      : [db.collection('consumptionReports').where('year', '==', year)];
    for (const query of queries) {
    const docs = (await boundedDocs(query.where('month', '>=', firstMonth)
      .where('month', '<=', lastMonth).orderBy('month'), `consumptionReports ${year}`)).filter(doc => {
      const data = doc.data();
      const day = Number(data.day ?? doc.id.match(/_\d{4}_\d{2}_(\d{1,2})$/)?.[1]);
      const date = `${data.year}-${String(data.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return date >= start && date <= end;
    });
    for (let offset = 0; offset < docs.length; offset += 100) {
      const chunk = docs.slice(offset, offset + 100);
      const sales = await db.getAll(...chunk.map(doc => db.collection('salesReports').doc(doc.id.replace(/^cons_/, 'sales_'))));
      const states = await db.getAll(...chunk.map(doc => {
        const data = doc.data();
        const day = Number(data.day ?? doc.id.match(/_\d{4}_\d{2}_(\d{1,2})$/)?.[1]);
        const date = `${data.year}-${String(data.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return db.collection('pdvSyncReconciliationStates').doc(`${data.kioskId}_${date}`);
      }));
      for (let i = 0; i < chunk.length; i++) {
        const doc = chunk[i], data = doc.data();
        const day = Number(data.day ?? doc.id.match(/_\d{4}_\d{2}_(\d{1,2})$/)?.[1]);
        const date = `${data.year}-${String(data.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (!data.kioskId || !Number.isInteger(day) || day < 1 || day > 31 || date < start || date > end) continue;
        const sale = sales[i].data();
        const diag = sale?.syncDiagnostics;
        const quality = data.consumptionQuality;
        let usable = Boolean(sale?.reconciliationStatus === 'verified' &&
          states[i].get('status') === 'verified' &&
          data.status === 'completed' && Array.isArray(data.results) &&
          diag && Number.isFinite(diag.couponsReceived) &&
          diag.couponsWithoutItems === 0 &&
          diag.couponsReceived - diag.couponsCancelled - diag.couponsWithoutItems === sale.sourceCouponCount &&
          states[i].get('appliedMetrics')?.couponCount === sale.sourceCouponCount &&
          states[i].get('appliedMetrics')?.revenueCents === sale.sourceRevenueCents &&
          diag.itemsUnmapped === 0 && Array.isArray(diag.unmappedSkus) &&
          diag.unmappedSkus.length === 0 && quality?.version === 1 && quality.issues === 0);
        const baseIds = new Set<string>((Array.isArray(data.results) ? data.results : [])
          .filter((item: DocumentData) => typeof item?.baseProductId === 'string')
          .map((item: DocumentData) => item.baseProductId));
        const quantities = new Map<string, number>();
        if (usable) for (const item of data.results) {
          if (typeof item?.baseProductId !== 'string' || !Number.isFinite(item.consumedQuantity) || item.consumedQuantity < 0) {
            usable = false;
            break;
          }
          quantities.set(item.baseProductId, (quantities.get(item.baseProductId) ?? 0) + item.consumedQuantity);
        }
        reports.push({ kioskId: data.kioskId, date, quantities, baseIds, usable });
      }
    }
    }
  }
  return reports;
}

async function loadFirstReportDates(db: Firestore, kioskIds: Set<string>, fallback: string) {
  const dates = new Map<string, string>();
  for (const kioskId of kioskIds) {
    const first = await db.collection('consumptionReports').where('kioskId', '==', kioskId)
      .orderBy('year').orderBy('month').orderBy('day').limit(1).get();
    const value = first.docs[0]?.data();
    const date = value && Number.isInteger(value.day) && value.day > 0
      ? `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
      : fallback;
    dates.set(kioskId, date);
  }
  return dates;
}

async function loadTransfers(db: Firestore, start: string, end: string, products: Map<string, ProductInfo>) {
  const lower = `${start}T03:00:00.000Z`;
  const upper = new Date(Date.parse(`${end}T03:00:00.000Z`) + 86_400_000).toISOString();
  const [strings, timestamps] = await Promise.all([
    boundedDocs(db.collection('movementHistory')
      .where('type', '==', 'TRANSFERENCIA_ENTRADA')
      .where('timestamp', '>=', lower)
      .where('timestamp', '<', upper), 'movementHistory ISO 180d'),
    boundedDocs(db.collection('movementHistory')
      .where('type', '==', 'TRANSFERENCIA_ENTRADA')
      .where('timestamp', '>=', new Date(lower))
      .where('timestamp', '<', new Date(upper)), 'movementHistory Timestamp 180d'),
  ]);
  const docs = new Map([...strings, ...timestamps].map(doc => [doc.id, doc])).values();
  const transfers: Transfer[] = [];
  const invalid = new Set<string>();
  for (const doc of docs) {
    const movement = doc.data();
    if (movement.type !== 'TRANSFERENCIA_ENTRADA' || movement.reverted === true || !movement.toKioskId) continue;
    const product = products.get(movement.productId);
    if (!product) continue; // It belongs to a different ingredient in a scoped recalculation.
    if (!movement.activityId || product.factor === null || !Number.isFinite(movement.quantityChange) || movement.quantityChange <= 0) {
      invalid.add(`${product.baseProductId}:${movement.toKioskId}`);
      continue;
    }
    const timestamp = typeof movement.timestamp?.toDate === 'function'
      ? movement.timestamp.toDate() : new Date(movement.timestamp);
    if (!Number.isFinite(timestamp.getTime())) continue;
    transfers.push({ kioskId: movement.toKioskId, date: belemDate(timestamp),
      baseProductId: product.baseProductId, quantity: movement.quantityChange * product.factor });
  }
  return { entries: transfers, invalid };
}

export type RecalculationSummary = { updated: number; pending: number; zeroedCd: number; skippedArchived: number };
export async function runMinimumStockRecalculation(
  db: Firestore, now: Date, baseProductId?: string, enabled = true,
): Promise<RecalculationSummary> {
  const start = historyStart(now), end = historyEnd(now);
  const [bases, supplyMap] = await Promise.all([
    baseProductId
      ? db.collection('baseProducts').doc(baseProductId).get().then(doc => doc.exists ? [doc] : [])
      : boundedDocs(db.collection('baseProducts'), 'baseProducts'),
    loadSupplyMap(db),
  ]);
  const kioskFilter = baseProductId ? new Set<string>() : undefined;
  if (kioskFilter) for (const doc of bases) {
    for (const id of Object.keys(doc.data()?.stockLevels ?? {})) {
      kioskFilter.add(id);
      for (const served of supplyMap.get(id) ?? []) kioskFilter.add(served);
    }
  }
  const [productDocs, reports] = await Promise.all([
    boundedDocs(baseProductId
      ? db.collection('products').where('baseProductId', '==', baseProductId)
      : db.collection('products'), 'products'),
    loadReports(db, start, end, kioskFilter),
  ]);
  const basesById = new Map(bases.map(doc => [doc.id, doc.data()]));
  const products = new Map<string, ProductInfo>();
  for (const doc of productDocs) {
    const data = doc.data(), base = basesById.get(data.baseProductId);
    if (base) products.set(doc.id, { baseProductId: data.baseProductId, factor: conversionFactor(data, base) });
  }
  const transferData = await loadTransfers(db, start, end, products);
  const transfers = transferData.entries;
  const reportByKiosk = new Map<string, Report[]>(), transferByKiosk = new Map<string, Transfer[]>();
  for (const report of reports) reportByKiosk.set(report.kioskId, [...(reportByKiosk.get(report.kioskId) ?? []), report]);
  for (const transfer of transfers) transferByKiosk.set(transfer.kioskId, [...(transferByKiosk.get(transfer.kioskId) ?? []), transfer]);
  const servedIds = new Set([...supplyMap.values()].flatMap(ids => [...ids]));
  const firstReportDates = await loadFirstReportDates(db, servedIds, start);
  let batch = db.batch(), writes = 0;
  const summary: RecalculationSummary = { updated: 0, pending: 0, zeroedCd: 0, skippedArchived: 0 };
  for (const doc of bases) {
    const base = doc.data();
    if (!base) continue;
    if (base.isArchived === true) { summary.skippedArchived++; continue; }
    const levels = base.stockLevels ?? {};
    const kioskIds = new Set<string>([...Object.keys(levels), ...reportByKiosk.keys(), ...transferByKiosk.keys(), ...supplyMap.keys()]);
    const updatePayload: Record<string, unknown> = {};
    for (const kioskId of kioskIds) {
      const level = levels[kioskId] ?? {}, isSupply = supplyMap.has(kioskId);
      const served = isSupply ? [...supplyMap.get(kioskId)!].filter(id => levels[id]?.supplyMode !== 'direct') : [kioskId];
      const days: DemandDay[] = [];
      let source: DemandSource = 'none';
      let sourceWindowStart = start;
      const pdv = served.flatMap(id => reportByKiosk.get(id) ?? []);
      if (pdv.some(report => report.baseIds.has(doc.id))) {
        source = 'pdv_internal';
        const byUnitAndDate = new Map<string, Report[]>();
        for (const report of pdv) {
          const key = `${report.kioskId}:${report.date}`;
          byUnitAndDate.set(key, [...(byUnitAndDate.get(key) ?? []), report]);
        }
        const dates = new Set(pdv.map(report => report.date));
        for (const date of dates) {
          const activeUnits = served.filter(id => (firstReportDates.get(id) ?? start) <= date);
          const lines = activeUnits.map(id => byUnitAndDate.get(`${id}:${date}`) ?? []);
          days.push({ date,
            quantity: lines.flat().reduce((sum, report) => sum + (report.quantities.get(doc.id) ?? 0), 0),
            usable: lines.length > 0 && lines.every(reports => reports.length === 1 && reports[0].usable) });
        }
      } else {
        const proxy = served.flatMap(id => transferByKiosk.get(id) ?? []).filter(entry => entry.baseProductId === doc.id);
        if (proxy.length) source = 'transfer_proxy';
        // Coverage begins with the first observed transfer; earlier days are unknown, not zero.
        const observedStart = proxy.map(entry => entry.date).sort()[0] ?? end;
        sourceWindowStart = observedStart;
        for (let day = Date.parse(`${observedStart}T12:00:00Z`); day <= Date.parse(`${end}T12:00:00Z`); day += 86_400_000) {
          days.push({ date: new Date(day).toISOString().slice(0, 10), quantity: 0, usable: source === 'transfer_proxy' });
        }
        for (const entry of proxy) days.push({ date: entry.date, quantity: entry.quantity, usable: true });
      }
      const result = calculateReplenishment({ days, source, unit: base.unit,
        cycleDays: base.minStockRecalcPeriod === 'biweekly' ? 15 : 30,
        isSupplyUnit: isSupply, servedUnitCount: served.length,
        minimumValidDays: source === 'transfer_proxy' ? 14 : undefined });
      if (source === 'transfer_proxy' && served.some(id => transferData.invalid.has(`${doc.id}:${id}`))) {
        result.target = null;
        result.calculationStatus = 'pending';
        result.sourceLimitation = 'Histórico de transferências contém quantidade, vínculo ou conversão inválida; conferir os derivados.';
      }
      if (source === 'pdv_internal' && result.target === null) {
        result.sourceLimitation += ' Diagnósticos de ficha/conversão e reconciliação completos são obrigatórios; históricos sem evidência não são certificados.';
      }
      const mode: SupplyMode = level.supplyMode === 'direct' ? 'direct' : 'cd';
      const calculation = {
        supplyMode: mode, effectiveLeadTime: effectiveLeadTime(mode, level.leadTime, isSupply),
        min: result.target ?? 0, override: false,
        calculationStatus: result.calculationStatus, source: result.source,
        sourceLimitation: result.sourceLimitation, validDays: result.validDays,
        windowStart: sourceWindowStart, windowEnd: end, avgDaily: result.meanDaily,
        lastAutoCalculatedMean: result.meanDaily === null ? null :
          Math.round(result.meanDaily * (base.minStockRecalcPeriod === 'biweekly' ? 15 : 30) * 100) / 100,
        lastAutoCalculatedAt: now.toISOString(),
      };
      updatePayload[enabled ? `stockLevels.${kioskId}` : `replenishmentPreview.${kioskId}`] =
        enabled ? { ...level, ...calculation } : calculation;
      summary.updated++;
      if (result.target === null) summary.pending++;
      if (result.calculationStatus === 'no_dependents') summary.zeroedCd++;
    }
    if (Object.keys(updatePayload).length) {
      batch.update(doc.ref, updatePayload, { lastUpdateTime: doc.updateTime });
      writes++;
      if (writes === 400) { await batch.commit(); batch = db.batch(); writes = 0; }
    }
  }
  if (writes) await batch.commit();
  return summary;
}
