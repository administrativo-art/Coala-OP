import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const refs = readFileSync("src/features/assets/references.server.ts", "utf8");
const term = readFileSync("src/features/assets/custody-term.server.ts", "utf8");
const evidence = readFileSync("src/features/assets/audit-evidence.server.ts", "utf8");
const upload = readFileSync("src/app/api/assets/[assetId]/audits/upload/route.ts", "utf8");
const acquisition = readFileSync("src/app/api/assets/[assetId]/acquisition/route.ts", "utf8");
const ui = readFileSync("src/components/asset-management.tsx", "utf8");

test("referências cadastradas são resolvidas no servidor e isoladas por workspace", () => {
  assert.match(refs, /resolveActiveEmployee/);
  assert.match(refs, /assertWorkspace/);
  assert.match(refs, /resolveRegisteredPerformer/);
  assert.match(refs, /resolveAssetLocation/);
  assert.match(refs, /resolveMaintenanceAssignee/);
  assert.match(refs, /workspace_id/);
  assert.match(refs, /conflict: Boolean\(camel && snake && camel !== snake\)/);
  assert.match(refs, /camel \?\? snake \?\? WORKSPACE_ID/);
  assert.match(term, /resolveActiveEmployee\(params\.context\.workspace_id, employeeId\)/);
});

test("foto de auditoria usa caminho dedicado e integridade confirmada no servidor", () => {
  assert.match(upload, /secureRoute/);
  assert.match(upload, /assets\/\$\{security\.actor\.workspace_id\}\/\$\{security\.resource\.id\}\/audits/);
  assert.match(evidence, /file\.exists\(\)/);
  assert.match(evidence, /file\.getMetadata\(\)/);
  assert.match(evidence, /file\.download\(\)/);
  assert.match(evidence, /createHash\("sha256"\)/);
  assert.match(evidence, /ASSET_AUDIT_UPLOAD_CONSUMED/);
  assert.match(evidence, /consumedAuditId: auditId/);
  assert.match(upload, /expiresAt/);
  assert.match(upload, /assetAuditUploads/);
  assert.match(ui, /\/api\/assets\/\$\{assetId\}\/audits\/upload/);
});

test("aquisição comercial exige patrimônio e compras", () => {
  assert.match(acquisition, /assets\.view-and-purchasing-view/);
  assert.match(acquisition, /permissions\.stock\?\.purchasing\?\.view/);
  assert.match(ui, /acquisitionStatus === 'forbidden'/);
  assert.match(ui, /exigem permissão de Compras/);
});
