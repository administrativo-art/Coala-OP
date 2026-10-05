import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { instagramScheduleMutationSchema } from "../../src/features/instagram-scheduler/contracts";
import { canReplaceInstagramCaption, isInstagramScheduleEditableStatus } from "../../src/features/instagram-scheduler/schedule-mutation-policy";
import { carouselHasDifferentRatios, isFeedImageRatio, mediaCompatibility, mediaDimensionsLabel, mediaPreviewRatio, mediaRatio } from "../../src/features/instagram-scheduler/media-presentation";

const square = { kind: "image" as const, width: 1254, height: 1254 };
const portrait = { kind: "image" as const, width: 1080, height: 1350 };
const story = { kind: "image" as const, width: 1080, height: 1920 };

test("a imagem quadrada dos Clássicos permanece 1:1, sem o corte artificial em 4:5", () => {
  assert.equal(mediaPreviewRatio("feed_image", square), 1);
  assert.equal(mediaDimensionsLabel(square), "1254 × 1254 px · 1:1 · quadrada");
  assert.equal(mediaCompatibility("feed_image", square).status, "compatible");
  assert.equal(mediaPreviewRatio("feed_image", portrait), 0.8);
  assert.equal(mediaPreviewRatio("feed_image", { width: 1910, height: 1000 }), 1.91);
});

test("limites de Feed coincidem com o contrato do agendador", () => {
  for (const ratio of [0.8, 1, 1.91]) assert.equal(isFeedImageRatio(ratio), true);
  for (const ratio of [0.7999, 1.9101, 0, NaN, Infinity]) assert.equal(isFeedImageRatio(ratio), false);
  assert.equal(mediaCompatibility("feed_image", story).status, "invalid");
  assert.equal(mediaCompatibility("reel", square).status, "invalid");
  assert.equal(mediaCompatibility("feed_image", { ...square, kind: "video" }).status, "invalid");
});

test("dimensões ausentes, zero e valores inválidos não viram compatibilidade confirmada", () => {
  for (const media of [{}, { width: 0, height: 100 }, { width: 100, height: null }, { width: Infinity, height: 100 }]) {
    assert.equal(mediaRatio(media), null);
    assert.equal(mediaCompatibility("feed_image", { ...media, kind: "image" }).status, "unknown");
  }
});

test("Stories e Reels usam janela 9:16 e avisam quando a mídia exige margens", () => {
  assert.equal(mediaPreviewRatio("story", square), 9 / 16);
  assert.equal(mediaPreviewRatio("reel", square), 9 / 16);
  assert.equal(mediaCompatibility("story", square).status, "warning");
  assert.equal(mediaCompatibility("story", story).status, "compatible");
  assert.match(mediaCompatibility("reel", { ...story, kind: "video" }).message, /codec não verificados/);
  assert.equal(mediaCompatibility("carousel", { ...square, kind: "video" }).status, "warning");
});

test("carrossel segue a primeira mídia e identifica proporções diferentes", () => {
  assert.equal(mediaPreviewRatio("carousel", portrait, square), 1);
  assert.equal(mediaPreviewRatio("carousel", square, portrait), 0.8);
  assert.equal(carouselHasDifferentRatios([square, portrait]), true);
  assert.equal(carouselHasDifferentRatios([square, { width: 1080, height: 1080 }]), false);
  assert.equal(carouselHasDifferentRatios([{}, square]), false);
});

test("legenda pode mudar sozinha, ser apagada ou acompanhar o reagendamento", () => {
  for (const caption of ["Nova legenda\nCom acentos e 😍", "", "a".repeat(2200)]) {
    assert.deepEqual(instagramScheduleMutationSchema.parse({ caption }), { caption });
  }
  assert.equal(instagramScheduleMutationSchema.safeParse({ caption: "a".repeat(2201) }).success, false);
  assert.equal(instagramScheduleMutationSchema.safeParse({ caption: null }).success, false);
  assert.equal(instagramScheduleMutationSchema.safeParse({ caption: "Texto", scheduledAt: "2026-12-20T17:00:00-03:00" }).success, true);
  assert.equal(instagramScheduleMutationSchema.safeParse({ caption: "Texto", cancel: true }).success, false);
});

test("não descarta contêiner após início da publicação nem resultado ambíguo", () => {
  assert.equal(canReplaceInstagramCaption(undefined), true);
  assert.equal(canReplaceInstagramCaption({ parentContainerId: "prepared" }), true);
  assert.equal(canReplaceInstagramCaption({ publishRequestStartedAt: "started" }), false);
  assert.equal(canReplaceInstagramCaption({ publishedMediaId: "published" }), false);
  assert.equal(canReplaceInstagramCaption({ storyItems: [{ publishRequestStartedAt: "started" }] }), false);
  assert.equal(canReplaceInstagramCaption({ storyItems: [{ publishedMediaId: "published" }] }), false);
  for (const status of ["published", "processing", "failed", "cancelled"]) assert.equal(isInstagramScheduleEditableStatus(status), false);
  for (const status of ["scheduled", "paused"]) assert.equal(isInstagramScheduleEditableStatus(status), true);
});

test("editor e criação conectam a proporção calculada ao viewport, sem 4:5 fixo", () => {
  const editor = readFileSync("src/features/instagram-scheduler/schedule-post-editor.tsx", "utf8");
  const create = readFileSync("src/features/instagram-scheduler/create-schedule-dialog.tsx", "utf8");
  assert.match(editor, /aspectRatio: mediaPreviewRatio\(item.format, activeMedia, orderedMedia\[0\]\)/);
  assert.match(create, /aspectRatio: mediaPreviewRatio\(format, dimensions\[activeIndex\], dimensions\[0\]\)/);
  assert.doesNotMatch(editor, /aspect-\[4\/5\]/);
  assert.match(editor, /captionChanged \? \{ caption \}/);
  assert.match(editor, /textarea aria-labelledby="editor-caption-title" value=\{caption\}/);
  const route = readFileSync("src/app/api/integrations/instagram/schedule/[id]/route.ts", "utf8");
  assert.match(route, /requireEditable\(target\)/);
  assert.match(route, /updates.caption = payload.data.caption/);
  assert.match(route, /updates.progress = FieldValue.delete\(\)/);
  assert.match(route, /type: "caption_updated"/);
});
