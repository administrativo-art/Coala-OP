import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { dayKeysBetween, mobileGoalDays, mobileGoalPrize, mobileGoalSummary, mobileGoalTeam, type MobileGoalPeriodInput } from "../../src/features/goals/mobile-goals";
import { defaultAdminPermissions, defaultGuestPermissions, type EmployeeGoal, type GoalMethodSnapshot } from "../../src/types";

const method = {
  id: "m1", name: "Faixas", type: "tiered_unit_bonus", active: true, targetPeriod: "monthly", referenceRevenue: 0,
  tiers: [
    { id: "t1", label: "Meta", fromAmount: 60000, toAmount: 72000, fixedBonusAmount: 300, excessPercent: 2 },
    { id: "t2", label: "UP", fromAmount: 72000, toAmount: null, fixedBonusAmount: 500, excessPercent: 3 },
  ],
  teamBonus: { enabled: true, splitMode: "equal", eligibleCollaboratorRule: "all_goal_participants", prorateByAttendance: false,
    reliefWorker: { enabled: true, splitMode: "proportional_by_covered_shifts", turnsPerDay: 2, fixedCollaboratorRule: "remaining_equal_split" } },
  leadershipBonus: { enabled: true, factorNumerator: 1, factorDenominator: 2 },
  incentiveMessages: [],
} as unknown as GoalMethodSnapshot;

const period = (patch: Partial<MobileGoalPeriodInput> = {}): MobileGoalPeriodInput => ({
  id: "p1", type: "revenue", startKey: "2026-10-01", endKey: "2026-10-31", targetValue: 60000, upValue: 72000, topValue: 84000,
  currentValue: 18000, dailyProgress: { "2026-10-08": 2500, "2026-10-09": 1500 }, shiftCount: 2, method, ...patch,
});
const goal = (employeeId: string, patch: Partial<EmployeeGoal> = {}) => ({ id: `${employeeId}-g`, periodId: "p1", employeeId, kioskId: "unit-x", fraction: 0, targetValue: 20000, currentValue: 6000, ...patch }) as EmployeeGoal;

test("summary reproduces the web pace, projection and needed-per-day over calendar days", () => {
  const summary = mobileGoalSummary(period(), "2026-10-09");
  assert.equal(summary.totalDays, 31);
  assert.equal(summary.elapsedDays, 9);
  assert.equal(summary.remainingDays, 22);
  assert.equal(summary.percentOfTarget, 30);
  assert.equal(summary.projection, 62000);
  assert.deepEqual(summary.nextLevel, { label: "Meta", remaining: 42000 });
  assert.equal(summary.neededDaily, 1909.09);
  assert.deepEqual(summary.levels.map((level) => [level.label, level.amount, level.reached]), [["Meta", 60000, false], ["UP", 72000, false], ["TOP", 84000, false]]);
});

test("after the goal is reached the next level becomes the reference, and legacy goals have no TOP", () => {
  const reached = mobileGoalSummary(period({ currentValue: 65000 }), "2026-10-20");
  assert.deepEqual(reached.nextLevel, { label: "UP", remaining: 7000 });
  assert.equal(reached.levels[0]!.reached, true);
  const legacy = mobileGoalSummary(period({ topValue: undefined, upValue: undefined }), "2026-10-09");
  assert.deepEqual(legacy.levels.map((level) => level.label), ["Meta", "UP"]);
  assert.equal(legacy.levels[1]!.amount, 72000);
  assert.equal(mobileGoalSummary(period({ currentValue: 90000 }), "2026-10-31").nextLevel, null);
});

test("dates outside the period and non-cumulative goals do not produce a misleading pace", () => {
  const before = mobileGoalSummary(period({ currentValue: 0 }), "2026-09-28");
  assert.equal(before.elapsedDays, 0);
  assert.equal(before.projection, 0);
  const after = mobileGoalSummary(period(), "2026-11-05");
  assert.equal(after.elapsedDays, 31);
  assert.equal(after.neededDaily, null);
  const ticket = mobileGoalSummary(period({ type: "ticket", targetValue: 35, upValue: 40, topValue: undefined, currentValue: 32 }), "2026-10-09");
  assert.equal(ticket.cumulative, false);
  assert.equal(ticket.projection, null);
  assert.equal(ticket.neededDaily, null);
  assert.equal(dayKeysBetween("2026-02-27", "2026-03-01").join(), "2026-02-27,2026-02-28,2026-03-01");
});

test("days are listed newest first, only up to today, against the daily share of the goal", () => {
  const days = mobileGoalDays(period(), "2026-10-09");
  assert.equal(days.length, 9);
  assert.deepEqual(days.slice(0, 3), [
    { date: "2026-10-09", value: 1500, reachedDailyTarget: false },
    { date: "2026-10-08", value: 2500, reachedDailyTarget: true },
    { date: "2026-10-07", value: 0, reachedDailyTarget: false },
  ]);
  assert.equal(mobileGoalDays(period(), "2026-09-30").length, 0);
});

test("team has one row per person and the prize follows the tiered split", () => {
  const team = mobileGoalTeam([
    goal("ana", { scheduledTurnCount: 20 }), goal("ana", { id: "ana-2", currentValue: 1000, targetValue: 5000, scheduledTurnCount: 5 }),
    goal("bia"), goal("caio", { participantRole: "relief", scheduledTurnCount: 31 }), goal("lia", { participantRole: "leader" }),
  ]);
  assert.equal(team.length, 4);
  const ana = team.find((row) => row.employeeId === "ana")!;
  assert.deepEqual([ana.currentValue, ana.targetValue, ana.percent, ana.scheduledTurns, ana.role], [7000, 25000, 28, 25, "fixed"]);

  const prize = mobileGoalPrize(period({ currentValue: 66000 }), team)!;
  // Tier "Meta": R$ 300 fixed + 2% of the R$ 6.000 above 60.000 = R$ 420 for the team.
  assert.equal(prize.totalTeamBonus, 420);
  assert.equal(prize.leadershipBonus, 210);
  assert.equal(prize.highestTierLabel, "Meta");
  assert.deepEqual(prize.nextTier, { label: "UP", remaining: 6000 });
  // Relief covered 31 of 62 turns: half of the team prize; the two fixed split the rest.
  assert.equal(prize.byEmployee.caio, 210);
  assert.equal(prize.byEmployee.ana, 105);
  assert.equal(prize.byEmployee.bia, 105);
  assert.equal(prize.byEmployee.lia, 210);
  assert.equal(mobileGoalPrize(period({ currentValue: 10000 }), team)!.totalTeamBonus, 0);
  assert.equal(mobileGoalPrize(period({ method: null }), team), null);
  assert.equal(mobileGoalPrize(period({ method: { ...method, type: "manual" } as GoalMethodSnapshot }), team), null);
});

test("goals in the app need the app permission and stay inside the user's units", () => {
  assert.equal(defaultGuestPermissions.app.goals.view, false);
  assert.equal(defaultAdminPermissions.app.goals.view, true);
  const server = readFileSync("src/features/goals/mobile-goals.server.ts", "utf8");
  assert.match(server, /permissions\.app\?\.goals\?\.view !== true/);
  assert.match(server, /if \(!canAccessUnit\(actor\.userDoc, kioskId, \{ isDefaultAdmin: actor\.isDefaultAdmin \}\)\) failure\("UNIT_FORBIDDEN"/);
  assert.match(server, /where\("kioskId", "==", kioskId\)\.where\("status", "==", "active"\)/);
  // The payload identifies colleagues by name only; internal ids stay on the server.
  assert.doesNotMatch(server.slice(server.indexOf("team: team")), /employeeId: row\.employeeId/);
  const route = readFileSync("src/app/api/goals/mobile/route.ts", "utf8");
  assert.match(route, /action: "app\.goals\.view"/);
  assert.match(route, /export const GET = secureRoute/);
});
