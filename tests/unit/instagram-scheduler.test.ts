import assert from "node:assert/strict";
import test from "node:test";

import {
  hasAmbiguousInstagramPublish,
  normalizeInstagramStoryProgress,
} from "../../functions/src/instagram-story-sequence";
import {
  instagramContentSnapshotStage,
  instagramSnapshotWindows,
  parseInstagramSnapshotTotals,
  parseInstagramStorySnapshot,
} from "../../functions/src/instagram-insights-snapshot";

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
  mergeReachSeries,
  parseAccountInsightTotals,
  parseContentInsight,
  parseFollowerDemographics,
  parseReachSeries,
  parseViewsByFollowType,
  sumAccountInsightTotals,
  sumViewsByFollowType,
} from "../../src/features/instagram-scheduler/instagram-insights";
import {
  aggregateBusinessSuiteHistory,
  instagramInsightsPeriodDays,
  parseBusinessSuiteCsv,
} from "../../src/features/instagram-scheduler/business-suite-insights";
import {
  buildInstagramInsightReading,
  publicBioMetric,
  summarizeInstagramContentFormats,
  summarizeInstagramHistoryCoverage,
} from "../../src/features/instagram-scheduler/insights-view-model";
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

test("normaliza totais e série diária devolvidos pela Meta sem transformar ausência em zero", () => {
  const totals = parseAccountInsightTotals({ data: [
    { name: "views", total_value: { value: 1234 } },
    { name: "reach", total_value: { value: 876 } },
    { name: "follows_and_unfollows", total_value: { value: 8, breakdowns: [{ results: [
      { dimension_values: ["FOLLOWER"], value: 11 },
      { dimension_values: ["NON_FOLLOWER"], value: 3 },
    ] }] } },
  ] });
  assert.equal(totals.views, 1234);
  assert.equal(totals.reach, 876);
  assert.equal(totals.follows, 11);
  assert.equal(totals.unfollows, 3);
  assert.equal(totals.saves, null);

  assert.deepEqual(parseReachSeries({ data: [{ name: "reach", values: [
    { value: 14, end_time: "2026-09-30T07:00:00+0000" },
    { value: 21, end_time: "2026-10-01T07:00:00+0000" },
  ] }] }), [
    { date: "2026-09-30", value: 14 },
    { date: "2026-10-01", value: 21 },
  ]);
});

test("soma janelas da Meta e preserva métricas ausentes", () => {
  const first = parseAccountInsightTotals({ data: [
    { name: "views", total_value: { value: 120 } },
    { name: "reach", total_value: { value: 80 } },
  ] });
  const second = parseAccountInsightTotals({ data: [
    { name: "views", total_value: { value: 30 } },
    { name: "reach", total_value: { value: 20 } },
  ] });

  const totals = sumAccountInsightTotals([first, second]);
  assert.equal(totals.views, 150);
  assert.equal(totals.reach, 100);
  assert.equal(totals.saves, null);

  assert.deepEqual(mergeReachSeries([
    [{ date: "2026-09-30", value: 10 }, { date: "2026-10-01", value: 20 }],
    [{ date: "2026-09-01", value: 5 }, { date: "2026-09-30", value: 2 }],
  ]), [
    { date: "2026-09-01", value: 5 },
    { date: "2026-09-30", value: 12 },
    { date: "2026-10-01", value: 20 },
  ]);
});

test("interpreta quebras de visualizações e dados demográficos agregados", () => {
  const viewTypes = parseViewsByFollowType({ data: [{
    name: "views",
    total_value: { breakdowns: [{
      dimension_keys: ["follow_type"],
      results: [
        { dimension_values: ["FOLLOWER"], value: 84 },
        { dimension_values: ["NON_FOLLOWER"], value: 116 },
      ],
    }] },
  }] });
  assert.deepEqual(viewTypes, { followers: 84, nonFollowers: 116 });
  assert.deepEqual(sumViewsByFollowType([viewTypes, { followers: 5, nonFollowers: null }]), {
    followers: 89,
    nonFollowers: 116,
  });

  assert.deepEqual(parseFollowerDemographics({ data: [{
    name: "follower_demographics",
    total_value: { breakdowns: [{
      dimension_keys: ["age", "gender"],
      results: [
        { dimension_values: ["18-24", "F"], value: 25 },
        { dimension_values: ["18-24", "M"], value: 11 },
      ],
    }] },
  }] }, ["age", "gender"]), [
    { dimensions: { age: "18-24", gender: "F" }, value: 25 },
    { dimensions: { age: "18-24", gender: "M" }, value: 11 },
  ]);
  assert.equal(parseFollowerDemographics({ data: [] }, ["city"]), null);
});

test("distingue ausência de coleta da bio de um zero medido", () => {
  const empty = {
    pageViews: 0,
    linkClicks: 0,
    galleryOpens: 0,
    clickThroughRate: null,
    daily: [],
    topLinks: [],
  };
  assert.equal(publicBioMetric(empty, "pageViews"), null);

  const measured = { ...empty, daily: [{ date: "2026-10-01", pageViews: 0, linkClicks: 0 }] };
  assert.equal(publicBioMetric(measured, "pageViews"), 0);
});

test("resume a cobertura histórica sem contar datas duplicadas", () => {
  const totals = parseAccountInsightTotals({ data: [] });
  assert.deepEqual(summarizeInstagramHistoryCoverage([
    { date: "2026-09-30", followersCount: null, mediaCount: null, settled: true, totals, businessSuite: null },
    { date: "2026-10-01", followersCount: 254, mediaCount: 14, settled: false, totals, businessSuite: null },
    { date: "2026-10-01", followersCount: 254, mediaCount: 14, settled: false, totals, businessSuite: null },
  ], 7), {
    capturedDays: 2,
    firstDate: "2026-09-30",
    lastDate: "2026-10-01",
    complete: false,
  });
});

test("lê o CSV oficial do Meta Business Suite e rejeita título incompatível", () => {
  const csv = '\uFEFFsep=,\r\n"Visualizações"\r\n"Data","Primary"\r\n"2026-01-01T00:00:00","5"\r\n"2026-01-02T00:00:00","115"\r\n';
  assert.deepEqual([...parseBusinessSuiteCsv(csv, "views")], [
    ["2026-01-01", 5],
    ["2026-01-02", 115],
  ]);
  assert.throws(() => parseBusinessSuiteCsv(csv, "reach"), /não corresponde/);
});

test("agrega o histórico do Business Suite e calcula o período anual", () => {
  const totals = parseAccountInsightTotals({ data: [] });
  const businessSuite = { views: 5, reach: 4, contentInteractions: 2, profileVisits: 1, profileLinkClicks: 0, followers: 1 };
  const aggregated = aggregateBusinessSuiteHistory([
    { date: "2026-01-01", followersCount: null, mediaCount: null, settled: true, totals, businessSuite },
    { date: "2026-01-02", followersCount: null, mediaCount: null, settled: true, totals, businessSuite: { ...businessSuite, views: 10 } },
  ]);
  assert.deepEqual(aggregated, { views: 15, reach: 8, contentInteractions: 4, profileVisits: 2, profileLinkClicks: 0, followers: 2, coveredDays: 2 });
  assert.equal(instagramInsightsPeriodDays("year", new Date("2026-10-01T20:00:00.000Z")), 274);
});

test("monta as três janelas diárias que o coletor reapura", () => {
  assert.deepEqual(instagramSnapshotWindows(new Date("2026-10-01T16:00:00.000Z")), [
    { date: "2026-10-01", since: "1790823600", until: "1790870400", current: true, settled: false },
    { date: "2026-09-30", since: "1790737200", until: "1790823599", current: false, settled: false },
    { date: "2026-09-29", since: "1790650800", until: "1790737199", current: false, settled: true },
  ]);
});

test("normaliza o retrato preservável de Story sem guardar URL de mídia temporária", () => {
  const story = parseInstagramStorySnapshot({
    id: "story_1",
    caption: "Oferta do dia",
    media_type: "VIDEO",
    media_url: "https://cdn.example.com/temporary.mp4",
    permalink: "https://www.instagram.com/stories/coalashakes/1/",
    timestamp: "2026-10-01T12:00:00+0000",
  }, { data: [
    { name: "views", values: [{ value: 90 }] },
    { name: "reach", values: [{ value: 72 }] },
    { name: "link_clicks", values: [{ value: 5 }] },
    { name: "profile_activity", total_value: { value: 7, breakdowns: [{ results: [
      { dimension_values: ["BIO_LINK_CLICKED"], value: 4 },
    ] }] } },
  ] });
  assert.equal(story?.views, 90);
  assert.equal(story?.bioLinkClicks, 4);
  assert.equal(story?.storyLinkClicks, 5);
  assert.equal("mediaUrl" in (story ?? {}), false);
});

test("seleciona marcos de 48 horas, 7 dias e 30 dias para conteúdo", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  assert.equal(instagramContentSnapshotStage("2026-09-30T12:00:00.000Z", now), "first48h");
  assert.equal(instagramContentSnapshotStage("2026-09-24T11:00:00.000Z", now), "day7");
  assert.equal(instagramContentSnapshotStage("2026-09-01T11:00:00.000Z", now), "day30");
  assert.equal(instagramContentSnapshotStage("2026-09-20T12:00:00.000Z", now), null);

  const totals = parseInstagramSnapshotTotals({ data: [
    { name: "views", total_value: { value: 100 } },
    { name: "follows_and_unfollows", total_value: { breakdowns: [{ results: [
      { dimension_values: ["FOLLOWER"], value: 8 },
      { dimension_values: ["NON_FOLLOWER"], value: 2 },
    ] }] } },
  ] });
  assert.equal(totals.views, 100);
  assert.equal(totals.follows, 8);
  assert.equal(totals.unfollows, 2);
});

test("normaliza insights de conteúdo e identifica clique na bio atribuído a Story", () => {
  const item = parseContentInsight({
    id: "story-1",
    media_type: "VIDEO",
    timestamp: "2026-10-01T12:00:00+0000",
    media_url: "https://cdn.example.com/story.mp4",
  }, { data: [
    { name: "views", values: [{ value: 90 }] },
    { name: "reach", values: [{ value: 72 }] },
    { name: "link_clicks", values: [{ value: 5 }] },
    { name: "profile_activity", total_value: { value: 7, breakdowns: [{ results: [
      { dimension_values: ["BIO_LINK_CLICKED"], value: 4 },
      { dimension_values: ["EMAIL"], value: 3 },
    ] }] } },
  ] }, { story: true });
  assert.equal(item?.format, "Story");
  assert.equal(item?.views, 90);
  assert.equal(item?.storyLinkClicks, 5);
  assert.equal(item?.bioLinkClicks, 4);
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

test("transforma métricas do Instagram em uma leitura acionável sem inventar comparação", () => {
  const reading = buildInstagramInsightReading({
    range: { period: "year", days: 274, since: "2026-01-01T03:00:00.000Z", until: "2026-10-01T03:00:00.000Z" },
    profile: { username: "coalashakes", profilePictureUrl: null, followersCount: 254, mediaCount: 14 },
    totals: {
      views: 16_549,
      reach: null,
      accountsEngaged: null,
      totalInteractions: 438,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      replies: null,
      reposts: null,
      follows: 129,
      unfollows: null,
    },
    viewsByFollowType: { followers: null, nonFollowers: null },
    reachSeries: [
      { date: "2026-09-29", value: 84 },
      { date: "2026-09-30", value: 131 },
    ],
    businessSuiteTotals: {
      views: 16_549,
      reach: 5_737,
      contentInteractions: 438,
      profileVisits: 1_247,
      profileLinkClicks: 0,
      followers: 129,
      coveredDays: 274,
    },
    content: [{
      id: "post-1",
      format: "Reel",
      caption: "Produto em destaque",
      previewUrl: null,
      permalink: null,
      publishedAt: "2026-09-30T12:00:00.000Z",
      views: 500,
      reach: 300,
      totalInteractions: 30,
      likes: 24,
      comments: 2,
      shares: 3,
      saves: 1,
      replies: null,
      bioLinkClicks: null,
      storyLinkClicks: null,
    }],
    activeStories: [],
    history: { daily: [], stories: [], contentSnapshots: [] },
    bio: { pageViews: 0, linkClicks: 0, galleryOpens: 0, clickThroughRate: null, daily: [], topLinks: [] },
    notices: [],
  });

  assert.deepEqual(reading.discovery, { value: 131, date: "2026-09-30" });
  assert.equal(Number(reading.interactionsPerHundredViews?.toFixed(2)), 2.65);
  assert.equal(reading.profileClickRate, 0);
  assert.equal(reading.topContent?.id, "post-1");
  assert.match(reading.recommendation, /nenhum clique/i);
});

test("resume resposta por formato preservando métricas indisponíveis", () => {
  const base = {
    caption: "",
    previewUrl: null,
    permalink: null,
    publishedAt: "2026-09-30T12:00:00.000Z",
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    replies: null,
    bioLinkClicks: null,
    storyLinkClicks: null,
  };
  const summary = summarizeInstagramContentFormats([
    { ...base, id: "feed-1", format: "Feed", views: 100, reach: 80, totalInteractions: 10 },
    { ...base, id: "feed-2", format: "Feed", views: 50, reach: 40, totalInteractions: 4 },
    { ...base, id: "reel-1", format: "Reel", views: 500, reach: 300, totalInteractions: null },
  ]);

  assert.equal(summary[0]?.format, "Feed");
  assert.deepEqual(summary[0], {
    format: "Feed",
    contentCount: 2,
    views: 150,
    reach: 120,
    interactions: 14,
    averageInteractions: 7,
  });
  assert.equal(summary[1]?.interactions, null);
  assert.equal(summary[1]?.averageInteractions, null);
});

test("a mutação do agendamento aceita somente cancelamento estrito", () => {
  assert.equal(instagramScheduleMutationSchema.safeParse({ cancel: true }).success, true);
  assert.equal(instagramScheduleMutationSchema.safeParse({ cancel: false }).success, false);
  assert.equal(instagramScheduleMutationSchema.safeParse({ cancel: true, scheduledAt: "2026-10-05T10:00:00-03:00" }).success, false);
  assert.equal(instagramScheduleMutationSchema.safeParse({}).success, false);
});

test("somente agendamentos em scheduled podem ser cancelados", () => {
  assert.equal(isInstagramScheduleEditableStatus("scheduled"), true);
  for (const status of ["processing", "published", "failed", "manual_review", "cancelled"]) {
    assert.equal(isInstagramScheduleEditableStatus(status), false, status);
  }
});
