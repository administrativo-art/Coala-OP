import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildPublishedSlides,
  formatSignageDuration,
  getLocalDateKey,
  getNextSlide,
  getPublicationState,
  getScreenSlides,
  getSlideScreenIds,
  isSlideScheduleActive,
  mergeSlideScreenIds,
  pruneOrderByScreen,
  resolveActiveSlide,
  signageHeartbeatSchema,
  signagePublishSchema,
  signageScreenCreateSchema,
  signageScreenUpdateSchema,
  signageSlideSchema,
} from "../../src/lib/signage";
import type { SignageSlide } from "../../src/types";

const actor = { userId: "u1", username: "Teste" };

function slide(overrides: Partial<SignageSlide> & { id: string }): SignageSlide {
  return {
    title: `Slide ${overrides.id}`,
    type: "text",
    durationMs: 10_000,
    order: 0,
    kioskIds: ["k1"],
    screenIds: ["k1"],
    isActive: true,
    text: "Olá",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    createdBy: actor,
    updatedBy: actor,
    ...overrides,
  };
}

test("a rotação percorre a playlist inteira e volta ao início", () => {
  const slides = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const seen: string[] = [];
  let activeId: string | null = null;
  for (let step = 0; step < 7; step += 1) {
    const active: { id: string } | null = resolveActiveSlide(slides, activeId);
    assert.ok(active);
    seen.push(active.id);
    activeId = getNextSlide(slides, active.id)?.id ?? null;
  }
  assert.deepEqual(seen, ["a", "b", "c", "a", "b", "c", "a"]);
});

test("reavaliar o agendamento não reinicia a playlist enquanto o slide atual continua na lista", () => {
  const before = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const afterScheduleTick = [{ id: "a" }, { id: "c" }, { id: "d" }];
  assert.equal(resolveActiveSlide(afterScheduleTick, "c")?.id, "c");
  assert.equal(getNextSlide(afterScheduleTick, "c")?.id, "d");
  assert.equal(resolveActiveSlide(before, "c")?.id, "c");
});

test("slide que saiu da lista cai no primeiro; lista vazia não tem slide", () => {
  assert.equal(resolveActiveSlide([{ id: "a" }, { id: "b" }], "removido")?.id, "a");
  assert.equal(getNextSlide([{ id: "a" }, { id: "b" }], "removido")?.id, "a");
  assert.equal(resolveActiveSlide([], "a"), null);
  assert.equal(getNextSlide([], "a"), null);
  assert.equal(getNextSlide([{ id: "a" }], "a")?.id, "a");
});

test("o período do agendamento usa a data local, inclusive à noite", () => {
  // 21:30 no horário local: em UTC-3 a data UTC já seria o dia seguinte.
  const lateEvening = new Date(2026, 9, 9, 21, 30);
  assert.equal(getLocalDateKey(lateEvening), "2026-10-09");
  assert.equal(isSlideScheduleActive({ schedule: { endDate: "2026-10-09" } }, lateEvening), true);
  assert.equal(isSlideScheduleActive({ schedule: { startDate: "2026-10-10" } }, lateEvening), false);
  assert.equal(isSlideScheduleActive({ schedule: { endDate: "2026-10-08" } }, lateEvening), false);
});

test("o horário do agendamento respeita intervalo comum e noturno", () => {
  const at = (hours: number, minutes = 0) => new Date(2026, 9, 9, hours, minutes);
  const business = { schedule: { startTime: "08:00", endTime: "18:00" } };
  assert.equal(isSlideScheduleActive(business, at(7, 59)), false);
  assert.equal(isSlideScheduleActive(business, at(8)), true);
  assert.equal(isSlideScheduleActive(business, at(18)), false);
  const overnight = { schedule: { startTime: "22:00", endTime: "06:00" } };
  assert.equal(isSlideScheduleActive(overnight, at(23)), true);
  assert.equal(isSlideScheduleActive(overnight, at(5, 59)), true);
  assert.equal(isSlideScheduleActive(overnight, at(12)), false);
  assert.equal(isSlideScheduleActive({}, at(12)), true);
});

test("a publicação leva só os slides ativos da unidade, na ordem da playlist", () => {
  const slides = [
    slide({ id: "c", order: 2 }),
    slide({ id: "a", order: 0 }),
    slide({ id: "pausado", order: 1, isActive: false }),
    slide({ id: "outra", order: 0, kioskIds: ["k2"], screenIds: ["k2"] }),
  ];
  assert.deepEqual(buildPublishedSlides("k1", slides).map((item) => item.id), ["a", "c"]);
});

test("o estado da publicação detecta o que ainda não chegou à tela", () => {
  const slides = [slide({ id: "a", order: 0 }), slide({ id: "b", order: 1 })];
  const published = { slides: buildPublishedSlides("k1", slides) };

  assert.equal(getPublicationState("k1", slides, null), "never");
  assert.equal(getPublicationState("k1", slides, published), "current");
  // Renumerar sem mudar a sequência não exige publicar de novo.
  assert.equal(
    getPublicationState("k1", [slide({ id: "a", order: 5 }), slide({ id: "b", order: 9 })], published),
    "current",
  );
  assert.equal(
    getPublicationState("k1", [slide({ id: "b", order: 0 }), slide({ id: "a", order: 1 })], published),
    "outdated",
  );
  assert.equal(getPublicationState("k1", [slides[0]], published), "outdated");
  assert.equal(
    getPublicationState("k1", [slides[0], slide({ id: "b", order: 1, durationMs: 20_000 })], published),
    "outdated",
  );
  assert.equal(
    getPublicationState("k1", [slides[0], slide({ id: "b", order: 1, isActive: false })], published),
    "outdated",
  );
});

test("duração formatada em minutos e segundos", () => {
  assert.equal(formatSignageDuration(10_000), "00:10");
  assert.equal(formatSignageDuration(95_000), "01:35");
});

test("cada tela tem a própria sequência; sem posição própria vale a ordem geral", () => {
  const slides = [
    slide({ id: "a", order: 0, screenIds: ["k1", "vitrine"], orderByScreen: { vitrine: 2 } }),
    slide({ id: "b", order: 1, screenIds: ["k1", "vitrine"], orderByScreen: { vitrine: 0 } }),
    slide({ id: "c", order: 2, screenIds: ["vitrine"], orderByScreen: { vitrine: 1 } }),
  ];
  assert.deepEqual(getScreenSlides(slides, "k1").map((item) => item.id), ["a", "b"]);
  assert.deepEqual(getScreenSlides(slides, "vitrine").map((item) => item.id), ["b", "c", "a"]);
  assert.deepEqual(buildPublishedSlides("vitrine", slides).map((item) => [item.id, item.order]), [["b", 0], ["c", 1], ["a", 2]]);
});

test("slide anterior às telas pertence à tela padrão da unidade", () => {
  assert.deepEqual(getSlideScreenIds({ kioskIds: ["k1", "k2"] }), ["k1", "k2"]);
  assert.deepEqual(getSlideScreenIds({ kioskIds: ["k1"], screenIds: [] }), ["k1"]);
  assert.deepEqual(getSlideScreenIds({ kioskIds: ["k1"], screenIds: ["vitrine"] }), ["vitrine"]);
});

test("editar preserva telas fora do acesso e recusa incluir tela alheia", () => {
  const canAccess = (screenId: string) => screenId.startsWith("minha");
  // Quem edita tira "minha-1" e não menciona "outra": ela continua no slide.
  assert.deepEqual(
    mergeSlideScreenIds({ requested: ["minha-2"], current: ["minha-1", "outra"], canAccess }),
    { screenIds: ["minha-2", "outra"], forbidden: [] },
  );
  // Tentar vincular uma tela de unidade alheia é recusado.
  assert.deepEqual(
    mergeSlideScreenIds({ requested: ["minha-1", "alheia"], current: ["minha-1"], canAccess }).forbidden,
    ["alheia"],
  );
  // Reenviar uma tela alheia que já estava no slide não é uma inclusão.
  assert.deepEqual(
    mergeSlideScreenIds({ requested: ["minha-1", "outra"], current: ["minha-1", "outra"], canAccess }),
    { screenIds: ["minha-1", "outra"], forbidden: [] },
  );
});

test("posições de telas que deixaram de exibir o slide são descartadas", () => {
  assert.deepEqual(pruneOrderByScreen({ a: 1, b: 2 }, ["b"]), { b: 2 });
  assert.equal(pruneOrderByScreen({ a: 1 }, ["b"]), undefined);
  assert.equal(pruneOrderByScreen(undefined, ["b"]), undefined);
});

test("entradas das rotas recusam campos fora da lista e mídia fora da pasta do signage", () => {
  const base = { title: "Promo", type: "image", durationMs: 10_000, order: 0, screenIds: ["k1"], isActive: true, assetPath: "signage/1-promo.png", assetKind: "image" };
  assert.equal(signageSlideSchema.safeParse(base).success, true);
  for (const forged of ["kioskIds", "createdBy", "updatedAt", "assetUrl"]) {
    assert.equal(signageSlideSchema.safeParse({ ...base, [forged]: ["x"] }).success, false);
  }
  for (const assetPath of ["assets/logo.png", "signage/../assets/logo.png", "signage/a/b.png", "/signage/x.png"]) {
    assert.equal(signageSlideSchema.safeParse({ ...base, assetPath }).success, false);
  }
  assert.equal(signageSlideSchema.safeParse({ ...base, screenIds: [] }).success, false);
  assert.equal(signageSlideSchema.safeParse({ ...base, screenIds: ["a/b"] }).success, false);

  assert.equal(signagePublishSchema.safeParse({ screenIds: ["k1"] }).success, true);
  assert.equal(signagePublishSchema.safeParse({ screenIds: ["k1"], kioskIds: ["k2"] }).success, false);
  assert.equal(signageScreenCreateSchema.safeParse({ kioskId: "k1", name: "Vitrine", deviceToken: "AAAA2222" }).success, false);
  assert.equal(signageScreenUpdateSchema.safeParse({}).success, false);
  assert.equal(signageScreenUpdateSchema.safeParse({ token: "rotate" }).success, true);
  assert.equal(signageScreenUpdateSchema.safeParse({ deviceToken: "AAAA2222" }).success, false);
  assert.equal(signageHeartbeatSchema.safeParse({ status: "cache" }).success, false);
  assert.equal(signageHeartbeatSchema.safeParse({ kioskId: "k1", status: "cache" }).success, true);
});

test("rotas do signage ligam leitura e escrita ao escopo da unidade e ao código da tela", async () => {
  const root = new URL("../../", import.meta.url);
  const read = (path: string) => readFile(new URL(path, root), "utf8");
  const [slides, slide, publish, heartbeat, published, screens, screen] = await Promise.all([
    read("src/app/api/signage/slides/route.ts"),
    read("src/app/api/signage/slides/[slideId]/route.ts"),
    read("src/app/api/signage/publish/route.ts"),
    read("src/app/api/signage/heartbeat/route.ts"),
    read("src/app/api/signage/public/[kioskId]/route.ts"),
    read("src/app/api/signage/screens/route.ts"),
    read("src/app/api/signage/screens/[screenId]/route.ts"),
  ]);
  for (const source of [slides, publish, screens, screen]) assert.match(source, /assertSignageKioskAccess\(actor, /);
  assert.match(slides, /canAccessSignageKiosk\(security\.resource, kioskId\)/);
  assert.match(slide, /mergeSlideScreenIds\(/);
  assert.match(slide, /kioskIds\.some\(\(kioskId\) => !canAccessSignageKiosk\(actor, kioskId\)\)/);
  assert.match(heartbeat, /requirePlayerScreen\(.*request\.headers\.get\('x-device-token'\)/);
  assert.match(heartbeat, /canAccessSignageKiosk\(security\.resource, /);
  assert.match(published, /requirePlayerScreen\(requireRouteId\(kioskId, 'Tela'\), token\)/);
  assert.match(screen, /screen\.isDefault/);
});
