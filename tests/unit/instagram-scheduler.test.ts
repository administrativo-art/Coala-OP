import assert from "node:assert/strict";
import test from "node:test";

import { instagramScheduleInputSchema } from "../../src/features/instagram-scheduler/contracts";
import { resolveSafeReturnPath } from "../../src/lib/safe-return-path";

const future = "2030-01-02T13:00:00.000Z";

function image(name = "post.jpg") {
  return {
    localPath: `/tmp/${name}`,
    kind: "image" as const,
    contentType: "image/jpeg",
    fileName: name,
    sizeBytes: 1_024,
    width: 1080,
    height: 1350,
  };
}

function video(name = "reel.mp4") {
  return {
    localPath: `/tmp/${name}`,
    kind: "video" as const,
    contentType: "video/mp4",
    fileName: name,
    sizeBytes: 5_000,
  };
}

test("valida as combinações de mídia dos quatro formatos", () => {
  assert.equal(instagramScheduleInputSchema.safeParse({ format: "feed_image", scheduledAt: future, media: [image()] }).success, true);
  assert.equal(instagramScheduleInputSchema.safeParse({ format: "carousel", scheduledAt: future, media: [image("1.jpg"), video()] }).success, true);
  assert.equal(instagramScheduleInputSchema.safeParse({ format: "reel", scheduledAt: future, media: [video()] }).success, true);
  assert.equal(instagramScheduleInputSchema.safeParse({ format: "story", scheduledAt: future, media: [image()] }).success, true);
});

test("rejeita feed com vídeo, reel com imagem e carrossel com uma mídia", () => {
  assert.equal(instagramScheduleInputSchema.safeParse({ format: "feed_image", scheduledAt: future, media: [video()] }).success, false);
  assert.equal(instagramScheduleInputSchema.safeParse({ format: "reel", scheduledAt: future, media: [image()] }).success, false);
  assert.equal(instagramScheduleInputSchema.safeParse({ format: "carousel", scheduledAt: future, media: [image()] }).success, false);
});

test("limita a legenda ao máximo aceito pelo Instagram", () => {
  const result = instagramScheduleInputSchema.safeParse({
    format: "feed_image",
    scheduledAt: future,
    media: [image()],
    caption: "a".repeat(2_201),
  });
  assert.equal(result.success, false);
});

test("aceita localização da Meta e rejeita imagem fora da proporção do feed", () => {
  const valid = instagramScheduleInputSchema.safeParse({
    format: "feed_image",
    scheduledAt: future,
    media: [image()],
    location: { id: "755878304532279", name: "Shopping do Automóvel · São Luís – MA" },
  });
  assert.equal(valid.success, true);

  const invalidImage = { ...image(), width: 600, height: 1_200 };
  assert.equal(instagramScheduleInputSchema.safeParse({
    format: "feed_image",
    scheduledAt: future,
    media: [invalidImage],
  }).success, false);
});

test("aceita somente destinos internos seguros depois do login", () => {
  assert.equal(resolveSafeReturnPath("/instagram-programacao"), "/instagram-programacao");
  assert.equal(resolveSafeReturnPath("https://example.com"), "/dashboard");
  assert.equal(resolveSafeReturnPath("//example.com"), "/dashboard");
  assert.equal(resolveSafeReturnPath("/\\example.com"), "/dashboard");
});
