import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canManagePrivacy, canViewPrivacy } from "../../src/app/api/privacy/_lib";
import { clientAuditEventSchema, privacyRequestCreateSchema, securityIncidentCreateSchema } from "../../src/features/privacy/security";
import { buildActionLogRecord } from "../../src/lib/log-action";
import type { ServerUserContext } from "../../src/lib/auth-server";

function actor(settings: Record<string, boolean>, collaborators: Record<string, boolean> = {}) {
  return { isDefaultAdmin: false, permissions: { settings, dp: { collaborators } } } as unknown as ServerUserContext;
}

test("settings.view permite consulta, mas não gestão de privacidade", () => {
  const viewer = actor({ view: true, manageUsers: false, manageProfiles: false });
  assert.equal(canViewPrivacy(viewer), true);
  assert.equal(canManagePrivacy(viewer), false);

  for (const manager of [
    actor({ view: false, manageUsers: true, manageProfiles: false }),
    actor({ view: false, manageUsers: false, manageProfiles: true }),
    actor({ view: false, manageUsers: false, manageProfiles: false }, { edit: true }),
    actor({ view: false, manageUsers: false, manageProfiles: false }, { terminate: true }),
  ]) {
    assert.equal(canViewPrivacy(manager), true);
    assert.equal(canManagePrivacy(manager), true);
  }
});

test("schemas de privacidade são estritos e rejeitam campos controlados pelo servidor", () => {
  const request = { subjectName: "Titular", subjectType: "employee", requestType: "access", origin: "email", description: "Solicitação" };
  assert.equal(privacyRequestCreateSchema.safeParse(request).success, true);
  assert.equal(privacyRequestCreateSchema.safeParse({ ...request, status: "completed" }).success, false);

  const incident = { title: "Incidente", incidentType: "data_loss", severity: "high", affectedData: "Cadastro", containmentActions: "Acesso bloqueado" };
  assert.equal(securityIncidentCreateSchema.safeParse(incident).success, true);
  assert.equal(securityIncidentCreateSchema.safeParse({ ...incident, workspace_id: "outro" }).success, false);
});

test("evento de auditoria do cliente recebe origem de confiança explícita", () => {
  assert.equal(clientAuditEventSchema.safeParse({ module: "settings.users", action: "user_updated", metadata: {} }).success, true);
  assert.equal(clientAuditEventSchema.safeParse({ module: "Settings Users", action: "updated" }).success, false);
  const record = buildActionLogRecord({ module: "settings.users", action: "user_updated", trust_source: "client-declared", event_namespace: "client" });
  assert.equal(record.trust_source, "client-declared");
  assert.equal(record.event_namespace, "client");
});

test("rotas de mutação exigem gestão e auditoria atômica", async () => {
  const root = new URL("../../", import.meta.url);
  const sources = await Promise.all([
    "src/app/api/privacy/requests/route.ts",
    "src/app/api/privacy/requests/[id]/route.ts",
    "src/app/api/privacy/incidents/route.ts",
    "src/app/api/privacy/incidents/[id]/route.ts",
  ].map((path) => readFile(new URL(path, root), "utf8")));
  for (const source of sources) {
    assert.match(source, /requirePrivacyManage/);
    assert.match(source, /runTransaction/);
    assert.match(source, /server-authoritative/);
  }
});
