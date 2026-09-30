import assert from "node:assert/strict";
import test from "node:test";

import {
  hasAmbiguousInstagramPublish,
  normalizeInstagramStoryProgress,
} from "../../functions/src/instagram-story-sequence";

import {
  instagramMediaLibraryFolderSchema,
  instagramScheduleInputSchema,
  instagramScheduleMutationSchema,
} from "../../src/features/instagram-scheduler/contracts";
import {
  INSTAGRAM_SCHEDULE_MIN_LEAD_MS,
  hasPublishedInstagramStoryItem,
  isInstagramScheduleEditableStatus,
  isInstagramScheduleTimeAllowed,
  reorderInstagramStoryMedia,
} from "../../src/features/instagram-scheduler/schedule-mutation-policy";
import { maskScheduleTimeInput } from "../../src/features/instagram-scheduler/schedule-date-time-fields";
import {
  parseInstagramPublishedFeed,
  parseInstagramPublishedProfile,
} from "../../src/features/instagram-scheduler/published-feed";
import {
  calendarMonthKeys,
  dateKeyInBelem,
  moveScheduleToDate,
  minimumScheduleDateTimeInBelem,
  scheduleAtInBelem,
  startOfWeekKey,
} from "../../src/features/instagram-scheduler/workspace-utils";
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
  assert.equal(instagramScheduleInputSchema.safeParse({
    format: "story",
    scheduledAt: future,
    media: [image("story-1.jpg"), image("story-2.jpg"), video("story-3.mp4")],
  }).success, true);
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

test("aceita menção invisível em Story e normaliza o arroba", () => {
  const story = instagramScheduleInputSchema.parse({
    format: "story",
    scheduledAt: future,
    media: [image("story.jpg")],
    storyMentions: ["@shoppingdoautomovel_"],
  });
  assert.deepEqual(story.storyMentions, ["shoppingdoautomovel_"]);

  assert.equal(instagramScheduleInputSchema.safeParse({
    format: "feed_image",
    scheduledAt: future,
    media: [image()],
    storyMentions: ["shoppingdoautomovel_"],
  }).success, false);
});

test("limita uma sequência de Stories a dez mídias", () => {
  assert.equal(instagramScheduleInputSchema.safeParse({
    format: "story",
    scheduledAt: future,
    media: Array.from({ length: 10 }, (_, index) => image(`story-${index}.jpg`)),
  }).success, true);
  assert.equal(instagramScheduleInputSchema.safeParse({
    format: "story",
    scheduledAt: future,
    media: Array.from({ length: 11 }, (_, index) => image(`story-${index}.jpg`)),
  }).success, false);
});

test("aceita somente destinos internos seguros depois do login", () => {
  assert.equal(resolveSafeReturnPath("/instagram-programacao"), "/instagram-programacao");
  assert.equal(resolveSafeReturnPath("https://example.com"), "/dashboard");
  assert.equal(resolveSafeReturnPath("//example.com"), "/dashboard");
  assert.equal(resolveSafeReturnPath("/\\example.com"), "/dashboard");
});

test("aceita reagendamento, ordem de Story ou troca de datas, mas rejeita operações ambíguas", () => {
  assert.equal(instagramScheduleMutationSchema.safeParse({
    scheduledAt: "2030-05-12T10:30:00-03:00",
  }).success, true);
  assert.equal(instagramScheduleMutationSchema.safeParse({ mediaOrder: [2, 0, 1] }).success, true);
  assert.equal(instagramScheduleMutationSchema.safeParse({
    scheduledAt: "2030-05-12T10:30:00-03:00",
    mediaOrder: [2, 0, 1],
  }).success, true);
  assert.equal(instagramScheduleMutationSchema.safeParse({ swapWithId: "post_02" }).success, true);
  assert.equal(instagramScheduleMutationSchema.safeParse({
    scheduledAt: "2030-05-12T10:30:00-03:00",
    swapWithId: "post_02",
  }).success, false);
  assert.equal(instagramScheduleMutationSchema.safeParse({ swapWithId: "post/02" }).success, false);
  assert.equal(instagramScheduleMutationSchema.safeParse({}).success, false);
});

test("reordena Story somente quando a ordem é uma permutação completa", () => {
  assert.deepEqual(reorderInstagramStoryMedia(["a", "b", "c"], [2, 0, 1]), ["c", "a", "b"]);
  assert.equal(reorderInstagramStoryMedia(["a", "b", "c"], [0, 0, 2]), null);
  assert.equal(reorderInstagramStoryMedia(["a", "b", "c"], [0, 1]), null);
  assert.equal(reorderInstagramStoryMedia(["a", "b", "c"], [0, 1, 3]), null);
});

test("retoma uma sequência de Stories sem republicar itens já confirmados", () => {
  const progress = normalizeInstagramStoryProgress(3, {
    storyItems: [
      { containerId: "container-1", publishRequestStartedAt: 1, publishedMediaId: "story-1" },
      { containerId: "container-2" },
    ],
  });
  assert.equal(progress.storyItems.length, 3);
  assert.equal(progress.storyItems[0]?.publishedMediaId, "story-1");
  assert.equal(progress.storyItems[1]?.containerId, "container-2");
  assert.deepEqual(progress.storyItems[2], {});
  assert.equal(hasAmbiguousInstagramPublish(progress), false);

  progress.storyItems[1]!.publishRequestStartedAt = 2;
  assert.equal(hasAmbiguousInstagramPublish(progress), true);
  progress.storyItems[1]!.publishedMediaId = "story-2";
  assert.equal(hasAmbiguousInstagramPublish(progress), false);
});

test("migra o progresso legado de Story para o primeiro quadro", () => {
  const progress = normalizeInstagramStoryProgress(2, {
    parentContainerId: "legacy-container",
    publishRequestStartedAt: 1,
    publishedMediaId: "legacy-story",
  });
  assert.deepEqual(progress.storyItems[0], {
    containerId: "legacy-container",
    publishRequestStartedAt: 1,
    publishedMediaId: "legacy-story",
  });
  assert.deepEqual(progress.storyItems[1], {});
});

test("bloqueia edição depois que um quadro do Story já foi publicado", () => {
  assert.equal(hasPublishedInstagramStoryItem(undefined), false);
  assert.equal(hasPublishedInstagramStoryItem({ storyItems: [{ containerId: "pending" }] }), false);
  assert.equal(hasPublishedInstagramStoryItem({
    storyItems: [{ publishedMediaId: "story-1" }, {}],
  }), true);
});

test("permite mover somente conteúdo programado com antecedência mínima", () => {
  const now = Date.parse("2030-05-12T12:00:00.000Z");
  assert.equal(isInstagramScheduleEditableStatus("scheduled"), true);
  assert.equal(isInstagramScheduleEditableStatus("processing"), false);
  assert.equal(
    isInstagramScheduleTimeAllowed(new Date(now + INSTAGRAM_SCHEDULE_MIN_LEAD_MS), now),
    true,
  );
  assert.equal(
    isInstagramScheduleTimeAllowed(new Date(now + INSTAGRAM_SCHEDULE_MIN_LEAD_MS - 1), now),
    false,
  );
  assert.equal(isInstagramScheduleTimeAllowed(new Date("inválida"), now), false);
});

test("mantém data e horário no fuso de São Luís ao mover no calendário", () => {
  const original = "2030-05-12T10:30:00-03:00";
  assert.equal(dateKeyInBelem(original), "2030-05-12");
  assert.equal(startOfWeekKey("2030-05-12"), "2030-05-06");
  assert.equal(moveScheduleToDate(original, "2030-05-15"), "2030-05-15T10:30:00-03:00");
  assert.equal(scheduleAtInBelem("2030-05-15", "18:45"), "2030-05-15T18:45:00-03:00");
  assert.equal(scheduleAtInBelem("2030-05-15", "25:00"), "");
  assert.equal(calendarMonthKeys("2030-05-01").length, 35);
});

test("calcula o primeiro minuto disponível para agendamento em São Luís", () => {
  assert.deepEqual(
    minimumScheduleDateTimeInBelem(new Date("2030-05-12T23:56:38.000Z")),
    { date: "2030-05-12", time: "20:59" },
  );
  assert.deepEqual(
    minimumScheduleDateTimeInBelem(new Date("2030-05-13T02:59:30.000Z")),
    { date: "2030-05-13", time: "00:02" },
  );
});

test("formata o horário digitado como HH:MM", () => {
  assert.equal(maskScheduleTimeInput("2"), "2");
  assert.equal(maskScheduleTimeInput("2104"), "21:04");
  assert.equal(maskScheduleTimeInput("21h04"), "21:04");
  assert.equal(maskScheduleTimeInput("210499"), "21:04");
});

test("valida nomes de pasta da biblioteca sem aceitar caminhos", () => {
  assert.equal(instagramMediaLibraryFolderSchema.safeParse("Campanha São João").success, true);
  assert.equal(instagramMediaLibraryFolderSchema.safeParse("campanha/verão").success, false);
  assert.equal(instagramMediaLibraryFolderSchema.safeParse(" ").success, false);
});

test("normaliza imagens, carrosséis e reels recebidos da grade publicada", () => {
  const items = parseInstagramPublishedFeed({
    data: [
      {
        id: "image-1",
        media_type: "IMAGE",
        media_product_type: "FEED",
        media_url: "https://cdn.example/image.jpg",
        permalink: "https://www.instagram.com/p/image-1/",
        timestamp: "2026-09-29T12:00:00+0000",
        caption: "Imagem",
      },
      {
        id: "carousel-1",
        media_type: "CAROUSEL_ALBUM",
        media_product_type: "FEED",
        permalink: "https://www.instagram.com/p/carousel-1/",
        timestamp: "2026-09-30T12:00:00+0000",
        children: { data: [
          { media_type: "IMAGE", media_url: "https://cdn.example/one.jpg" },
          { media_type: "VIDEO", thumbnail_url: "https://cdn.example/two.jpg" },
        ] },
      },
      {
        id: "reel-1",
        media_type: "VIDEO",
        media_product_type: "REELS",
        media_url: "https://cdn.example/reel.mp4",
        thumbnail_url: "https://cdn.example/reel.jpg",
        permalink: "https://www.instagram.com/reel/reel-1/",
        timestamp: "2026-10-01T12:00:00+0000",
      },
      {
        id: "story-1",
        media_type: "IMAGE",
        media_product_type: "STORY",
        media_url: "https://cdn.example/story.jpg",
        permalink: "https://www.instagram.com/stories/story-1/",
        timestamp: "2026-10-02T12:00:00+0000",
      },
    ],
  });

  assert.deepEqual(items.map((item) => item.format), ["reel", "carousel", "feed_image"]);
  assert.equal(items[1]?.previewUrl, "https://cdn.example/one.jpg");
  assert.equal(items[1]?.childrenCount, 2);
  assert.equal(items[0]?.previewUrl, "https://cdn.example/reel.jpg");
});

test("descarta URLs inseguras da Meta e aplica perfil padrão", () => {
  const items = parseInstagramPublishedFeed({
    data: [{
      id: "unsafe",
      media_type: "IMAGE",
      media_url: "http://cdn.example/image.jpg",
      permalink: "https://www.instagram.com/p/unsafe/",
      timestamp: "2026-09-29T12:00:00Z",
    }],
  });
  assert.equal(items.length, 0);
  assert.deepEqual(parseInstagramPublishedProfile({ username: "", profile_picture_url: "javascript:alert(1)" }), {
    username: "coalashakes",
    profilePictureUrl: null,
  });
});
