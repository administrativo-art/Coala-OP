import assert from "node:assert/strict";
import test from "node:test";

import {
  isPdvLegalUserRemovalConfirmed,
  movePdvLegalUserWithCloneFallback,
  PdvLegalUserMoveCleanupError,
} from "../../src/lib/integrations/pdv-legal-user-move";

const source = { id: "100", active: true };
const target = { id: "200", active: true };

test("mantém o mesmo acesso quando a API confirma a atualização da filial", async () => {
  const calls: string[] = [];
  const result = await movePdvLegalUserWithCloneFallback({
    sourceUserId: source.id,
    update: async () => { calls.push("update"); return source; },
    clone: async () => { calls.push("clone"); return { user: target, created: true }; },
    remove: async (id) => { calls.push(`remove:${id}`); },
    isUnconfirmedUpdate: () => false,
  });

  assert.deepEqual(result, { user: source, strategy: "update" });
  assert.deepEqual(calls, ["update"]);
});

test("substitui o acesso quando o PDV responde sucesso sem aplicar a filial", async () => {
  const calls: string[] = [];
  const unconfirmed = new Error("not confirmed");
  const result = await movePdvLegalUserWithCloneFallback({
    sourceUserId: source.id,
    update: async () => { calls.push("update"); throw unconfirmed; },
    clone: async () => { calls.push("clone"); return { user: target, created: true }; },
    remove: async (id) => { calls.push(`remove:${id}`); },
    isUnconfirmedUpdate: (error) => error === unconfirmed,
  });

  assert.deepEqual(result, { user: target, strategy: "replace" });
  assert.deepEqual(calls, ["update", "clone", "remove:100"]);
});

test("não converte falhas diferentes da confirmação em substituição", async () => {
  const failure = new Error("provider unavailable");
  await assert.rejects(
    movePdvLegalUserWithCloneFallback({
      sourceUserId: source.id,
      update: async () => { throw failure; },
      clone: async () => ({ user: target, created: true }),
      remove: async () => undefined,
      isUnconfirmedUpdate: () => false,
    }),
    failure,
  );
});

test("desfaz o acesso novo quando não consegue remover o acesso antigo", async () => {
  const removed: string[] = [];
  await assert.rejects(
    movePdvLegalUserWithCloneFallback({
      sourceUserId: source.id,
      update: async () => { throw new Error("not confirmed"); },
      clone: async () => ({ user: target, created: true }),
      remove: async (id) => {
        removed.push(id);
        if (id === source.id) throw new Error("delete failed");
      },
      isUnconfirmedUpdate: () => true,
    }),
    (error: unknown) =>
      error instanceof PdvLegalUserMoveCleanupError && error.compensationFailed === false,
  );
  assert.deepEqual(removed, ["100", "200"]);
});

test("registra quando a compensação também falha", async () => {
  await assert.rejects(
    movePdvLegalUserWithCloneFallback({
      sourceUserId: source.id,
      update: async () => { throw new Error("not confirmed"); },
      clone: async () => ({ user: target, created: true }),
      remove: async () => { throw new Error("delete failed"); },
      isUnconfirmedUpdate: () => true,
    }),
    (error: unknown) =>
      error instanceof PdvLegalUserMoveCleanupError && error.compensationFailed === true,
  );
});

test("não remove um acesso de destino que já existia durante a compensação", async () => {
  const removed: string[] = [];
  await assert.rejects(
    movePdvLegalUserWithCloneFallback({
      sourceUserId: source.id,
      update: async () => { throw new Error("not confirmed"); },
      clone: async () => ({ user: target, created: false }),
      remove: async (id) => {
        removed.push(id);
        throw new Error("delete failed");
      },
      isUnconfirmedUpdate: () => true,
    }),
    (error: unknown) =>
      error instanceof PdvLegalUserMoveCleanupError && error.compensationFailed === false,
  );
  assert.deepEqual(removed, ["100"]);
});

test("considera removido quando o usuário some ou fica inativo", () => {
  assert.equal(isPdvLegalUserRemovalConfirmed(null), true);
  assert.equal(isPdvLegalUserRemovalConfirmed({ id: "100", active: false }), true);
  assert.equal(isPdvLegalUserRemovalConfirmed({ id: "100", active: true }), false);
  assert.equal(isPdvLegalUserRemovalConfirmed({ id: "100", active: null }), false);
});
