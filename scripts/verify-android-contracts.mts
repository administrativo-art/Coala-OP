import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confirmLocalPurchaseSchema, linkLocalPurchaseWithdrawalSchema } from "../src/features/purchasing/local-purchase";
import { receiveMobileRepositionSchema } from "../src/features/reposition/mobile-receipt";
import { cancelMobileCountSchema, saveMobileCountSchema, startMobileCountSchema } from "../src/features/stock-count/mobile-count";
import { signageMobileScreenSchema } from "../src/lib/signage";
import { repPMarkingSchema, repPOfflinePermitSchema } from "../src/features/dp/rep-p/schemas";
import { createAdjustmentSchema } from "../src/features/dp/time-adjustments/schemas";
import { absenceRequestPreviewRouteSchema } from "../src/features/dp/absences/requests/schemas";
import { absenceActionSchema, createAbsenceDraftSchema } from "../src/features/dp/absences/requests/workflow-schemas";
import { transportVoucherRequestCreateSchema } from "../src/features/hr/requests/schemas";

const fixtures = JSON.parse(readFileSync("apps/coala-one-android/app/build/contract-fixtures.json", "utf8")) as Record<string, unknown>;
const schemas = { purchase: confirmLocalPurchaseSchema, link: linkLocalPurchaseWithdrawalSchema, receive: receiveMobileRepositionSchema, count: saveMobileCountSchema, cancel: cancelMobileCountSchema, start: startMobileCountSchema, pair: signageMobileScreenSchema,
  marking: repPMarkingSchema, offlinePermit: repPOfflinePermitSchema,
  adjustmentInclude: createAdjustmentSchema, adjustmentDiscard: createAdjustmentSchema, adjustmentCorrect: createAdjustmentSchema,
  absencePreview: absenceRequestPreviewRouteSchema, absenceDraft: createAbsenceDraftSchema, absenceDraftWithFiles: createAbsenceDraftSchema, absenceSubmit: absenceActionSchema,
  voucher: transportVoucherRequestCreateSchema };
for (const [name, schema] of Object.entries(schemas)) {
  const result = schema.safeParse(fixtures[name]);
  assert.equal(result.success, true, `${name}: ${result.success ? "" : JSON.stringify(result.error.issues)}`);
  process.stdout.write(`${name}: payload Kotlin aceito pelo schema TypeScript existente.\n`);
}
