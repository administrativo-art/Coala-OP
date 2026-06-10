function getEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`[PDV Sync] Variável de ambiente ${name} não configurada.`);
  return val;
}

const BASE_URL = 'https://api.tabletcloud.com.br';

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

export async function syncDayAdmin(dateStr: string, kioskId: string, pdvFilialId: string, db: FirebaseFirestore.Firestore) {
  const token = await getAccessToken();
  const coupons = await fetchAllCouponsForDay(token, dateStr, pdvFilialId);
  if (!coupons || coupons.length === 0) {
    console.log(`[PDV Sync] ${dateStr} ${kioskId}: sem cupons, pulando.`);
    return { success: true, count: 0, dailyRevenue: 0, diagnostics: emptyDiagnostics(), warnings: [] as string[] };
  }

  // Log estrutura do primeiro cupom e primeiro item para diagnóstico
  const firstCoupon = coupons[0];
  console.log(`[PDV Sync] ${dateStr} cupom[0] keys:`, Object.keys(firstCoupon).join(', '));
  const firstItems = firstCoupon.Itens || firstCoupon.itens;
  if (Array.isArray(firstItems) && firstItems.length > 0) {
    console.log(`[PDV Sync] ${dateStr} item[0] keys:`, Object.keys(firstItems[0]).join(', '));
    console.log(`[PDV Sync] ${dateStr} item[0] sample:`, JSON.stringify(firstItems[0]).slice(0, 300));
  }

  const simsSnap = await db.collection('productSimulations').get();
  const simulations = simsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  const date = new Date(dateStr + 'T12:00:00Z');
  const productTotals: Record<string, any> = {};
  const hourlySales: Record<string, number> = {};
  const productHourlySales: Record<string, Record<string, number>> = {};
  const comboCounts: Record<string, number> = {};

  // Revenue tracking for goals
  let dailyRevenue = 0;
  const revenueByOperator: Record<string, number> = {};
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
      const qty = item.quantidade || item.Quantidade || 0;
      // valortotal já é o total do item (qty × preço − desconto + acréscimo)
      const revenue = item.valortotal || 0;
      if (!revenue) diag.itemsZeroValue++;

      // Accumulate revenue for goals
      dailyRevenue += revenue;
      // Operador preferencial: do item; fallback: do cupom
      const operatorId = item.usuariooperador_id ?? couponOperatorId;
      if (operatorId != null) {
        const opKey = String(operatorId);
        revenueByOperator[opKey] = (revenueByOperator[opKey] || 0) + revenue;
      }

      const sim = simulations.find(s => {
        const simSku = s.ppo?.sku?.toString().trim();
        return simSku && possibleSkus.includes(simSku);
      });
      if (!sim) {
        diag.itemsUnmapped++;
        const key = possibleSkus[0] || 'SEM_SKU';
        if (!unmappedSkuMap[key]) {
          unmappedSkuMap[key] = { sku: key, name: item.Descricao || item.nomeProduto || item.descricao || 'Sem descrição', count: 0 };
        }
        unmappedSkuMap[key].count++;
        continue;
      }
      diag.itemsMapped++;

      // Track quantity per operator per product
      if (operatorId != null) {
        const opKey = String(operatorId);
        if (!productQtyByOperator[opKey]) productQtyByOperator[opKey] = {};
        productQtyByOperator[opKey][sim.id] = (productQtyByOperator[opKey][sim.id] || 0) + qty;
      }
      const sku = sim.ppo?.sku?.toString().trim() || possibleSkus[0];
      const existingComboItem = validMappedItemsForCombo.find(i => i.name === sim.name);
      if (existingComboItem) existingComboItem.qty += qty;
      else validMappedItemsForCombo.push({ name: sim.name, qty });

      const itTime = item.dtmovimento || coupon.dtabertura || coupon.dtrecebimento;
      const itemTimestamp = extractPdvTime(itTime || '') || `${hour}:00`;
      if (!productTotals[sim.id]) {
        productTotals[sim.id] = {
          sku,
          productName: sim.name,
          quantity: 0,
          simulationId: sim.id,
          timestamp: itemTimestamp,
          unitPrice: item.PrecoVenda || item.precoVenda || (qty > 0 ? revenue / qty : 0),
        };
      }
      productTotals[sim.id].quantity += qty;
      if (!productHourlySales[sim.id]) productHourlySales[sim.id] = {};
      productHourlySales[sim.id][hour] = (productHourlySales[sim.id][hour] || 0) + qty;
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
  if (diag.couponsReceived > 0 && dailyRevenue === 0) {
    warnings.push('Cupons recebidos, mas faturamento calculado foi R$ 0,00 — verifique o campo valortotal da API.');
  }
  if (warnings.length > 0) {
    console.warn(`[PDV Sync] ${dateStr} ${kioskId}: ⚠️ ${warnings.join(' | ')}`, JSON.stringify(diag));
  }

  const reportId = `sync_${kioskId}_${dateStr.replace(/-/g, '_')}`;
  await db.collection('salesReports').doc(`sales_${reportId}`).set({
    reportName: `Sincronização Automática ${dateStr}`,
    month: date.getMonth() + 1, year: date.getFullYear(), day: date.getDate(), kioskId, createdAt: new Date().toISOString(),
    items: Object.values(productTotals), hourlySales, productHourlySales,
    combos: Object.entries(comboCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    productQtyByOperator,
    syncDiagnostics: diag,
  });

  // ── Update active goal periods ────────────────────────────────────────────

  console.log(`[PDV Sync] ${dateStr} ${kioskId}: faturamento total = R$ ${dailyRevenue.toFixed(2)}, operadores = ${Object.keys(revenueByOperator).length}`);

  await syncGoalsForDay(dateStr, kioskId, dailyRevenue, revenueByOperator, db);

  return { success: true, count: coupons.length, dailyRevenue, diagnostics: diag, warnings };
}

export async function syncGoalsForDay(
  dateStr: string,
  kioskId: string,
  dailyRevenue: number,
  revenueByOperator: Record<string, number>,
  db: FirebaseFirestore.Firestore,
) {
  const periodsSnap = await db.collection('goalPeriods')
    .where('kioskId', '==', kioskId)
    .where('status', '==', 'active')
    .get();

  if (periodsSnap.empty) return;

  // Fetch users for operator ID mapping
  const usersSnap = await db.collection('users')
    .where('assignedKioskIds', 'array-contains', kioskId)
    .get();

  const operatorIdToUserId: Record<string, string> = {};
  for (const u of usersSnap.docs) {
    const opId = u.data().pdvOperatorIds?.[kioskId];
    if (opId != null) operatorIdToUserId[String(opId)] = u.id;
  }

  // dateStr as timestamp for range comparison
  const syncDate = new Date(dateStr + 'T12:00:00Z');

  for (const periodDoc of periodsSnap.docs) {
    const period = periodDoc.data();

    // Only handle revenue type for now (qty/ticket/product require different calculation)
    const templateType = period.templateType ?? 'revenue';
    if (templateType !== 'revenue') continue;

    // Filter: dateStr must fall within the period's startDate–endDate range
    const periodStart: Date = period.startDate?.toDate?.() ?? new Date(0);
    const periodEnd: Date = period.endDate?.toDate?.() ?? new Date(8640000000000000);
    if (syncDate < periodStart || syncDate > periodEnd) continue;

    // Update dailyProgress and recalculate currentValue
    const currentProgress: Record<string, number> = period.dailyProgress ?? {};
    const updatedProgress = { ...currentProgress, [dateStr]: dailyRevenue };
    const newCurrentValue = Object.values(updatedProgress).reduce((a: number, b: number) => a + b, 0);

    await db.collection('goalPeriods').doc(periodDoc.id).update({
      dailyProgress: updatedProgress,
      currentValue: newCurrentValue,
      updatedAt: new Date(),
    });

    // Update EmployeeGoal.currentValue per operator
    const empGoalsSnap = await db.collection('employeeGoals')
      .where('periodId', '==', periodDoc.id)
      .get();

    // Revenue por employeeId (evita re-lookup do opId no loop interno)
    const revenueByEmployeeId: Record<string, number> = {};
    for (const [opId, userId] of Object.entries(operatorIdToUserId)) {
      revenueByEmployeeId[userId] = revenueByOperator[opId] ?? 0;
    }

    // Agrupar goals por employeeId para detectar funcionários com múltiplos turnos
    type EgEntry = { doc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>; eg: Record<string, any> };
    const goalsByEmployee = new Map<string, EgEntry[]>();
    for (const egDoc of empGoalsSnap.docs) {
      const eg = egDoc.data() as Record<string, any>;
      if (!revenueByEmployeeId.hasOwnProperty(eg.employeeId)) continue;
      const list = goalsByEmployee.get(eg.employeeId) ?? [];
      list.push({ doc: egDoc, eg });
      goalsByEmployee.set(eg.employeeId, list);
    }

    // Para funcionários com múltiplos goals de turno, determinar qual turno foi trabalhado em dateStr
    const workedShiftByEmployee: Record<string, string> = {};
    const multiShiftEmployeeIds = [...goalsByEmployee.entries()]
      .filter(([, list]) => list.length > 1 && list.some(e => e.eg.shiftId))
      .map(([uid]) => uid);

    if (multiShiftEmployeeIds.length > 0 && Array.isArray(period.shifts) && period.shifts.length > 0) {
      // Mapa de "HH:MM-HH:MM" → shiftId extraído dos labels do período
      const timeKeyToShiftId: Record<string, string> = {};
      for (const sh of period.shifts as Array<{ id: string; label: string }>) {
        const times = extractShiftTimes(sh.label ?? '');
        if (times) timeKeyToShiftId[`${times.start}-${times.end}`] = sh.id;
      }

      if (Object.keys(timeKeyToShiftId).length > 0) {
        const [yearStr, monthStr] = dateStr.split('-');
        try {
          const schedSnap = await db.collection('dp_schedules')
            .where('year', '==', Number(yearStr))
            .where('month', '==', Number(monthStr))
            .get();

          for (const schedDoc of schedSnap.docs) {
            for (let i = 0; i < multiShiftEmployeeIds.length; i += 30) {
              const chunk = multiShiftEmployeeIds.slice(i, i + 30);
              try {
                const shiftsSnap = await db.collection('dp_schedules').doc(schedDoc.id)
                  .collection('shifts')
                  .where('userId', 'in', chunk)
                  .get();
                for (const sd of shiftsSnap.docs) {
                  const s = sd.data() as Record<string, any>;
                  if (s.date !== dateStr || s.type !== 'work' || !s.startTime || !s.endTime || !s.userId) continue;
                  const tKey = `${s.startTime}-${s.endTime}`;
                  const shiftId = timeKeyToShiftId[tKey];
                  if (shiftId) workedShiftByEmployee[s.userId as string] = shiftId;
                }
              } catch (e) {
                console.warn(`[Goals Sync] Falha ao carregar shifts de ${schedDoc.id}`, e);
              }
            }
          }
        } catch (e) {
          console.warn('[Goals Sync] Falha ao carregar dp_schedules', e);
        }
      }

      // Log de funcionários sem dados de escala
      const semEscala = multiShiftEmployeeIds.filter(uid => !workedShiftByEmployee[uid]);
      if (semEscala.length > 0) {
        console.warn(`[Goals Sync] ${kioskId} ${dateStr}: ${semEscala.length} funcionário(s) com múltiplos turnos sem dados de escala — revenue será distribuído proporcionalmente entre os goals.`, semEscala);
      }
    }

    // Atualizar cada goal com o revenue correto
    for (const [employeeId, goals] of goalsByEmployee) {
      const empDailyRevenue = revenueByEmployeeId[employeeId] ?? 0;
      const isMultiShift = goals.length > 1 && goals.some(e => e.eg.shiftId);
      const workedShiftId = workedShiftByEmployee[employeeId] ?? null;
      const totalTargetValue = goals.reduce((sum, { eg }) => sum + (Number(eg.targetValue) || 0), 0);

      for (const { doc: egDoc, eg } of goals) {
        // Se funcionário tem múltiplos goals de turno e sabemos qual turno trabalhou,
        // atribui revenue apenas ao goal do turno correto; caso contrário, divide
        // proporcionalmente ao target para preservar o total sem duplicação.
        let revenueForGoal = empDailyRevenue;
        if (isMultiShift && eg.shiftId && workedShiftId !== null) {
          revenueForGoal = eg.shiftId === workedShiftId ? empDailyRevenue : 0;
        } else if (isMultiShift) {
          const goalTargetValue = Number(eg.targetValue) || 0;
          const fallbackShare = totalTargetValue > 0 ? (goalTargetValue / totalTargetValue) : (1 / goals.length);
          revenueForGoal = empDailyRevenue * fallbackShare;
        }

        const prevDayValue = (eg.dailyProgress ?? {})[dateStr] ?? 0;
        if (prevDayValue === revenueForGoal) continue;

        const updatedEgProgress = { ...(eg.dailyProgress ?? {}), [dateStr]: revenueForGoal };
        const newEgCurrentValue = (eg.currentValue ?? 0) - prevDayValue + revenueForGoal;

        await db.collection('employeeGoals').doc(egDoc.id).update({
          currentValue: newEgCurrentValue,
          dailyProgress: updatedEgProgress,
          updatedAt: new Date(),
        });
      }
    }

    console.log(`[Goals Sync] ${kioskId} ${dateStr}: período ${periodDoc.id} atualizado. Faturamento: R$ ${dailyRevenue.toFixed(2)}`);
  }
}
