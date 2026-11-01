import assert from "node:assert/strict";
import test from "node:test";

import {
  PdvOperationalUnitSyncError,
  PDV_SERVER_MANAGED_USER_FIELDS,
  pdvAccessEnabled,
  pdvOperationalUnitPatch,
  pdvRemovalPatch,
  planPdvAccessRevocation,
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

test("migra o ID legado por quiosque ao incluir outra unidade operacional", () => {
  const current = {
    unitIds: ["unidade-tirirical"],
    assignedKioskIds: ["tirirical"],
    pdvOperatorIds: { tirirical: 436145 },
  };

  const [plan] = planPdvOperationalUnitSyncs(current, {
    ...current,
    unitIds: ["unidade-tirirical", "unidade-shopping"],
    assignedKioskIds: ["tirirical", "shopping"],
  });
  assert.deepEqual(plan, {
    kind: "add",
    sourceExternalUserId: "436145",
    sourceUnitId: null,
    targetUnitId: "unidade-shopping",
    profileId: null,
  });
  assert.ok(plan);

  const patch = pdvOperationalUnitPatch({
    currentUser: current,
    plan,
    externalUserId: "987654",
    targetUnitName: "Shopping",
    targetFilialId: "40",
    targetFilialName: "Shopping",
    confirmedProfileId: "12",
    updatedAt: "2026-09-01T11:00:00.000Z",
  });
  assert.deepEqual(patch.pdvAccesses.map((access) => access.externalUserId), ["436145", "987654"]);
  assert.equal(patch.registrationIdPdv, "436145");
});

test("migra o ID legado por quiosque ao trocar diretamente de unidade", () => {
  const current = {
    unitIds: ["unidade-tirirical"],
    assignedKioskIds: ["tirirical"],
    pdvOperatorIds: { tirirical: 436145 },
  };

  assert.deepEqual(planPdvOperationalUnitSyncs(current, {
    ...current,
    unitIds: ["unidade-shopping"],
    assignedKioskIds: ["shopping"],
  }), [{
    kind: "move",
    sourceExternalUserId: "436145",
    sourceUnitId: "unidade-tirirical",
    targetUnitId: "unidade-shopping",
    profileId: null,
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

test("remove o acesso quando a unidade sai da vigência sem outra entrar", () => {
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

  assert.deepEqual(planPdvOperationalUnitSyncs(current, { ...current, unitIds: ["calhau"] }), [{
    kind: "remove",
    sourceExternalUserId: "436145",
    sourceUnitId: "tirirical",
    targetUnitId: null,
    profileId: null,
  }]);
});

test("ignora unidades sem filial do PDV ao planejar", () => {
  const current = {
    unitIds: ["tirirical"],
    registrationIdPdv: "436145",
    pdvAccesses: [{ externalUserId: "436145", unitId: "tirirical", filialId: "10", profileId: "12", status: "active" }],
  };
  const pdvUnitIds = new Set(["tirirical", "joao-paulo"]);
  assert.deepEqual(planPdvOperationalUnitSyncs(current, { ...current, unitIds: ["tirirical", "cd"] }, { pdvUnitIds }), []);
  assert.deepEqual(planPdvOperationalUnitSyncs(current, { ...current, unitIds: ["cd", "joao-paulo"] }, { pdvUnitIds }), [{
    kind: "move",
    sourceExternalUserId: "436145",
    sourceUnitId: "tirirical",
    targetUnitId: "joao-paulo",
    profileId: "12",
  }]);
});

test("combina troca, inclusão e remoção em uma alteração múltipla, removendo por último", () => {
  const current = {
    unitIds: ["a", "b"],
    registrationIdPdv: "1",
    pdvAccesses: [
      { externalUserId: "1", unitId: "a", filialId: "10", profileId: "12", status: "active" },
      { externalUserId: "2", unitId: "b", filialId: "20", profileId: "12", status: "active" },
    ],
  };
  const plans = planPdvOperationalUnitSyncs(current, { ...current, unitIds: ["c"] });
  assert.deepEqual(plans.map((plan) => [plan.kind, plan.sourceExternalUserId, plan.targetUnitId]), [
    ["move", "1", "c"],
    ["remove", "2", null],
  ]);
});

test("bloqueia a remoção quando o acesso não identifica a unidade", () => {
  const current = {
    unitIds: ["a", "b"],
    pdvAccesses: [{ externalUserId: "9", unitId: null, filialId: "10", profileId: "12", status: "active" }],
  };
  assert.throws(
    () => planPdvOperationalUnitSyncs(current, { ...current, unitIds: ["b", "c", "d"] }),
    PdvOperationalUnitSyncError,
  );
});

test("desligar o acesso planeja a remoção de todos os acessos ativos e do registro legado", () => {
  const current = {
    registrationIdPdv: "9",
    pdvAccesses: [
      { externalUserId: "1", unitId: "a", filialId: "10", profileId: "12", status: "active" },
      { externalUserId: "2", unitId: "b", filialId: "20", profileId: "12", status: "inactive" },
    ],
  };
  assert.deepEqual(planPdvAccessRevocation(current).map((plan) => plan.sourceExternalUserId), ["1", "9"]);
  assert.equal(pdvAccessEnabled(current), true);
  assert.equal(pdvAccessEnabled({ ...current, pdvAccessEnabled: false }), false);
  assert.equal(pdvAccessEnabled({}), false);
});

test("a remoção inativa o acesso, mantém o ID no histórico e reaponta o principal", () => {
  const current = {
    registrationIdPdv: "1",
    pdvAccesses: [
      { externalUserId: "1", unitId: "a", filialId: "10", filialName: "A", profileId: "12", status: "active" },
      { externalUserId: "2", unitId: "b", filialId: "20", filialName: "B", profileId: "13", status: "active" },
    ],
  };
  const patch = pdvRemovalPatch({ currentUser: current, externalUserId: "1", updatedAt: "2026-10-29T12:00:00.000Z" });
  assert.deepEqual(patch.pdvAccesses.map((access) => [access.externalUserId, access.status]), [["1", "inactive"], ["2", "active"]]);
  assert.equal(patch.registrationIdPdv, "2");
  assert.equal(patch.pdvAccessFilialId, "20");
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

test("acesso antigo por quiosque vai para a unidade do quiosque, nunca pela posição nas listas", async () => {
  const { listPdvAccesses } = await import("../../src/features/hr/lib/pdv-operational-unit-sync");
  const { kioskUnitResolver } = await import("../../src/lib/collaborator-operational-selection");
  // Caso real: unidades e quiosques em ordens diferentes (o CD não tem quiosque com filial).
  const user = {
    unitIds: ["unit-jp", "unit-cd", "unit-shopping", "unit-tirirical"],
    assignedKioskIds: ["k-shopping", "k-jp", "k-cd", "k-tirirical"],
    pdvOperatorIds: { "k-tirirical": 184256, "k-jp": 415369, "k-shopping": 664450 },
  };
  const units = [
    { id: "unit-jp", name: "Quiosque João Paulo", pdvFilialId: "17344" },
    { id: "unit-cd", name: "Centro de distribuição - Matriz", pdvFilialId: null },
    { id: "unit-shopping", name: "Quiosque Shopping do Automóvel", pdvFilialId: "39033" },
    { id: "unit-tirirical", name: "Quiosque Tirirical", pdvFilialId: "17343" },
  ];
  const kiosks = [
    { id: "k-shopping", name: "Quiosque Shopping do Automóvel", pdvFilialId: "39033" },
    { id: "k-jp", name: "Quiosque João Paulo", pdvFilialId: "17344" },
    { id: "k-cd", name: "Centro de distribuição", pdvFilialId: null },
    { id: "k-tirirical", name: "Quiosque Tirirical", pdvFilialId: "17343" },
  ];
  const byId = (accesses: Array<{ externalUserId: string; unitId?: string | null }>) =>
    Object.fromEntries(accesses.map((access) => [access.externalUserId, access.unitId]));

  assert.deepEqual(byId(listPdvAccesses(user, kioskUnitResolver(kiosks, units))),
    { "184256": "unit-tirirical", "415369": "unit-jp", "664450": "unit-shopping" });
  // Sem o tradutor, o vínculo fica em aberto em vez de cair na unidade errada.
  assert.deepEqual(byId(listPdvAccesses(user)), { "184256": null, "415369": null, "664450": null });
});
