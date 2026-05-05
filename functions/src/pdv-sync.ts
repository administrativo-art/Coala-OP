function getEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`[PDV Sync] Variável de ambiente ${name} não configurada.`);
  return val;
}

const BASE_URL = 'https://api.tabletcloud.com.br';

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
  if (!response.ok) throw new Error(`Auth failed`);
  const data = await response.json();
  return data.access_token;
}

async function fetchAllCouponsForDay(accessToken: string, date: string, filialId: string) {
  const COD_EMPRESA = getEnv('PDVLEGAL_COD_EMPRESA');
  const API_TOKEN = getEnv('PDVLEGAL_TOKEN');
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
  // Quantity per operator per product (simulationId)
  const productQtyByOperator: Record<string, Record<string, number>> = {};

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

  const reportId = `sync_${kioskId}_${dateStr.replace(/-/g, '_')}`;
  await db.collection('salesReports').doc(`sales_${reportId}`).set({
    reportName: `Sincronização Automática ${dateStr}`,
    month: date.getMonth() + 1, year: date.getFullYear(), day: date.getDate(), kioskId, createdAt: new Date().toISOString(),
    items: Object.values(productTotals), hourlySales, productHourlySales,
    combos: Object.entries(comboCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    productQtyByOperator,
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

      // Log de funcionários sem dados de escala (fallback: atualiza todos os goals)
      const semEscala = multiShiftEmployeeIds.filter(uid => !workedShiftByEmployee[uid]);
      if (semEscala.length > 0) {
        console.warn(`[Goals Sync] ${kioskId} ${dateStr}: ${semEscala.length} funcionário(s) com múltiplos turnos sem dados de escala — revenue será atribuído a todos os goals (possível duplicação).`, semEscala);
      }
    }

    // Atualizar cada goal com o revenue correto
    for (const [employeeId, goals] of goalsByEmployee) {
      const empDailyRevenue = revenueByEmployeeId[employeeId] ?? 0;
      const isMultiShift = goals.length > 1 && goals.some(e => e.eg.shiftId);
      const workedShiftId = workedShiftByEmployee[employeeId] ?? null;

      for (const { doc: egDoc, eg } of goals) {
        // Se funcionário tem múltiplos goals de turno e sabemos qual turno trabalhou:
        // atribui revenue apenas ao goal do turno correto; os demais ficam com 0.
        let revenueForGoal = empDailyRevenue;
        if (isMultiShift && eg.shiftId && workedShiftId !== null) {
          revenueForGoal = eg.shiftId === workedShiftId ? empDailyRevenue : 0;
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
