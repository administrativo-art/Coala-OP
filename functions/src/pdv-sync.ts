const COD_EMPRESA = process.env.PDVLEGAL_COD_EMPRESA || '14449';
const API_TOKEN = process.env.PDVLEGAL_TOKEN || 'NMCB-2700-8660-1072';
const USERNAME = process.env.PDVLEGAL_USERNAME || 'central@tabletcloud.com.br';
const PASSWORD = process.env.PDVLEGAL_PASSWORD || 'dtat-2123-5110-5504@1707212';
const BASE_URL = 'https://api.tabletcloud.com.br';

function extractBrazilHour(dateStr: string): string {
  if (!dateStr) return '00';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '00';
  const brt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return brt.getHours().toString().padStart(2, '0');
}

export async function getAccessToken() {
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
  if (!response.ok) throw new Error(`Auth failed`);
  const data = await response.json();
  return data.access_token;
}

async function fetchAllCouponsForDay(accessToken: string, date: string, filialId: string) {
  const response = await fetch(`${BASE_URL}/cupom/get/${date}/${date}/${filialId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'CodEmpresa': COD_EMPRESA, 'Token': API_TOKEN },
  });
  if (!response.ok) {
    console.error(`[PDV Sync] fetchCoupons ${date} filial ${filialId}: HTTP ${response.status}`);
    return [];
  }
  const data = await response.json();
  // A API pode retornar array direto, paginado { data, links } ou objeto vazio
  let coupons: any[];
  if (Array.isArray(data)) {
    coupons = data;
  } else if (data && Array.isArray(data.data)) {
    coupons = data.data; // paginado — inclui mesmo quando links é null
  } else {
    console.warn(`[PDV Sync] Formato inesperado da resposta para ${date}:`, JSON.stringify(data).slice(0, 200));
    coupons = [];
  }
  console.log(`[PDV Sync] ${date} filial ${filialId}: ${coupons.length} cupons recebidos`);
  return coupons;
}

export async function syncDayAdmin(dateStr: string, kioskId: string, pdvFilialId: string, db: FirebaseFirestore.Firestore) {
  const token = await getAccessToken();
  const coupons = await fetchAllCouponsForDay(token, dateStr, pdvFilialId);
  if (!coupons || coupons.length === 0) {
    console.log(`[PDV Sync] ${dateStr} ${kioskId}: sem cupons, pulando.`);
    return { success: true, count: 0 };
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

  for (const coupon of coupons) {
    const rawItems = coupon.Itens || coupon.itens;
    if (!rawItems || !Array.isArray(rawItems)) continue;
    const isCupomCancelado = coupon.iscancelado || coupon.status === 'CANCELADO';
    const hasAnyItemExplicitlyCancelled = rawItems.some((item: any) => item.iscancelado === true);
    if (isCupomCancelado && !hasAnyItemExplicitlyCancelled) continue;
    const couponTime = coupon.dtrecebimento || coupon.dtabertura || rawItems.find((i: any) => i.dtmovimento)?.dtmovimento || '';
    const hour = extractBrazilHour(couponTime);
    hourlySales[hour] = (hourlySales[hour] || 0) + 1;
    const validMappedItemsForCombo: { name: string, qty: number }[] = [];

    // Operador do cupom (quem recebeu o pagamento)
    const couponOperatorId = coupon.usuariorecebimento_id ?? null;

    for (const item of rawItems) {
      if (item.iscancelado) continue;
      const possibleSkus = [item.codigoVenda, item.codproduto, item.codProdutoExterno, item.CodRef, item.Codigo].filter(Boolean).map(c => c.toString().trim());
      const qty = item.quantidade || item.Quantidade || 0;
      // valortotal já é o total do item (qty × preço − desconto + acréscimo)
      const revenue = item.valortotal || 0;

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
      if (!sim) continue;
      const sku = sim.ppo?.sku?.toString().trim() || possibleSkus[0];
      const existingComboItem = validMappedItemsForCombo.find(i => i.name === sim.name);
      if (existingComboItem) existingComboItem.qty += qty;
      else validMappedItemsForCombo.push({ name: sim.name, qty });

      const itTime = item.dtmovimento || coupon.dtabertura || coupon.dtrecebimento;
      const itemTimestamp = itTime ? new Date(itTime).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : `${hour}:00`;
      if (!productTotals[sim.id]) {
        productTotals[sim.id] = { sku, productName: sim.name, quantity: 0, simulationId: sim.id, timestamp: itemTimestamp, unitPrice: item.valortotal || 0 };
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

  const reportId = `sync_${kioskId}_${dateStr.replace(/-/g, '_')}`;
  await db.collection('salesReports').doc(`sales_${reportId}`).set({
    reportName: `Sincronização Automática ${dateStr}`,
    month: date.getMonth() + 1, year: date.getFullYear(), day: date.getDate(), kioskId, createdAt: new Date().toISOString(),
    items: Object.values(productTotals), hourlySales, productHourlySales,
    combos: Object.entries(comboCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  });

  // ── Update active goal periods ────────────────────────────────────────────

  console.log(`[PDV Sync] ${dateStr} ${kioskId}: faturamento total = R$ ${dailyRevenue.toFixed(2)}, operadores = ${Object.keys(revenueByOperator).length}`);

  await syncGoalsForDay(dateStr, kioskId, dailyRevenue, revenueByOperator, db);

  return { success: true, count: coupons.length, dailyRevenue };
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

    for (const egDoc of empGoalsSnap.docs) {
      const eg = egDoc.data();
      const opId = Object.entries(operatorIdToUserId)
        .find(([, uid]) => uid === eg.employeeId)?.[0];
      if (!opId) continue;

      const empDailyRevenue = revenueByOperator[opId] ?? 0;

      // Accumulate: add today's revenue to existing currentValue minus any previous value for this date
      const prevDayValue = (eg.dailyProgress ?? {})[dateStr] ?? 0;
      const updatedEgProgress = { ...(eg.dailyProgress ?? {}), [dateStr]: empDailyRevenue };
      const newEgCurrentValue = (eg.currentValue ?? 0) - prevDayValue + empDailyRevenue;

      await db.collection('employeeGoals').doc(egDoc.id).update({
        currentValue: newEgCurrentValue,
        dailyProgress: updatedEgProgress,
        updatedAt: new Date(),
      });
    }

    console.log(`[Goals Sync] ${kioskId} ${dateStr}: período ${periodDoc.id} atualizado. Faturamento: R$ ${dailyRevenue.toFixed(2)}`);
  }
}