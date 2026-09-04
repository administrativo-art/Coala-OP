import assert from "node:assert/strict";
import test from "node:test";

import { canActOnTask, canViewTask } from "../../src/features/tasks/lib/server-access";
import type { ServerUserContext } from "../../src/lib/auth-server";
import { defaultGuestPermissions, type Task } from "../../src/types";

function context(
  userId: string,
  options: { manage?: boolean; profileId?: string; defaultAdmin?: boolean } = {},
) {
  const permissions = structuredClone(defaultGuestPermissions);
  permissions.tasks.view = true;
  permissions.tasks.manage = options.manage === true;
  return {
    decoded: { uid: userId },
    userDoc: { id: userId, username: userId },
    profileId: options.profileId ?? null,
    permissions,
    isDefaultAdmin: options.defaultAdmin === true,
    workspace_id: "coala",
  } as unknown as ServerUserContext;
}

function task(overrides: Partial<Task> = {}) {
  return {
    id: "task-1",
    workspaceId: "coala",
    title: "Tarefa restrita",
    description: "",
    status: "pending",
    assigneeType: "profile",
    assigneeId: "admin",
    requiresApproval: false,
    visibilityScope: "assignee_and_watchers",
    watcherUserIds: [],
    watcherProfileIds: [],
    watcherRoleIds: [],
    origin: { kind: "manual" },
    history: [],
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    ...overrides,
  } as Task;
}

test("gestor genérico não vê nem atua em tarefa restrita a outro perfil", () => {
  const leader = context("leader-1", { manage: true, profileId: "kiosk-leader" });
  const restricted = task();

  assert.equal(canViewTask(leader, restricted), false);
  assert.equal(canActOnTask(leader, restricted), false);
});

test("perfil responsável mantém leitura e ação na tarefa restrita", () => {
  const hr = context("hr-1", { profileId: "admin" });
  const restricted = task();

  assert.equal(canViewTask(hr, restricted), true);
  assert.equal(canActOnTask(hr, restricted), true);
});

test("observador pode ler, mas não atuar, em tarefa restrita", () => {
  const watcher = context("watcher-1", { manage: true });
  const restricted = task({ watcherUserIds: ["watcher-1"] });

  assert.equal(canViewTask(watcher, restricted), true);
  assert.equal(canActOnTask(watcher, restricted), false);
});

test("administrador padrão preserva acesso emergencial à tarefa restrita", () => {
  const admin = context("root-1", { defaultAdmin: true });
  const restricted = task();

  assert.equal(canViewTask(admin, restricted), true);
  assert.equal(canActOnTask(admin, restricted), true);
});

test("visibilidade de projeto preserva a gestão de tarefas não confidenciais", () => {
  const leader = context("leader-1", { manage: true, profileId: "kiosk-leader" });
  const projectTask = task({ visibilityScope: "project" });

  assert.equal(canViewTask(leader, projectTask), true);
  assert.equal(canActOnTask(leader, projectTask), true);
});
