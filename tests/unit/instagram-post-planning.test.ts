import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { instagramPostUpdateSchema, instagramPostCreateSchema } from "../../src/features/instagram-posts/contracts";
import {
  approvalBlocked,
  approvalChecklist,
  fromBelemInput,
  initialStep,
  planningChangedAfterApproval,
  planningComplete,
  planningWarnings,
  stepUnlocked,
  toBelemInput,
} from "../../src/features/instagram-posts/planning-model";

const approved = (hash: string, at = "2026-10-01T10:00:00.000Z") => ({ status: "approved" as const, artifactSha256: hash, approvedAt: at });

function post(over: Record<string, unknown> = {}) {
  return {
    status: "planned",
    contentHash: "sha256:a",
    contentApproval: { status: "pending", artifactSha256: null, approvedAt: null },
    publicationApproval: { status: "pending", artifactSha256: null, approvedAt: null },
    ...over,
  } as never;
}

describe("contrato do planejamento", () => {
  it("aceita planejamento parcial na criação e na atualização e rejeita campos desconhecidos", () => {
    const update = instagramPostUpdateSchema.safeParse({ planning: { designRationale: "Cores da campanha de outubro." } });
    assert.equal(update.success, true);
    assert.equal(instagramPostUpdateSchema.safeParse({ planning: { objective: "vendas" } }).success, false);
    assert.equal(instagramPostUpdateSchema.safeParse({ planning: { extra: 1 } }).success, false);
    assert.equal(instagramPostUpdateSchema.safeParse({ planning: { plannedAt: "2026-10-10T13:00:00-03:00", objective: "sales" } }).success, true);
    assert.equal(instagramPostUpdateSchema.safeParse({ planning: { plannedAt: "amanhã" } }).success, false);
    const create = instagramPostCreateSchema.safeParse({
      clientMutationId: "7d0f6d6e-6c1f-4f9e-8a39-0b8d1d8f6a11", title: "Teste", format: "story", placement: { kind: "editorial" },
      planning: { callToAction: "Peça no delivery" },
    });
    assert.equal(create.success, true);
  });
});

describe("etapas do post", () => {
  it("abre na próxima pendência e libera as etapas conforme o estado", () => {
    assert.equal(initialStep(post()), "planning");
    assert.equal(initialStep(post({ status: "produced" })), "approval");
    const both = post({ status: "produced", contentApproval: approved("sha256:a"), publicationApproval: approved("sha256:a") });
    assert.equal(initialStep(both), "publication");
    assert.equal(initialStep(post({ status: "scheduled" })), "result");
    assert.equal(stepUnlocked(post(), "approval"), false);
    assert.equal(stepUnlocked(post({ status: "produced" }), "approval"), true);
    assert.equal(stepUnlocked(post({ status: "produced" }), "publication"), false);
    assert.equal(stepUnlocked(both, "publication"), true);
    assert.equal(stepUnlocked(both, "result"), false);
  });

  it("aprovação de outra versão não conta como válida", () => {
    const stale = post({ status: "produced", contentApproval: approved("sha256:old"), publicationApproval: approved("sha256:a") });
    assert.equal(initialStep(stale), "approval");
    assert.equal(stepUnlocked(stale, "publication"), false);
  });
});

describe("checklist e motivos", () => {
  const base = {
    format: "feed_image", caption: "Legenda", media: [{}], publicationReadiness: { status: "certified" },
    planning: { designRationale: "x".repeat(20), formatRationale: "y".repeat(20), plannedAt: null }, schedule: null,
  } as never;

  it("exige mídia certificada, legenda e os dois motivos; a data é recomendada", () => {
    const items = approvalChecklist(base);
    assert.equal(approvalBlocked(items), false);
    assert.equal(items.find((item) => item.id === "date")?.ok, false);
    const short = approvalChecklist({ ...(base as object), planning: { designRationale: "curto", formatRationale: "y".repeat(20), plannedAt: null } } as never);
    assert.equal(approvalBlocked(short), true);
    const story = approvalChecklist({ ...(base as object), format: "story", caption: "" } as never);
    assert.equal(story.find((item) => item.id === "caption")?.ok, true);
    const noMedia = approvalChecklist({ ...(base as object), media: [] } as never);
    assert.equal(approvalBlocked(noMedia), true);
  });

  it("os motivos precisam de 20 caracteres sem contar espaços nas pontas", () => {
    assert.equal(planningComplete({ designRationale: `  ${"a".repeat(19)}  `, formatRationale: "b".repeat(20) }), false);
    assert.equal(planningComplete({ designRationale: "a".repeat(20), formatRationale: "b".repeat(20) }), true);
  });

  it("sinaliza planejamento alterado depois da aprovação do conteúdo", () => {
    const changed = { contentApproval: approved("h", "2026-10-01T10:00:00.000Z"), planning: { updatedAt: "2026-10-02T10:00:00.000Z" } } as never;
    const same = { contentApproval: approved("h", "2026-10-03T10:00:00.000Z"), planning: { updatedAt: "2026-10-02T10:00:00.000Z" } } as never;
    assert.equal(planningChangedAfterApproval(changed), true);
    assert.equal(planningChangedAfterApproval(same), false);
    assert.equal(planningChangedAfterApproval({ contentApproval: null, planning: { updatedAt: "2026-10-02T10:00:00.000Z" } } as never), false);
  });
});

describe("avisos de estratégia", () => {
  const other = (id: string, format: string, plannedAt: string) => ({ id, format, schedule: null, planning: { plannedAt }, publicationResult: null }) as never;
  const now = new Date("2026-10-01T12:00:00.000Z");

  it("avisa de data passada, dia cheio, horário próximo e formato repetido", () => {
    const warnings = planningWarnings({
      postId: "me", format: "story", plannedAt: "2026-10-10T13:00:00-03:00", now,
      others: [other("a", "story", "2026-10-10T09:30:00-03:00"), other("b", "story", "2026-10-10T13:30:00-03:00")],
    });
    const ids = warnings.map((warning) => warning.id);
    assert.ok(ids.includes("busy-day"));
    assert.ok(ids.includes("same-hour"));
    assert.ok(ids.includes("repeated-format"));
    assert.ok(!ids.includes("past"));
    assert.ok(planningWarnings({ postId: "me", format: "reel", plannedAt: "2026-09-01T10:00:00-03:00", now, others: [] }).some((warning) => warning.id === "past"));
  });

  it("sem data alvo ou sem conflito não há aviso, e o próprio post é ignorado", () => {
    assert.deepEqual(planningWarnings({ postId: "me", format: "story", plannedAt: null, others: [] }), []);
    assert.deepEqual(planningWarnings({ postId: "me", format: "story", plannedAt: "2026-10-10T13:00:00-03:00", now, others: [other("me", "story", "2026-10-10T13:00:00-03:00")] }), []);
  });
});

describe("horário de Belém", () => {
  it("converte entre o campo da tela e o ISO com deslocamento fixo de -03:00", () => {
    assert.equal(fromBelemInput("2026-10-10T10:00"), "2026-10-10T13:00:00.000Z");
    assert.equal(toBelemInput("2026-10-10T13:00:00.000Z"), "2026-10-10T10:00");
    assert.equal(fromBelemInput("dez horas"), null);
    assert.equal(toBelemInput(null), "");
  });
});
