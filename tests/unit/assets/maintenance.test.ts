import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { maintenanceOrderPdfSchema, renderMaintenanceOrderPdf } from "../../../src/features/assets/maintenance-order-pdf";
import { maintenanceMaterializedPatch, maintenanceMaterializeOn, maintenancePlanInputSchema, nextMaintenanceDate, nextProvisionAttemptAt, occurrenceId, taskIdForOccurrence } from "../../../src/features/assets/maintenance-model";
import { SYSTEM_DOCUMENT_TEMPLATES } from "../../../src/features/hr/documents/system-template-catalog";

test("cadências calculam próxima data sem estourar fim do mês", () => {
  assert.equal(nextMaintenanceDate({ unit: "days", interval: 30 }, "2026-01-01"), "2026-01-31");
  assert.equal(nextMaintenanceDate({ unit: "months", interval: 1 }, "2026-01-31"), "2026-02-28");
  assert.equal(nextMaintenanceDate({ unit: "calendar", interval: 1, month: 2, day: 29 }, "2027-04-01"), "2028-02-29");
});

test("antecedência define a data exata de materialização", () => {
  assert.equal(maintenanceMaterializeOn("2026-11-10", 0), "2026-11-10");
  assert.equal(maintenanceMaterializeOn("2026-11-10", 7), "2026-11-03");
  assert.equal(maintenanceMaterializeOn("2026-01-03", 7), "2025-12-27");
});

test("mais de cem competências saem da fila após materialização sem colidir IDs", () => {
  const dueDate = "2026-11-10";
  const plans = Array.from({ length: 101 }, (_, index) => ({ id: `plan-${index}`, materializeOn: "2026-11-03" }));
  const occurrences = new Set(plans.map((plan) => occurrenceId("plan", `${plan.id}:${dueDate}`)));
  const processed = plans.slice(0, 100).map((plan) => ({ ...plan, ...maintenanceMaterializedPatch(dueDate, "2026-11-03T08:15:00.000Z") }));
  assert.equal(occurrences.size, 101);
  assert.equal(processed.filter((plan) => plan.materializeOn !== null).length, 0);
  assert.equal(plans[100]?.materializeOn, "2026-11-03");
});

test("backoff afasta falhas persistentes sem impedir itens seguintes", () => {
  const at = "2026-11-03T08:00:00.000Z";
  assert.equal(nextProvisionAttemptAt(at, 1), "2026-11-03T08:05:00.000Z");
  assert.equal(nextProvisionAttemptAt(at, 2), "2026-11-03T08:10:00.000Z");
  assert.equal(nextProvisionAttemptAt(at, 20), "2026-11-04T08:00:00.000Z");
  const queue = [{ id: "falha", next: nextProvisionAttemptAt(at, 5) }, { id: "nova", next: at }].sort((a, b) => a.next.localeCompare(b.next));
  assert.equal(queue[0]?.id, "nova");
});

test("plano exige calendário completo e ids são determinísticos", () => {
  const base = { idempotencyKey: "motor", name: "Motor", active: true, nextDueDate: "2026-11-01", leadDays: 7, assignee: { type: "user", id: "u1", nameSnapshot: "Pessoa" }, checklistSnapshot: [] };
  assert.equal(maintenancePlanInputSchema.safeParse({ ...base, cadence: { unit: "calendar", interval: 1 } }).success, false);
  assert.equal(occurrenceId("plan", "x"), occurrenceId("plan", "x"));
  assert.equal(taskIdForOccurrence("o"), taskIdForOccurrence("o"));
});

test("ordem tem allowlist, timbre, sem assinatura e PDF válido", async () => {
  const template = SYSTEM_DOCUMENT_TEMPLATES.find((item) => item.id === "system-asset-maintenance-order");
  assert.equal(template?.letterheadVersion, "coala-letterhead-v2");
  assert.equal(template?.signatureScope, "none");
  assert.equal(template?.generationMode, "contextual");
  const input = { protocol: "CS-MNT-2026-000001", issuedAt: "2026-10-30T12:00:00.000-03:00", type: "preventive" as const, asset: { code: "PAT-1", name: "Equipamento" }, description: "Revisar", checklist: ["Limpar"], components: ["Carregador"] };
  assert.equal(maintenanceOrderPdfSchema.safeParse({ ...input, imei: "x" }).success, false);
  assert.equal((await renderMaintenanceOrderPdf(input)).subarray(0, 4).toString(), "%PDF");
});

test("rotas são seguras, job limitado e tarefa não conclui ocorrência", () => {
  for (const path of ["src/app/api/assets/[assetId]/audits/route.ts", "src/app/api/assets/[assetId]/audits/upload/route.ts", "src/app/api/assets/[assetId]/maintenance-plans/route.ts", "src/app/api/assets/[assetId]/maintenance-occurrences/route.ts", "src/app/api/assets/[assetId]/maintenance-occurrences/[occurrenceId]/route.ts", "src/app/api/jobs/assets/maintenance-materialize/route.ts"]) assert.match(readFileSync(path, "utf8"), /secureRoute/);
  const service = readFileSync("src/features/assets/maintenance.server.ts", "utf8");
  assert.match(service, /\.where\("materializeOn", "<=", today\)/);
  assert.match(service, /\.limit\(100\)/);
  assert.match(service, /maintenanceMaterializedPatch\(dueDate,at\)/);
  assert.match(service, /remainingPossible:plans\.size===100/);
  assert.match(service, /reconcileMaintenanceArtifacts/);
  assert.match(service, /type:"preventive"/); // occurrence creation remains explicitly preventive
  assert.doesNotMatch(service, /where\("type", "==", "preventive"\).*provisioningStatus/);
  assert.match(service, /provisioningStatus: "ready"/);
  assert.match(service, /provisioningStatus:"pending"/);
  assert.match(service, /nextProvisionAttemptAt/);
  assert.match(service, /if\(!occurrence\.exists\)\{skipped\+\+;continue;\}/);
  assert.match(service, /existingCorrective.*provisionMaintenanceArtifacts/);
  assert.match(service, /type: "corrective".*provisioningStatus: "pending"/);
  assert.match(service, /type:"manual".*provisioningStatus:"pending"/);
  assert.match(service, /externalAssignee/);
  assert.match(service, /assigneeId: external \? context\.userDoc\.id/);
  assert.match(service, /taskIdForOccurrence/);
  assert.match(service, /status:"completed"/);
  assert.doesNotMatch(service, /task.*completed.*occurrence|occurrence.*task.*completed/i);
  assert.match(service, /nextMaintenanceDate/);
  assert.match(service, /MANUTENCAO_DESATIVADA/);
  const scheduler = readFileSync("functions/src/asset-maintenance-jobs.ts", "utf8");
  assert.match(scheduler, /onSchedule/);
  assert.match(scheduler, /ASSET_MAINTENANCE_JOB_SECRET/);
});
