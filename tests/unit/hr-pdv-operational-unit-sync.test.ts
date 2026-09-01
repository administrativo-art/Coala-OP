import assert from "node:assert/strict";
import test from "node:test";

import {
  PdvOperationalUnitSyncError,
  PDV_SERVER_MANAGED_USER_FIELDS,
  pdvOperationalUnitPatch,
  planPdvOperationalUnitSyncs,
} from "../../src/features/hr/lib/pdv-operational-unit-sync";

test("mantém os vínculos canônicos do PDV sob escrita exclusiva do servidor", () => {
  assert.deepEqual(PDV_SERVER_MANAGED_USER_FIELDS, [
    "pdvAccesses",
    "pdvAccessProfileId",
    "pdvAccessProfileName",
    "pdvAccessFilialId",
    "pdvAccessFilialName",
  ]);
});

test("ignora mudança apenas da unidade financeira quando as unidades operacionais permanecem iguais", () => {
  const current = {
    unitId: "financeiro-a",
    unitIds: ["tirirical"],
    registrationIdPdv: "436145",
    pdvAccessProfileId: "12",
  };
  const next = { ...current, unitId: "financeiro-b" };

  assert.deepEqual(planPdvOperationalUnitSyncs(current, next), []);
});

test("planeja a transferência do mesmo acesso em uma troca direta de unidade operacional", () => {
  const current = {
    unitIds: ["tirirical"],
    registrationIdPdv: "436145",
    pdvAccessProfileId: "12",
    pdvAccesses: [{
      externalUserId: "436145",
      unitId: "tirirical",
      filialId: "10",
      profileId: "12",
      status: "active",
    }],
  };

  assert.deepEqual(planPdvOperationalUnitSyncs(current, { ...current, unitIds: ["shopping-da-ilha"] }), [{
    kind: "move",
    sourceExternalUserId: "436145",
    sourceUnitId: "tirirical",
    targetUnitId: "shopping-da-ilha",
    profileId: "12",
  }]);
});

test("planeja um novo acesso ao incluir uma segunda unidade operacional", () => {
  const current = {
    unitIds: ["tirirical"],
    registrationIdPdv: "436145",
    pdvAccessProfileId: "12",
  };

  assert.deepEqual(planPdvOperationalUnitSyncs(current, {
    ...current,
    unitIds: ["tirirical", "shopping-da-ilha"],
  }), [{
    kind: "add",
    sourceExternalUserId: "436145",
    sourceUnitId: null,
    targetUnitId: "shopping-da-ilha",
    profileId: "12",
  }]);
});

test("bloqueia uma troca ambígua quando existem vários acessos sem vínculo com a unidade removida", () => {
  const current = {
    unitIds: ["tirirical"],
    pdvAccesses: [
      { externalUserId: "1", unitId: "calhau", filialId: "20", profileId: "12", status: "active" },
      { externalUserId: "2", unitId: "cohama", filialId: "30", profileId: "12", status: "active" },
    ],
  };

  assert.throws(
    () => planPdvOperationalUnitSyncs(current, { ...current, unitIds: ["shopping-da-ilha"] }),
    PdvOperationalUnitSyncError,
  );
});

test("bloqueia a remoção isolada de uma unidade que possui acesso ativo", () => {
  const current = {
    unitIds: ["tirirical", "calhau"],
    registrationIdPdv: "436145",
    pdvAccesses: [{
      externalUserId: "436145",
      unitId: "tirirical",
      filialId: "10",
      profileId: "12",
      status: "active",
    }],
  };

  assert.throws(
    () => planPdvOperationalUnitSyncs(current, { ...current, unitIds: ["calhau"] }),
    PdvOperationalUnitSyncError,
  );
});

test("a confirmação de uma transferência atualiza o vínculo sem duplicar o acesso", () => {
  const current = {
    registrationIdPdv: "436145",
    pdvAccessFilialId: "10",
    pdvAccessProfileId: "12",
    pdvAccessProfileName: "Atendente",
    pdvAccesses: [{
      externalUserId: "436145",
      unitId: "tirirical",
      unitName: "Quiosque Tirirical",
      filialId: "10",
      filialName: "Tirirical",
      profileId: "12",
      profileName: "Atendente",
      status: "active",
    }],
  };
  const [plan] = planPdvOperationalUnitSyncs(
    { ...current, unitIds: ["tirirical"] },
    { ...current, unitIds: ["shopping-da-ilha"] },
  );
  assert.ok(plan);

  const patch = pdvOperationalUnitPatch({
    currentUser: current,
    plan,
    externalUserId: "436145",
    targetUnitName: "Shopping da Ilha",
    targetFilialId: "40",
    targetFilialName: "Shopping da Ilha",
    confirmedProfileId: "12",
    updatedAt: "2026-08-31T23:00:00.000Z",
  });

  assert.equal(patch.pdvAccesses.length, 1);
  assert.equal(patch.pdvAccesses[0].unitId, "shopping-da-ilha");
  assert.equal(patch.pdvAccessFilialId, "40");
  assert.equal(patch.registrationIdPdv, "436145");
});

test("a confirmação de uma inclusão preserva o acesso principal e adiciona o novo ID", () => {
  const current = {
    registrationIdPdv: "436145",
    pdvAccessFilialId: "10",
    pdvAccessProfileId: "12",
    pdvAccessProfileName: "Atendente",
    pdvAccesses: [{
      externalUserId: "436145",
      unitId: "tirirical",
      filialId: "10",
      profileId: "12",
      status: "active",
    }],
  };
  const [plan] = planPdvOperationalUnitSyncs(
    { ...current, unitIds: ["tirirical"] },
    { ...current, unitIds: ["tirirical", "shopping-da-ilha"] },
  );
  assert.ok(plan);

  const patch = pdvOperationalUnitPatch({
    currentUser: current,
    plan,
    externalUserId: "987654",
    targetUnitName: "Shopping da Ilha",
    targetFilialId: "40",
    targetFilialName: "Shopping da Ilha",
    confirmedProfileId: "12",
    updatedAt: "2026-08-31T23:00:00.000Z",
  });

  assert.deepEqual(patch.pdvAccesses.map((access) => access.externalUserId), ["436145", "987654"]);
  assert.equal("registrationIdPdv" in patch, false);
});

test("a inclusão migra o registro legado para a lista sem perder o ID anterior", () => {
  const current = {
    unitIds: ["tirirical"],
    registrationIdPdv: "436145",
    pdvAccessFilialId: "10",
    pdvAccessFilialName: "Tirirical",
    pdvAccessProfileId: "12",
    pdvAccessProfileName: "Atendente",
  };
  const [plan] = planPdvOperationalUnitSyncs(current, {
    ...current,
    unitIds: ["tirirical", "shopping-da-ilha"],
  });
  assert.ok(plan);

  const patch = pdvOperationalUnitPatch({
    currentUser: current,
    plan,
    externalUserId: "987654",
    targetUnitName: "Shopping da Ilha",
    targetFilialId: "40",
    targetFilialName: "Shopping da Ilha",
    confirmedProfileId: "12",
    updatedAt: "2026-08-31T23:00:00.000Z",
  });

  assert.deepEqual(patch.pdvAccesses.map((access) => access.externalUserId), ["436145", "987654"]);
});

test("planeja um novo acesso para cada unidade incluída na mesma alteração", () => {
  const current = {
    unitIds: ["unidade-a"],
    registrationIdPdv: "436145",
    pdvAccessProfileId: "12",
  };

  assert.deepEqual(planPdvOperationalUnitSyncs(current, {
    ...current,
    unitIds: ["unidade-a", "unidade-b", "unidade-c"],
  }), [
    {
      kind: "add",
      sourceExternalUserId: "436145",
      sourceUnitId: null,
      targetUnitId: "unidade-b",
      profileId: "12",
    },
    {
      kind: "add",
      sourceExternalUserId: "436145",
      sourceUnitId: null,
      targetUnitId: "unidade-c",
      profileId: "12",
    },
  ]);
});

test("acumula os IDs das três filiais ao confirmar duas inclusões na mesma alteração", () => {
  let working: Record<string, unknown> = {
    unitIds: ["unidade-a"],
    registrationIdPdv: "100",
    pdvAccessFilialId: "10",
    pdvAccessProfileId: "12",
  };
  const plans = planPdvOperationalUnitSyncs(working, {
    ...working,
    unitIds: ["unidade-a", "unidade-b", "unidade-c"],
  });

  for (const [index, plan] of plans.entries()) {
    const suffix = String(index + 2);
    const patch = pdvOperationalUnitPatch({
      currentUser: working,
      plan,
      externalUserId: `${suffix}00`,
      targetUnitName: `Unidade ${suffix}`,
      targetFilialId: `${suffix}0`,
      targetFilialName: `Filial ${suffix}`,
      confirmedProfileId: "12",
      updatedAt: "2026-08-31T23:00:00.000Z",
    });
    working = { ...working, ...patch };
  }

  assert.deepEqual(
    (working.pdvAccesses as Array<{ externalUserId: string }>).map((access) => access.externalUserId),
    ["100", "200", "300"],
  );
});
