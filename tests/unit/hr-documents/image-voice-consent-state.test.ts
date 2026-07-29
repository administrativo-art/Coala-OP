import assert from "node:assert/strict";
import test from "node:test";

import {
  markImageVoiceUsageRemoved,
  normalizeImageVoiceConsent,
  registerImageVoiceUsage,
  revokeImageVoiceConsent,
} from "../../../src/features/hr/consents/image-voice-consent";

const legacyGrant = {
  autorizado: true,
  respondido_em: "2026-07-01T12:00:00.000Z",
  versao_termo: "1.0",
  hash_termo_exibido: "abc",
  origem: "onboarding_publico",
};

test("normaliza autorização legada sem perder a prova original", () => {
  const consent = normalizeImageVoiceConsent(legacyGrant);
  assert.equal(consent.status, "granted");
  assert.equal(consent.termVersion, "1.0");
  assert.equal(consent.termHash, "abc");
});

test("revogação bloqueia novos usos e preserva o inventário", () => {
  const withUsage = registerImageVoiceUsage(legacyGrant, {
    usageId: "usage-1",
    channel: "instagram",
    asset: "campanha-inverno",
    publishedAt: "2026-07-10T12:00:00.000Z",
    registeredAt: "2026-07-10T12:00:00.000Z",
    registeredBy: "marketing-1",
  });
  const revoked = revokeImageVoiceConsent(withUsage, {
    at: "2026-07-28T12:00:00.000Z",
    channel: "employee_profile",
  });
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.operationalEffectStatus, "pending");
  assert.throws(() => registerImageVoiceUsage(revoked, {
    usageId: "usage-2",
    channel: "site",
    asset: "home",
    publishedAt: "2026-07-28T13:00:00.000Z",
    registeredAt: "2026-07-28T13:00:00.000Z",
    registeredBy: "marketing-1",
  }), /sem autorização vigente/);
});

test("retirada do último uso conclui o efeito operacional", () => {
  const withUsage = registerImageVoiceUsage(legacyGrant, {
    usageId: "usage-1",
    channel: "instagram",
    asset: "campanha-inverno",
    publishedAt: "2026-07-10T12:00:00.000Z",
    registeredAt: "2026-07-10T12:00:00.000Z",
    registeredBy: "marketing-1",
  });
  const revoked = revokeImageVoiceConsent(withUsage, {
    at: "2026-07-28T12:00:00.000Z",
    channel: "employee_profile",
  });
  const completed = markImageVoiceUsageRemoved(revoked, {
    usageId: "usage-1",
    removedAt: "2026-07-28T14:00:00.000Z",
    removedBy: "marketing-1",
  });
  assert.equal(completed.operationalEffectStatus, "completed");
  assert.equal(completed.operationalEffectAt, "2026-07-28T14:00:00.000Z");
});
