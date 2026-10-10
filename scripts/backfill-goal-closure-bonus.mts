/**
 * Grava `closureSnapshot.bonus` (premiação apurada) nos períodos de meta já encerrados
 * que usam o método por faixas e ainda não têm a apuração gravada.
 * Só acrescenta o campo `closureSnapshot.bonus`; não altera mais nada do período.
 *
 * Uso (ensaio, não grava):
 *   node --import tsx scripts/backfill-goal-closure-bonus.mts
 *   node --import tsx scripts/backfill-goal-closure-bonus.mts --months=2026-08,2026-09
 * Gravação (faz cópia de segurança antes):
 *   node --import tsx scripts/backfill-goal-closure-bonus.mts --months=2026-08,2026-09 --execute
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import { config } from "dotenv";
import { buildGoalClosureBonusSnapshot } from "../src/lib/goal-bonus-snapshot";
import type { EmployeeGoal, GoalPeriodDoc } from "../src/types";

config({ path: ".env.local" });
const { dbAdmin } = await import("../src/lib/firebase-admin");

const execute = process.argv.includes("--execute");
const monthsArgument = process.argv.find((argument) => argument.startsWith("--months="));
const months = monthsArgument ? new Set(monthsArgument.split("=")[1]!.split(",").filter(Boolean)) : null;

function monthKey(timestamp: Timestamp | undefined) {
  const date = timestamp?.toDate();
  if (!date) return "";
  // Períodos começam à meia-noite local (UTC-3): desloca para ler o mês correto.
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}

function calendarDayCount(period: GoalPeriodDoc) {
  const start = period.startDate?.toDate().getTime() ?? 0;
  const end = period.endDate?.toDate().getTime() ?? 0;
  return Math.max(Math.ceil((end - start) / 86_400_000), 1);
}

const periodsSnapshot = await dbAdmin.collection("goalPeriods").where("status", "==", "closed").get();
const candidates = periodsSnapshot.docs
  .map((doc) => ({ id: doc.id, ...doc.data() }) as GoalPeriodDoc)
  .filter((period) => period.goalMethodSnapshot?.type === "tiered_unit_bonus" && !period.closureSnapshot?.bonus)
  .filter((period) => !months || months.has(monthKey(period.startDate)));

const backup: Record<string, unknown> = {};
const updates: Array<{ id: string; bonus: NonNullable<ReturnType<typeof buildGoalClosureBonusSnapshot>> }> = [];

for (const period of candidates) {
  const goalsSnapshot = await dbAdmin.collection("employeeGoals").where("periodId", "==", period.id).get();
  const employeeGoals = goalsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as EmployeeGoal);
  const bonus = buildGoalClosureBonusSnapshot({
    period,
    employeeGoals,
    periodDayCount: period.closureSnapshot?.periodDayCount ?? calendarDayCount(period),
    source: "backfill",
  });
  if (!bonus) continue;
  backup[period.id] = { previousClosureSnapshotBonus: null };
  updates.push({ id: period.id, bonus });
  console.log(
    `${monthKey(period.startDate)} ${period.kioskId} (${period.id}): realizado R$ ${bonus.revenue} -> ${bonus.highestTierLabel ?? "abaixo do alvo"} | equipe R$ ${bonus.totalTeamBonus} + liderança R$ ${bonus.leadershipBonus} = R$ ${bonus.totalPrize}`
  );
  for (const item of bonus.participants) console.log(`    ${item.employeeId} (${item.role}, ${item.scheduledTurns} turnos): R$ ${item.bonusAmount}`);
}

console.log(`\n${updates.length} período(s) a gravar. ${execute ? "Gravando..." : "Ensaio: nada foi gravado (use --execute)."}`);

if (execute && updates.length > 0) {
  const archiveDir = path.join(homedir(), "Coala Sistemas", ".ai-work-archive", "development-technology", `goal-closure-bonus-${Date.now()}`);
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(path.join(archiveDir, "backup.json"), JSON.stringify(backup, null, 2));
  writeFileSync(path.join(archiveDir, "applied.json"), JSON.stringify(updates, null, 2));
  for (const { id, bonus } of updates) {
    await dbAdmin.collection("goalPeriods").doc(id).update({
      "closureSnapshot.bonus": { ...bonus, capturedAt: Timestamp.now() },
    });
  }
  console.log(`Gravado. Registro em ${archiveDir}`);
}
