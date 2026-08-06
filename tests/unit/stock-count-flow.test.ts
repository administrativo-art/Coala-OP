import assert from "node:assert/strict";
import test from "node:test";

import { buildStockCountTaskPatch } from "../../src/features/stock-count/lib/task-sync";
import { canActOnTask, canViewTask } from "../../src/features/tasks/lib/server-access";
import { defaultGuestPermissions, type StockAuditSession } from "../../src/types";
import type { ServerUserContext } from "../../src/lib/auth-server";

const session: StockAuditSession = {
  id: "count-1",
  kioskId: "joao-paulo",
  kioskName: "Quiosque João Paulo",
  status: "pending_review",
  auditedBy: {
    userId: "owner-1",
    username: "Responsável pela contagem",
  },
  startedAt: "2026-08-05T19:01:19.404Z",
  items: [
    {
      productId: "product-1",
      productName: "Produto",
      lotId: "lot-1",
      lotNumber: "L1",
      expiryDate: "2026-12-31",
      systemQuantity: 10,
      finalQuantity: 10,
      displayUnit: "un",
      divergences: [],
      adjustments: [],
    },
  ],
};

function context(userId: string, options?: { manage?: boolean; approve?: boolean }) {
  const permissions = structuredClone(defaultGuestPermissions);
  permissions.tasks.view = true;
  permissions.tasks.manage = options?.manage === true;
  permissions.stock.stockCount.approve = options?.approve === true;
  return {
    decoded: { uid: userId },
    userDoc: {
      id: userId,
      username: userId,
      assignedKioskIds: ["joao-paulo"],
    },
    profileId: null,
    permissions,
    isDefaultAdmin: false,
    workspace_id: "coala",
  } as unknown as ServerUserContext;
}

function taskFromPatch(patch: ReturnType<typeof buildStockCountTaskPatch>) {
  return {
    id: "task-1",
    workspaceId: "coala",
    origin: { kind: "legacy", type: "stock_count_approval", id: session.id },
    ...patch,
  } as any;
}

test("contagem aberta fica atribuída ao usuário que a iniciou e não requer aprovação", () => {
  const patch = buildStockCountTaskPatch(session, "stock", "stock-count");

  assert.equal(patch.title, "Concluir contagem: Quiosque João Paulo");
  assert.equal(patch.status, "pending");
  assert.equal(patch.assigneeType, "user");
  assert.equal(patch.assigneeId, "owner-1");
  assert.equal(patch.requiresApproval, false);
  assert.equal(patch.approverId, undefined);
  assert.equal(patch.visibilityScope, "assignee_and_watchers");
});

test("a tarefa acompanha a conclusão sem criar uma segunda aprovação", () => {
  const patch = buildStockCountTaskPatch(
    { ...session, status: "completed", completedAt: "2026-08-05T20:00:00.000Z" },
    "stock",
    "stock-count",
  );

  assert.equal(patch.title, "Contagem concluída: Quiosque João Paulo");
  assert.equal(patch.status, "completed");
  assert.equal(patch.assigneeId, "owner-1");
  assert.equal(patch.requiresApproval, false);
});

test("somente o autor pode atuar na tarefa de contagem", () => {
  const task = taskFromPatch(buildStockCountTaskPatch(session, "stock", "stock-count"));
  const owner = context("owner-1");
  const otherApprover = context("approver-2", { approve: true });
  const manager = context("manager-1", { manage: true });

  assert.equal(canViewTask(owner, task), true);
  assert.equal(canActOnTask(owner, task), true);
  assert.equal(canViewTask(otherApprover, task), false);
  assert.equal(canActOnTask(otherApprover, task), false);
  assert.equal(canViewTask(manager, task), true);
  assert.equal(canActOnTask(manager, task), false);
});

test("tarefas antigas também reconhecem o autor, sem liberar aprovadores genéricos", () => {
  const legacyTask = taskFromPatch({
    ...buildStockCountTaskPatch(session, "stock", "stock-count"),
    assigneeType: "role",
    assigneeId: "__stock_count_approver__",
    createdByUserId: "owner-1",
    watcherUserIds: ["owner-1"],
  });

  assert.equal(canViewTask(context("owner-1"), legacyTask), true);
  assert.equal(canActOnTask(context("owner-1"), legacyTask), true);
  assert.equal(canViewTask(context("approver-2", { approve: true }), legacyTask), false);
});
