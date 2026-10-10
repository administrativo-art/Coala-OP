import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  getNextSlide,
  nextSignageScreenName,
  parseSignagePairingCode,
  planNewSignageScreen,
  signageMobileScreenSchema,
  signagePairingUrl,
  isSlideScheduleActive,
  resolveActiveSlide,
  SIGNAGE_DEVICE_TOKEN_PATTERN,
  signageAppDownloadSchema,
  signageHeartbeatSchema,
  signageMediaFolderSchema,
  signageMediaUpdateSchema,
  signagePairSchema,
} from "../../src/lib/signage";
import { type SignageSchedule } from "../../src/types";

type Schedule = SignageSchedule | undefined;
type AppSlide = { id: string; type: string; durationMs?: number; assetUrl?: string; text?: string; schedule?: Schedule };
type Manifest = Record<string, { uri: string }>;
type Core = {
  CODE_ALPHABET: string;
  CODE_LENGTH: number;
  generateCode(randomByte: () => number): string;
  pairingPollDelayMs(elapsedMs: number): number;
  absoluteUrl(server: string, assetUrl: string): string;
  getAssetFileName(assetUrl: string): string;
  getNextSlide<T extends { id: string }>(slides: T[], id: string | null): T | null;
  getPlayableSlides(slides: AppSlide[], manifest: Manifest, now: Date, options?: { hasStore?: boolean; server?: string }): { slide: AppSlide; src: string | null }[];
  getSlideDurationMs(slide: { durationMs?: number }): number;
  isCompleteCode(code: string): boolean;
  isNewerPublication(current: { updatedAt?: string } | null, next: { updatedAt?: string } | null): boolean;
  isScheduleActive(slide: { schedule?: Schedule }, now: Date): boolean;
  msUntilHour(now: Date, hour: number): number;
  normalizeCode(input: string): string;
  planMediaSync(slides: AppSlide[], manifest: Manifest, server: string): { downloads: { fileName: string; url: string }[]; removals: string[]; total: number };
  resolveActiveSlide<T extends { id: string }>(slides: T[], id: string | null): T | null;
};

const core = createRequire(import.meta.url)("../../tizen/coala-signage/js/core.js") as Core;
const SERVER = "https://op.coalashakes.com";

test("app do monitor: agendamento igual ao do player web", () => {
  const schedules: Schedule[] = [
    undefined,
    { startTime: "08:00", endTime: "18:00" },
    { startTime: "22:00", endTime: "06:00" },
    { startTime: "12:00" },
    { endTime: "12:00" },
    { startDate: "2026-10-10", endDate: "2026-10-12" },
    { startDate: "2026-10-11" },
    { endDate: "2026-10-09" },
    { startDate: "2026-10-10", endDate: "2026-10-10", startTime: "09:00", endTime: "09:30" },
  ];
  const moments = [
    new Date(2026, 9, 9, 23, 59),
    new Date(2026, 9, 10, 0, 0),
    new Date(2026, 9, 10, 5, 59),
    new Date(2026, 9, 10, 6, 0),
    new Date(2026, 9, 10, 9, 15),
    new Date(2026, 9, 10, 12, 0),
    new Date(2026, 9, 10, 18, 0),
    new Date(2026, 9, 10, 22, 30),
    new Date(2026, 9, 12, 23, 59),
    new Date(2026, 9, 13, 0, 0),
  ];
  for (const schedule of schedules) {
    for (const now of moments) {
      assert.equal(
        core.isScheduleActive({ schedule }, now),
        isSlideScheduleActive({ schedule }, now),
        `${JSON.stringify(schedule)} em ${now.toISOString()}`,
      );
    }
  }
});

test("app do monitor: rotação igual à do player web", () => {
  const slides = [{ id: "a" }, { id: "b" }, { id: "c" }];
  for (const id of ["a", "b", "c", "fora", null]) {
    assert.deepEqual(core.getNextSlide(slides, id), getNextSlide(slides, id));
    assert.deepEqual(core.resolveActiveSlide(slides, id), resolveActiveSlide(slides, id));
  }
  assert.equal(core.getNextSlide([], "a"), null);
  assert.equal(core.resolveActiveSlide([], "a"), null);
  assert.equal(core.getSlideDurationMs({ durationMs: 500 }), 3000);
  assert.equal(core.getSlideDurationMs({}), 10000);
  assert.equal(core.getSlideDurationMs({ durationMs: 15000 }), 15000);
});

test("app do monitor: código de pareamento no mesmo formato do servidor", () => {
  assert.equal(core.CODE_LENGTH, 8);
  const full = core.CODE_ALPHABET.slice(0, 8);
  assert.ok(SIGNAGE_DEVICE_TOKEN_PATTERN.test(full));
  for (const char of core.CODE_ALPHABET) assert.ok(SIGNAGE_DEVICE_TOKEN_PATTERN.test(char.repeat(8)), char);

  assert.equal(core.normalizeCode("ab-c0 1dio"), "ABCD");
  assert.equal(core.normalizeCode("abcdefghjk"), "ABCDEFGH");
  assert.equal(core.isCompleteCode("ABCDEFGH"), true);
  assert.equal(core.isCompleteCode("ABCDEFG"), false);
  assert.equal(core.isCompleteCode("ABCDEFG1"), false);

  assert.equal(signagePairSchema.parse({ code: " abcdefgh " }).code, "ABCDEFGH");
  assert.equal(signagePairSchema.safeParse({ code: "ABCDEFG1" }).success, false);
  assert.equal(signagePairSchema.safeParse({ code: "ABCDEFGH", screenId: "x" }).success, false);
});

test("app do monitor: sorteia o código do QR code no formato do servidor", () => {
  let next = 0;
  const sequential = core.generateCode(() => next++);
  assert.equal(sequential, core.CODE_ALPHABET.slice(0, 8));
  for (const byte of [0, 31, 32, 200, 255]) {
    assert.ok(SIGNAGE_DEVICE_TOKEN_PATTERN.test(core.generateCode(() => byte)), String(byte));
  }
  // O QR code leva o endereço da página de aplicativos; o aplicativo tira dele só o código.
  const url = signagePairingUrl(`${SERVER}/`, sequential);
  assert.equal(url, `${SERVER}/app?tela=${sequential}`);
  assert.equal(parseSignagePairingCode(url), sequential);
  assert.equal(parseSignagePairingCode(`${url}&x=1`), sequential);
  assert.equal(parseSignagePairingCode(url.toLowerCase()), sequential);
  assert.equal(parseSignagePairingCode(`${SERVER}/app?tela=ABCDEFG1`), null);
  assert.equal(parseSignagePairingCode(`${SERVER}/app?tela=ABCDEFGHJ`), null);
  assert.equal(parseSignagePairingCode("https://exemplo.com/outro-qr"), null);
  // Consulta rápida enquanto alguém instala; lenta em monitor esquecido na tela de pareamento.
  assert.equal(core.pairingPollDelayMs(0), 15_000);
  assert.equal(core.pairingPollDelayMs(19 * 60_000), 15_000);
  assert.equal(core.pairingPollDelayMs(20 * 60_000), 60_000);
});

test("telas pelo aplicativo: numeração automática e entrada validada", () => {
  assert.equal(nextSignageScreenName([]), "Tela 1");
  assert.equal(nextSignageScreenName(["Tela 1", "tela 2 "]), "Tela 3");
  assert.equal(nextSignageScreenName(["Tela 1", "Tela 3", "Balcão"]), "Tela 2");
  // Unidade sem monitor: a primeira tela é a padrão, mesmo renomeada.
  assert.deepEqual(planNewSignageScreen([{ name: "Tela 1", isDefault: true }]), { name: "Tela 1", usesDefault: true, full: false });
  assert.deepEqual(planNewSignageScreen([{ name: "Balcão", isDefault: true }]), { name: "Balcão", usesDefault: true, full: false });
  assert.deepEqual(
    planNewSignageScreen([{ name: "Tela 1", isDefault: true, deviceToken: "ABCDEFGH" }, { name: "Tela 2", isDefault: false }]),
    { name: "Tela 3", usesDefault: false, full: false },
  );
  const twelve = Array.from({ length: 12 }, (_, index) => ({ name: `Tela ${index + 1}`, isDefault: index === 0, deviceToken: "ABCDEFGH" }));
  assert.equal(planNewSignageScreen(twelve).full, true);

  const input = { kioskId: "k1", orientation: "portrait", code: "abcdefgh" };
  assert.deepEqual(signageMobileScreenSchema.parse(input), { kioskId: "k1", orientation: "portrait", code: "ABCDEFGH" });
  assert.equal(signageMobileScreenSchema.safeParse({ ...input, screenId: "s1" }).success, true);
  assert.equal(signageMobileScreenSchema.safeParse({ ...input, orientation: "diagonal" }).success, false);
  assert.equal(signageMobileScreenSchema.safeParse({ ...input, code: "ABCDEFG1" }).success, false);
  assert.equal(signageMobileScreenSchema.safeParse({ ...input, name: "Tela 9" }).success, false);
});

test("telas pelo aplicativo: rotas sob contrato, permissão do aplicativo e unidade no servidor", async () => {
  const [units, add, qr, rules] = await Promise.all([
    readFile("src/app/api/signage/mobile/route.ts", "utf8"),
    readFile("src/app/api/signage/mobile/screens/route.ts", "utf8"),
    readFile("src/app/api/signage/pair/qr/route.ts", "utf8"),
    readFile("src/features/signage/mobile-screen.server.ts", "utf8"),
  ]);
  for (const source of [units, add, qr]) assert.match(source, /secureRoute\(\{ contract, enforcer \}/);
  for (const source of [units, add]) {
    assert.match(source, /assertMobileAppAttested\(/);
    assert.match(source, /assertCanManageMobileSignage\(/);
  }
  assert.match(add, /canAccessUnit\(/);
  // A permissão é a da lista do aplicativo; o código lido não pode ser o de outra tela.
  assert.match(rules, /permissions\.app\?\.signage\?\.manage !== true/);
  assert.match(rules, /if \(await codeInUse\(code\)\) failure\('CODE_IN_USE'/);
  assert.match(rules, /screen\.kioskId !== kioskId/);
  assert.match(qr, /limiter\.check\(/);
  assert.match(qr, /SIGNAGE_DEVICE_TOKEN_PATTERN\.test\(code\)/);
});

test("app do monitor: o que baixar e o que apagar", () => {
  const slides: AppSlide[] = [
    { id: "1", type: "image", assetUrl: "/api/signage/asset/signage/foto%20um.jpg" },
    { id: "2", type: "video", assetUrl: "/api/signage/asset/signage/filme.mp4" },
    { id: "3", type: "video", assetUrl: "/api/signage/asset/signage/filme.mp4" },
    { id: "4", type: "text", text: "Olá" },
  ];
  assert.equal(core.getAssetFileName("/api/signage/asset/signage/foto%20um.jpg"), "cs-foto_um.jpg");
  assert.equal(core.absoluteUrl(`${SERVER}/`, "/api/x"), `${SERVER}/api/x`);
  assert.equal(core.absoluteUrl(SERVER, "https://cdn.example/x.jpg"), "https://cdn.example/x.jpg");

  const plan = core.planMediaSync(slides, { "cs-filme.mp4": { uri: "file:///filme" }, "cs-antigo.jpg": { uri: "file:///antigo" } }, SERVER);
  assert.deepEqual(plan.downloads, [{ fileName: "cs-foto_um.jpg", url: `${SERVER}/api/signage/asset/signage/foto%20um.jpg` }]);
  assert.deepEqual(plan.removals, ["cs-antigo.jpg"]);
  assert.equal(plan.total, 2);
});

test("app do monitor: só vai ao ar o que está no disco e no horário", () => {
  const noon = new Date(2026, 9, 10, 12, 0);
  const slides: AppSlide[] = [
    { id: "1", type: "image", assetUrl: "/api/signage/asset/signage/a.jpg" },
    { id: "2", type: "video", assetUrl: "/api/signage/asset/signage/b.mp4" },
    { id: "3", type: "text", text: "Olá" },
    { id: "4", type: "text", text: "Só à noite", schedule: { startTime: "20:00", endTime: "23:00" } },
    { id: "5", type: "image" },
  ];
  const manifest = { "cs-b.mp4": { uri: "file:///disco/cs-b.mp4" } };

  assert.deepEqual(
    core.getPlayableSlides(slides, manifest, noon).map((entry) => [entry.slide.id, entry.src]),
    [["2", "file:///disco/cs-b.mp4"], ["3", null]],
  );
  // Sem disco (navegador comum), a mídia toca direto do servidor.
  assert.deepEqual(
    core.getPlayableSlides(slides, {}, noon, { hasStore: false, server: SERVER }).map((entry) => entry.slide.id),
    ["1", "2", "3"],
  );
});

test("app do monitor: publicação e recarga diária", () => {
  assert.equal(core.isNewerPublication(null, { updatedAt: "2026-10-10T10:00:00.000Z" }), true);
  assert.equal(core.isNewerPublication({ updatedAt: "2026-10-10T10:00:00.000Z" }, { updatedAt: "2026-10-10T10:00:00.000Z" }), false);
  assert.equal(core.isNewerPublication({ updatedAt: "2026-10-10T10:00:00.000Z" }, { updatedAt: "2026-10-10T09:00:00.000Z" }), false);
  assert.equal(core.isNewerPublication({ updatedAt: "2026-10-10T10:00:00.000Z" }, { updatedAt: "2026-10-10T11:00:00.000Z" }), true);
  assert.equal(core.isNewerPublication({ updatedAt: "2026-10-10T10:00:00.000Z" }, null), false);

  assert.equal(core.msUntilHour(new Date(2026, 9, 10, 3, 0), 4), 60 * 60 * 1000);
  assert.equal(core.msUntilHour(new Date(2026, 9, 10, 4, 0), 4), 24 * 60 * 60 * 1000);
});

test("app do monitor: sinal de vida aceita o código no corpo", () => {
  const parsed = signageHeartbeatSchema.parse({ screenId: "tela-1", token: "ABCDEFGH", status: "app", appVersion: "1.0.0" });
  assert.equal(parsed.status, "app");
  assert.equal(parsed.token, "ABCDEFGH");
});

test("app do monitor: rotas públicas do player sob contrato e legíveis de file://", async () => {
  const [pair, heartbeat, published] = await Promise.all([
    readFile("src/app/api/signage/pair/route.ts", "utf8"),
    readFile("src/app/api/signage/heartbeat/route.ts", "utf8"),
    readFile("src/app/api/signage/public/[kioskId]/route.ts", "utf8"),
  ]);
  assert.match(pair, /export const POST = secureRoute\(/);
  assert.match(pair, /limiter\.check\(/);
  for (const source of [pair, heartbeat, published]) assert.match(source, /SIGNAGE_PLAYER_CORS_HEADERS/);
  assert.match(heartbeat, /input\.token/);
  assert.match(heartbeat, /publishedAt/);
});

test("app do monitor: pacote publicado bate com o fonte", () => {
  const output = execFileSync(process.execPath, ["scripts/build-signage-tizen-app.mjs", "--check"], { encoding: "utf8" });
  assert.match(output, /em dia/);
});

test("biblioteca: entradas validadas na fronteira", () => {
  assert.equal(signageMediaUpdateSchema.safeParse({ folderId: null }).success, true);
  assert.equal(signageMediaUpdateSchema.safeParse({ fileName: "  Promo  " }).success, true);
  assert.equal(signageMediaUpdateSchema.safeParse({}).success, false);
  assert.equal(signageMediaUpdateSchema.safeParse({ assetPath: "signage/x.jpg" }).success, false);
  assert.equal(signageMediaFolderSchema.safeParse({ name: "" }).success, false);

  assert.equal(signageAppDownloadSchema.safeParse({ platform: "mobile", event: "download" }).success, true);
  assert.equal(signageAppDownloadSchema.safeParse({ platform: "ios", event: "download" }).success, false);
});

test("biblioteca e downloads: rotas sob contrato e regras no servidor", async () => {
  const paths = [
    "src/app/api/signage/media/route.ts",
    "src/app/api/signage/media/[mediaId]/route.ts",
    "src/app/api/signage/media/folders/route.ts",
    "src/app/api/signage/media/folders/[folderId]/route.ts",
    "src/app/api/signage/media/import/route.ts",
    "src/app/api/signage/app/downloads/route.ts",
  ];
  const sources = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, /export (async )?function (GET|POST|PATCH|DELETE)/, paths[index]);
    assert.match(source, /= secureRoute\(/, paths[index]);
  }
  const [, mediaItem, , , , downloads] = sources;
  // Mídia em uso não sai da biblioteca, mesmo que o slide seja de unidade que quem exclui não vê.
  assert.match(mediaItem, /where\('assetPath', '==', media\.assetPath\)/);
  assert.match(mediaItem, /SIGNAGE_MEDIA_IN_USE/);
  assert.match(downloads, /userId: security\.actor\.userId/);

  const server = await readFile("src/lib/signage-server.ts", "utf8");
  // Excluir um slide não apaga o arquivo que está na biblioteca.
  assert.match(server, /collection\('mediaLibrary'\)\.doc\(getSignageMediaId\(assetPath\)\)/);
});
