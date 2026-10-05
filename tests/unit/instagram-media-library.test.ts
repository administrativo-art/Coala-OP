import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  detectInstagramLibraryMedia,
  safeInstagramLibraryFileName,
} from "../../src/features/instagram-scheduler/media-validation";
import { inspectInstagramIsoVideo } from "../../src/features/instagram-scheduler/video-inspection";

function isoBox(type: string, payload: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function testVideoBuffer() {
  const ftyp = isoBox("ftyp", Buffer.from("isom0000", "ascii"));
  const tkhd = isoBox("tkhd", Buffer.alloc(80));
  const mdhdPayload = Buffer.alloc(20);
  mdhdPayload.writeUInt32BE(1_000, 12);
  mdhdPayload.writeUInt32BE(5_000, 16);
  const mdhd = isoBox("mdhd", mdhdPayload);
  const hdlrPayload = Buffer.alloc(12);
  hdlrPayload.write("vide", 8, 4, "ascii");
  const hdlr = isoBox("hdlr", hdlrPayload);
  const videoEntryPayload = Buffer.alloc(28);
  videoEntryPayload.writeUInt16BE(1080, 24);
  videoEntryPayload.writeUInt16BE(1920, 26);
  const videoEntry = isoBox("avc1", videoEntryPayload);
  const stsdHeader = Buffer.alloc(8);
  stsdHeader.writeUInt32BE(1, 4);
  const stsd = isoBox("stsd", Buffer.concat([stsdHeader, videoEntry]));
  const sttsPayload = Buffer.alloc(16);
  sttsPayload.writeUInt32BE(1, 4);
  sttsPayload.writeUInt32BE(150, 8);
  sttsPayload.writeUInt32BE(1, 12);
  const stts = isoBox("stts", sttsPayload);
  const stbl = isoBox("stbl", Buffer.concat([stsd, stts]));
  const minf = isoBox("minf", stbl);
  const mdia = isoBox("mdia", Buffer.concat([mdhd, hdlr, minf]));
  const trak = isoBox("trak", Buffer.concat([tkhd, mdia]));
  const moov = isoBox("moov", trak);
  const mdat = isoBox("mdat", Buffer.alloc(100));
  return Buffer.concat([ftyp, moov, mdat]);
}

test("detecta imagem pelo conteúdo e preserva suas dimensões", async () => {
  const image = await sharp({
    create: {
      width: 1080,
      height: 1350,
      channels: 3,
      background: "#f462a7",
    },
  }).jpeg().toBuffer();

  const detected = await detectInstagramLibraryMedia(image);
  assert.deepEqual(detected, {
    kind: "image",
    contentType: "image/jpeg",
    extension: "jpg",
    width: 1080,
    height: 1350,
    durationSeconds: null,
    videoCodec: null,
    audioCodec: null,
    frameRate: null,
    videoBitrateBps: null,
    audioSampleRateHz: null,
    fastStart: null,
    hasEditList: null,
  });
});

test("distingue MP4 e MOV pela marca do contêiner", async () => {
  const mp4 = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const mov = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
  assert.equal((await detectInstagramLibraryMedia(mp4)).contentType, "video/mp4");
  assert.equal((await detectInstagramLibraryMedia(mov)).contentType, "video/quicktime");
});

test("inspeciona dimensões, codec, duração, FPS e fast start do vídeo", () => {
  const inspected = inspectInstagramIsoVideo(testVideoBuffer());
  assert.equal(inspected.width, 1080);
  assert.equal(inspected.height, 1920);
  assert.equal(inspected.videoCodec, "avc1");
  assert.equal(inspected.durationSeconds, 5);
  assert.equal(inspected.frameRate, 30);
  assert.equal(inspected.fastStart, true);
  assert.equal(inspected.hasEditList, false);
});

test("rejeita conteúdo desconhecido e normaliza o nome do objeto", async () => {
  await assert.rejects(() => detectInstagramLibraryMedia(Buffer.from("não é mídia")));
  assert.equal(
    safeInstagramLibraryFileName("  Campanha São João 2026!!.PNG", "png"),
    "Campanha-Sao-Joao-2026.png",
  );
});
