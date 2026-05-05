import { readFileSync, existsSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const DEFAULT_PROJECT_ID = "smart-converter-752gf";
const DEFAULT_DATABASE_ID = "coala";
const BASE_URL = "https://api.tabletcloud.com.br";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[reprocess-goals-pdv] Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getCredentialFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) return cert(JSON.parse(raw));

  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (filePath && existsSync(filePath)) {
    return cert(JSON.parse(readFileSync(filePath, "utf8")));
  }

  return applicationDefault();
}

function getAdminApp() {
  const existing = getApps().find((app) => app.name === "goals-reprocess");
  if (existing) return existing;

  return initializeApp(
    {
      credential: getCredentialFromEnv(),
      projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    },
    "goals-reprocess"
  );
}

function parseDateInput(value, label) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`[reprocess-goals-pdv] ${label} inválida. Use YYYY-MM-DD.`);
  }
  return new Date(`${value}T12:00:00Z`);
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function* eachDate(start, end) {
  const current = new Date(start.getTime());
  while (current <= end) {
    yield toDateKey(current);
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

function extractShiftTimes(label) {
  const match = String(label ?? "").match(/\((\d{2}:\d{2})[–\-](\d{2}:\d{2})\)/u);
  return match ? { start: match[1], end: match[2] } : null;
}

function extractPdvTime(dateStr) {
  if (!dateStr) return "00:00";
  const match = String(dateStr).trim().match(/[T ](\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return "00:00";
  return parsed.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

async function getAccessToken() {
  const codEmpresa = requireEnv("PDVLEGAL_COD_EMPRESA");
  const apiToken = requireEnv("PDVLEGAL_TOKEN");
  const username = requireEnv("PDVLEGAL_USERNAME");
  const password = requireEnv("PDVLEGAL_PASSWORD");

  const params = new URLSearchParams();
  params.append("grant_type", "password");
  params.append("username", username);
  params.append("password", password);

  const authString = Buffer.from(`${codEmpresa}:${apiToken}`).toString("base64");
  const response = await fetch(`${BASE_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${authString}`,
      Token: apiToken,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`[reprocess-goals-pdv] Auth PDV falhou: HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function fetchAllCouponsForDay(accessToken, dateStr, filialId) {
  const codEmpresa = requireEnv("PDVLEGAL_COD_EMPRESA");
  const apiToken = requireEnv("PDVLEGAL_TOKEN");
  const response = await fetch(`${BASE_URL}/cupom/get/${dateStr}/${dateStr}/${filialId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      CodEmpresa: codEmpresa,
      Token: apiToken,
    },
  });

  if (!response.ok) {
    throw new Error(`[reprocess-goals-pdv] Fetch cupons falhou ${dateStr}/${filialId}: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function buildRevenueByOperator(coupons) {
  let dailyRevenue = 0;
  const revenueByOperator = {};

  for (const coupon of coupons) {
    const rawItems = coupon.Itens || coupon.itens;
    if (!Array.isArray(rawItems) || rawItems.length === 0) continue;

    const isCouponCancelled = coupon.iscancelado || coupon.status === "CANCELADO";
    const hasAnyCancelledItem = rawItems.some((item) => item.iscancelado === true);
    if (isCouponCancelled && !hasAnyCancelledItem) continue;

    const couponOperatorId = coupon.usuariorecebimento_id ?? null;

    for (const item of rawItems) {
      if (item.iscancelado) continue;
      const revenue = Number(item.valortotal || 0);
      dailyRevenue += revenue;

      const operatorId = item.usuariooperador_id ?? couponOperatorId;
      if (operatorId != null) {
        const opKey = String(operatorId);
        revenueByOperator[opKey] = (revenueByOperator[opKey] || 0) + revenue;
      }
    }
  }

  return { dailyRevenue, revenueByOperator };
}

async function syncGoalsForDay({ db, kioskId, dateStr, dailyRevenue, revenueByOperator, dryRun }) {
  const periodsSnap = await db.collection("goalPeriods")
    .where("kioskId", "==", kioskId)
    .where("status", "==", "active")
    .get();

  if (periodsSnap.empty) {
    return { updatedPeriods: 0, updatedEmployeeGoals: 0 };
  }

  const usersSnap = await db.collection("users")
    .where("assignedKioskIds", "array-contains", kioskId)
    .get();

  const operatorIdToUserId = {};
  for (const userDoc of usersSnap.docs) {
    const operatorId = userDoc.data().pdvOperatorIds?.[kioskId];
    if (operatorId != null) {
      operatorIdToUserId[String(operatorId)] = userDoc.id;
    }
  }

  const syncDate = new Date(`${dateStr}T12:00:00Z`);
  let updatedPeriods = 0;
  let updatedEmployeeGoals = 0;

  for (const periodDoc of periodsSnap.docs) {
    const period = periodDoc.data();
    const templateType = period.templateType ?? "revenue";
    if (templateType !== "revenue") continue;

    const periodStart = period.startDate?.toDate?.() ?? new Date(0);
    const periodEnd = period.endDate?.toDate?.() ?? new Date(8640000000000000);
    if (syncDate < periodStart || syncDate > periodEnd) continue;

    const updatedPeriodProgress = { ...(period.dailyProgress ?? {}), [dateStr]: dailyRevenue };
    const newPeriodCurrentValue = Object.values(updatedPeriodProgress).reduce((sum, value) => sum + Number(value || 0), 0);

    if (!dryRun) {
      await db.collection("goalPeriods").doc(periodDoc.id).update({
        dailyProgress: updatedPeriodProgress,
        currentValue: newPeriodCurrentValue,
        updatedAt: new Date(),
      });
    }
    updatedPeriods += 1;

    const empGoalsSnap = await db.collection("employeeGoals")
      .where("periodId", "==", periodDoc.id)
      .get();

    const revenueByEmployeeId = {};
    for (const [operatorId, userId] of Object.entries(operatorIdToUserId)) {
      revenueByEmployeeId[userId] = revenueByOperator[operatorId] ?? 0;
    }

    const goalsByEmployee = new Map();
    for (const goalDoc of empGoalsSnap.docs) {
      const goal = goalDoc.data();
      if (!Object.prototype.hasOwnProperty.call(revenueByEmployeeId, goal.employeeId)) continue;
      const bucket = goalsByEmployee.get(goal.employeeId) ?? [];
      bucket.push({ doc: goalDoc, goal });
      goalsByEmployee.set(goal.employeeId, bucket);
    }

    const workedShiftByEmployee = {};
    const multiShiftEmployeeIds = [...goalsByEmployee.entries()]
      .filter(([, goals]) => goals.length > 1 && goals.some((entry) => entry.goal.shiftId))
      .map(([employeeId]) => employeeId);

    if (multiShiftEmployeeIds.length > 0 && Array.isArray(period.shifts) && period.shifts.length > 0) {
      const timeKeyToShiftId = {};
      for (const shift of period.shifts) {
        const times = extractShiftTimes(shift.label ?? "");
        if (times) timeKeyToShiftId[`${times.start}-${times.end}`] = shift.id;
      }

      if (Object.keys(timeKeyToShiftId).length > 0) {
        const [yearStr, monthStr] = dateStr.split("-");
        const schedulesSnap = await db.collection("dp_schedules")
          .where("year", "==", Number(yearStr))
          .where("month", "==", Number(monthStr))
          .get();

        for (const scheduleDoc of schedulesSnap.docs) {
          for (let index = 0; index < multiShiftEmployeeIds.length; index += 30) {
            const chunk = multiShiftEmployeeIds.slice(index, index + 30);
            const shiftsSnap = await db.collection("dp_schedules").doc(scheduleDoc.id)
              .collection("shifts")
              .where("userId", "in", chunk)
              .get();

            for (const shiftDoc of shiftsSnap.docs) {
              const shift = shiftDoc.data();
              if (shift.date !== dateStr || shift.type !== "work" || !shift.startTime || !shift.endTime || !shift.userId) continue;
              const resolvedShiftId = timeKeyToShiftId[`${shift.startTime}-${shift.endTime}`];
              if (resolvedShiftId) workedShiftByEmployee[shift.userId] = resolvedShiftId;
            }
          }
        }
      }
    }

    for (const [employeeId, goals] of goalsByEmployee.entries()) {
      const employeeDailyRevenue = revenueByEmployeeId[employeeId] ?? 0;
      const isMultiShift = goals.length > 1 && goals.some((entry) => entry.goal.shiftId);
      const workedShiftId = workedShiftByEmployee[employeeId] ?? null;
      const totalTargetValue = goals.reduce((sum, entry) => sum + (Number(entry.goal.targetValue) || 0), 0);

      for (const { doc: goalDoc, goal } of goals) {
        let revenueForGoal = employeeDailyRevenue;
        if (isMultiShift && goal.shiftId && workedShiftId !== null) {
          revenueForGoal = goal.shiftId === workedShiftId ? employeeDailyRevenue : 0;
        } else if (isMultiShift) {
          const goalTargetValue = Number(goal.targetValue) || 0;
          const fallbackShare = totalTargetValue > 0 ? (goalTargetValue / totalTargetValue) : (1 / goals.length);
          revenueForGoal = employeeDailyRevenue * fallbackShare;
        }

        const previousDayValue = (goal.dailyProgress ?? {})[dateStr] ?? 0;
        const updatedGoalProgress = { ...(goal.dailyProgress ?? {}), [dateStr]: revenueForGoal };
        const newGoalCurrentValue = (Number(goal.currentValue) || 0) - previousDayValue + revenueForGoal;

        if (!dryRun) {
          await db.collection("employeeGoals").doc(goalDoc.id).update({
            dailyProgress: updatedGoalProgress,
            currentValue: newGoalCurrentValue,
            updatedAt: new Date(),
          });
        }
        updatedEmployeeGoals += 1;
      }
    }
  }

  return { updatedPeriods, updatedEmployeeGoals };
}

async function resolveTargetKiosks(db, kioskIdArg) {
  const kiosksSnap = kioskIdArg
    ? await db.collection("kiosks").where("__name__", "==", kioskIdArg).get()
    : await db.collection("kiosks").get();

  const kiosks = kiosksSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const filtered = kioskIdArg ? kiosks : kiosks.filter((kiosk) => kiosk.pdvFilialId);

  if (filtered.length === 0) {
    throw new Error("[reprocess-goals-pdv] Nenhum quiosque elegível encontrado.");
  }

  return filtered.map((kiosk) => {
    if (!kiosk.pdvFilialId) {
      throw new Error(`[reprocess-goals-pdv] Quiosque ${kiosk.id} sem pdvFilialId configurado.`);
    }
    return kiosk;
  });
}

async function main() {
  const startDateArg = getArg("start");
  const endDateArg = getArg("end");
  const kioskIdArg = getArg("kiosk");
  const write = hasFlag("write");
  const dryRun = !write;

  if (!startDateArg || !endDateArg) {
    throw new Error("[reprocess-goals-pdv] Informe --start=YYYY-MM-DD e --end=YYYY-MM-DD.");
  }

  const startDate = parseDateInput(startDateArg, "start");
  const endDate = parseDateInput(endDateArg, "end");
  if (startDate > endDate) {
    throw new Error("[reprocess-goals-pdv] start não pode ser maior que end.");
  }

  const app = getAdminApp();
  const db = getFirestore(app, process.env.FIRESTORE_DATABASE || DEFAULT_DATABASE_ID);
  const accessToken = await getAccessToken();
  const kiosks = await resolveTargetKiosks(db, kioskIdArg);

  console.log("[reprocess-goals-pdv] configuração");
  console.log(`  database : ${process.env.FIRESTORE_DATABASE || DEFAULT_DATABASE_ID}`);
  console.log(`  start    : ${startDateArg}`);
  console.log(`  end      : ${endDateArg}`);
  console.log(`  kiosk    : ${kioskIdArg || "all"}`);
  console.log(`  mode     : ${dryRun ? "dry-run" : "write"}`);
  console.log(`  count    : ${kiosks.length} quiosque(s)`);

  for (const kiosk of kiosks) {
    console.log(`\n[kiosk] ${kiosk.id} · ${kiosk.name} · filial ${kiosk.pdvFilialId}`);

    for (const dateStr of eachDate(startDate, endDate)) {
      const coupons = await fetchAllCouponsForDay(accessToken, dateStr, kiosk.pdvFilialId);
      const { dailyRevenue, revenueByOperator } = buildRevenueByOperator(coupons);
      const summary = await syncGoalsForDay({
        db,
        kioskId: kiosk.id,
        dateStr,
        dailyRevenue,
        revenueByOperator,
        dryRun,
      });

      console.log(
        `  ${dateStr} | cupons=${coupons.length} | faturamento=R$ ${dailyRevenue.toFixed(2)} | periods=${summary.updatedPeriods} | employeeGoals=${summary.updatedEmployeeGoals}`
      );
    }
  }

  console.log(`\n[reprocess-goals-pdv] concluído (${dryRun ? "dry-run" : "write"}).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
