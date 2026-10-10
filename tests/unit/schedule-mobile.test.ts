import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseSchedulePeriod, safeAvatarUrl, toMobileSchedule } from "../../src/features/collaborator-schedule/mobile-schedule";
import { goalDistributionDays, mobileGoalDays, mobileGoalSummary, type MobileGoalPeriodInput } from "../../src/features/goals/mobile-goals";
import { defaultAdminPermissions, defaultGuestPermissions } from "../../src/types";

const shift = (userId: string, date: string, patch: Record<string, unknown> = {}) => ({
  date, startTime: "08:00", endTime: "14:00", type: "work" as const, shiftName: "Manhã",
  userId, employeeName: userId === "u-ana" ? "Ana" : userId === "u-bia" ? "Bia" : "Caio", employeeRole: "Atendente", isCurrentUser: userId === "u-bia", ...patch,
});

test("the app schedule lists each person once, the viewer first, and never exposes internal ids", () => {
  const view = toMobileSchedule({
    year: 2026, month: 10, published: true,
    teamUnits: [{ id: "unit-x", name: "Unidade X", shifts: [shift("u-ana", "2026-10-09"), shift("u-bia", "2026-10-09", { startTime: "14:00", endTime: "20:00" }), shift("u-ana", "2026-10-10", { type: "day_off", shiftName: "Folga" })] }],
  }, new Map([["u-ana", "https://cdn.example/ana.jpg"], ["u-bia", null]]));
  const unit = view.units[0]!;
  assert.deepEqual(unit.people.map((person) => [person.name, person.isMe, person.avatarUrl]), [["Bia", true, null], ["Ana", false, "https://cdn.example/ana.jpg"]]);
  assert.deepEqual(unit.shifts.map((entry) => [unit.people[entry.person]!.name, entry.date, entry.type]), [["Ana", "2026-10-09", "work"], ["Bia", "2026-10-09", "work"], ["Ana", "2026-10-10", "day_off"]]);
  assert.equal(JSON.stringify(view).includes("u-ana"), false);
});

test("only https photo links leave the server", () => {
  assert.equal(safeAvatarUrl("https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg?alt=media"), "https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg?alt=media");
  for (const value of ["http://insecure/a.jpg", "javascript:alert(1)", "data:image/png;base64,AAAA", "", null, 42, "https://a b"]) assert.equal(safeAvatarUrl(value), null);
});

test("schedule period follows the web bounds", () => {
  assert.deepEqual(parseSchedulePeriod(null, null, "2026-10-09"), { year: 2026, month: 10 });
  assert.deepEqual(parseSchedulePeriod("2027", "1", "2026-10-09"), { year: 2027, month: 1 });
  for (const [year, month] of [["2019", "5"], ["2029", "5"], ["2026", "13"], ["2026", "0"], ["abc", "5"], ["2026", "1.5"]]) assert.equal(parseSchedulePeriod(year!, month!, "2026-10-09"), null);
});

const period = (patch: Partial<MobileGoalPeriodInput> = {}): MobileGoalPeriodInput => ({
  id: "p1", type: "revenue", startKey: "2026-10-01", endKey: "2026-10-31", targetValue: 54000, currentValue: 12000,
  dailyProgress: { "2026-10-04": 500, "2026-10-05": 2500 }, shiftCount: 2, method: null, ...patch,
});

test("a goal distributed by scheduled days uses the schedule's days, as the web panel does", () => {
  // 27 scheduled days: every day of October except the four Sundays.
  const scheduled = Array.from({ length: 31 }, (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`).filter((key) => new Date(`${key}T12:00:00Z`).getUTCDay() !== 0);
  assert.equal(scheduled.length, 27);
  const summary = mobileGoalSummary(period({ activeDays: scheduled }), "2026-10-09");
  assert.equal(summary.totalDays, 27);
  assert.equal(summary.elapsedDays, 8);
  assert.equal(summary.dailyTarget, 2000);
  assert.equal(summary.projection, 40500);
  assert.equal(summary.neededDaily, 2210.53);
  const calendar = mobileGoalSummary(period(), "2026-10-09");
  assert.equal(calendar.totalDays, 31);
  assert.equal(calendar.dailyTarget, 1741.94);
  // The Sunday outside the distribution is listed with its revenue but is not judged against a daily target.
  const days = mobileGoalDays(period({ activeDays: scheduled }), "2026-10-05");
  assert.deepEqual(days.slice(0, 2), [{ date: "2026-10-05", value: 2500, reachedDailyTarget: true }, { date: "2026-10-04", value: 500, reachedDailyTarget: null }]);
});

test("an empty or out-of-range schedule falls back to calendar days, the web fallback", () => {
  assert.equal(goalDistributionDays(period({ activeDays: [] })).length, 31);
  assert.equal(goalDistributionDays(period({ activeDays: ["2026-09-30", "2026-11-01"] })).length, 31);
  assert.deepEqual(goalDistributionDays(period({ activeDays: ["2026-10-03", "2026-10-02", "2026-10-03"] })), ["2026-10-02", "2026-10-03"]);
});

test("schedule and profile reuse the web rules and need the app permission", () => {
  assert.equal(defaultGuestPermissions.app.schedule.view, false);
  assert.equal(defaultAdminPermissions.app.schedule.view, true);
  const server = readFileSync("src/features/collaborator-schedule/mobile-schedule.server.ts", "utf8");
  assert.match(server, /permissions\.app\?\.schedule\?\.view !== true/);
  assert.match(server, /buildCollaboratorSchedulePayload\(actor, year, month\)/);
  assert.match(readFileSync("src/features/goals/mobile-goals.server.ts", "utf8"), /period\.distributionMode !== "scheduled_days" \? null/);
  assert.match(readFileSync("src/app/api/dp/mobile-schedule/route.ts", "utf8"), /action: "app\.schedule\.view"/);
  const profile = readFileSync("src/app/api/mobile/profile/route.ts", "utf8");
  assert.match(profile, /authorization: \{ kind: "owner" \}/);
  assert.match(profile, /mobileProfile\(security\.actor\)/);
});

test("a person can only replace their own photo, with an image checked by content and the web size limit", () => {
  const route = readFileSync("src/app/api/mobile/profile/photo/route.ts", "utf8");
  assert.match(route, /authorization: \{ kind: "owner" \}/);
  assert.match(route, /fields\.length !== 1 \|\| fields\[0\] !== "photo"/);
  assert.match(route, /file\.size > MOBILE_PROFILE_PHOTO_MAX_BYTES/);
  assert.match(route, /detectMobileInboxFile\(buffer\)/);
  assert.match(route, /detected\.contentType === "application\/pdf"/);
  const server = readFileSync("src/features/collaborator-schedule/mobile-profile-photo.server.ts", "utf8");
  assert.match(server, /MOBILE_PROFILE_PHOTO_MAX_BYTES = 5 \* 1024 \* 1024/);
  // Path and user document come from the session; the request carries no target id.
  assert.match(server, /const userId = actor\.userDoc\.id;/);
  assert.match(server, /const path = `avatars\/\$\{userId\}`;/);
  assert.match(server, /collection\("users"\)\.doc\(userId\)\.set\(\{ avatarUrl,/);
});
