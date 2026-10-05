import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInstagramPostFolderPath,
  expectedInstagramPostConfirmation,
  instagramPostActionSchema,
  instagramPostCreateSchema,
  instagramPostUpdateSchema,
} from "../../src/features/instagram-posts/contracts";
import {
  INSTAGRAM_PUBLICATION_RULES_VERSION,
  certifyInstagramPublication,
} from "../../src/features/instagram-scheduler/publication-readiness";

const ID = "11111111-1111-4111-8111-111111111111";
const HASH = "sha256:abc";

test("campanha e editorial recebem caminhos canônicos espelháveis", () => {
  assert.equal(buildInstagramPostFolderPath(ID, {
    title: "Dia das Crianças / Oferta",
    format: "feed_image",
    placement: { kind: "campaign", campaignPath: "03 - Campanhas/02 - Ativo/2026-10 | Dia das Crianças" },
  }), `03 - Campanhas/02 - Ativo/2026-10 | Dia das Crianças/03 - Instagram/Feed/${ID} · Dia das Crianças - Oferta`);
  assert.equal(buildInstagramPostFolderPath(ID, {
    title: "Relaxa",
    format: "story",
    placement: { kind: "editorial" },
  }), `09 - Instagram/02 - Editoriais/Posts/${ID} · Relaxa`);
});

test("caminho de campanha rejeita escape e taxonomia paralela", () => {
  const base = {
    clientMutationId: ID,
    title: "Teste",
    format: "feed_image",
    status: "planned",
    direction: "",
    caption: "",
    shareToFeed: true,
    storyMentions: [],
    publicationMode: "automatic",
    manualInstructions: "",
  } as const;
  assert.equal(instagramPostCreateSchema.safeParse({ ...base, placement: { kind: "campaign", campaignPath: "../fora" } }).success, false);
  assert.equal(instagramPostCreateSchema.safeParse({ ...base, placement: { kind: "campaign", campaignPath: "Campanhas/Outra" } }).success, false);
  assert.equal(instagramPostCreateSchema.safeParse({ ...base, placement: { kind: "editorial" } }).success, true);
  assert.equal(instagramPostCreateSchema.safeParse({ ...base, status: "produced", placement: { kind: "editorial" } }).success, false);
});

test("edição normal não aceita estado protegido nem muda pasta", () => {
  assert.equal(instagramPostUpdateSchema.safeParse({ status: "produced", caption: "Pronto" }).success, true);
  assert.equal(instagramPostUpdateSchema.safeParse({ status: "scheduled" }).success, false);
  assert.equal(instagramPostUpdateSchema.safeParse({ folderPath: "outra" }).success, false);
  assert.equal(instagramPostUpdateSchema.safeParse({ title: "Outro" }).success, false);
});

test("confirmações privilegiadas ficam ligadas a ação, post, hash e horário", () => {
  assert.equal(expectedInstagramPostConfirmation({ action: "approve_content", postId: ID, contentHash: HASH }), `APPROVE-CONTENT:${ID}:${HASH}`);
  assert.equal(expectedInstagramPostConfirmation({ action: "approve_publication", postId: ID, contentHash: HASH }), `APPROVE-PUBLICATION:${ID}:${HASH}`);
  assert.equal(expectedInstagramPostConfirmation({ action: "publish", postId: ID, contentHash: HASH }), `PUBLISH:${ID}:${HASH}`);
  assert.equal(expectedInstagramPostConfirmation({ action: "cancel", postId: ID, contentHash: HASH }), `CANCEL:${ID}`);
  assert.equal(expectedInstagramPostConfirmation({ action: "schedule", postId: ID, contentHash: HASH, scheduledAt: "2026-10-10T19:00:00-03:00" }), `SCHEDULE:${ID}:${HASH}:2026-10-10T19:00:00-03:00`);
});

test("ação privilegiada exige declaração e confirmação explícitas", () => {
  assert.equal(instagramPostActionSchema.safeParse({ action: "publish" }).success, false);
  assert.equal(instagramPostActionSchema.safeParse({
    action: "publish",
    authorization: { confirmation: `PUBLISH:${ID}:${HASH}`, statement: "Tiago autorizou este post nesta sessão." },
  }).success, true);
});

test("certifica Feed e bloqueia imagem fora dos limites técnicos", () => {
  const valid = certifyInstagramPublication({
    format: "feed_image",
    media: [{ kind: "image", contentType: "image/jpeg", sizeBytes: 2_000_000, width: 1080, height: 1350 }],
  });
  assert.equal(valid.status, "certified");
  assert.equal(valid.rulesVersion, INSTAGRAM_PUBLICATION_RULES_VERSION);

  const invalid = certifyInstagramPublication({
    format: "feed_image",
    media: [{ kind: "image", contentType: "image/png", sizeBytes: 2_000_000, width: 1080, height: 1920 }],
  });
  assert.equal(invalid.status, "blocked");
  assert.deepEqual(invalid.issues.map((item) => item.code), ["IMAGE_NOT_JPEG", "FEED_RATIO_INVALID"]);
});

test("certifica Reel 9:16 e identifica metadado incompatível", () => {
  const reel = {
    kind: "video" as const,
    contentType: "video/mp4",
    sizeBytes: 12_000_000,
    width: 1080,
    height: 1920,
    durationSeconds: 30,
    videoCodec: "avc1",
    audioCodec: "mp4a",
    frameRate: 30,
    videoBitrateBps: 8_000_000,
    audioSampleRateHz: 48_000,
    fastStart: true,
    hasEditList: false,
  };
  assert.equal(certifyInstagramPublication({ format: "reel", media: [reel] }).status, "certified");
  const invalid = certifyInstagramPublication({
    format: "reel",
    media: [{ ...reel, width: 1920, height: 1080, videoCodec: "vp09", frameRate: 20 }],
  });
  assert.equal(invalid.status, "blocked");
  assert.ok(invalid.issues.some((item) => item.code === "VERTICAL_VIDEO_RATIO_INVALID"));
  assert.ok(invalid.issues.some((item) => item.code === "VIDEO_CODEC_INVALID"));
  assert.ok(invalid.issues.some((item) => item.code === "VIDEO_FRAME_RATE_INVALID"));
});

test("Stories exigem 9:16 e carrossel mantém uma única proporção", () => {
  const story = certifyInstagramPublication({
    format: "story",
    media: [{ kind: "image", contentType: "image/jpeg", sizeBytes: 1_000_000, width: 1080, height: 1920 }],
  });
  assert.equal(story.status, "certified");

  const carousel = certifyInstagramPublication({
    format: "carousel",
    media: [
      { kind: "image", contentType: "image/jpeg", sizeBytes: 1_000_000, width: 1080, height: 1350 },
      { kind: "image", contentType: "image/jpeg", sizeBytes: 1_000_000, width: 1080, height: 1080 },
    ],
  });
  assert.equal(carousel.status, "blocked");
  assert.ok(carousel.issues.some((item) => item.code === "CAROUSEL_RATIO_MISMATCH"));
});
