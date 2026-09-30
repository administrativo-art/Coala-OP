import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  detectInstagramLibraryMedia,
  safeInstagramLibraryFileName,
} from "../../src/features/instagram-scheduler/media-validation";

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
  });
});

test("distingue MP4 e MOV pela marca do contêiner", async () => {
  const mp4 = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const mov = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
  assert.equal((await detectInstagramLibraryMedia(mp4)).contentType, "video/mp4");
  assert.equal((await detectInstagramLibraryMedia(mov)).contentType, "video/quicktime");
});

test("rejeita conteúdo desconhecido e normaliza o nome do objeto", async () => {
  await assert.rejects(() => detectInstagramLibraryMedia(Buffer.from("não é mídia")));
  assert.equal(
    safeInstagramLibraryFileName("  Campanha São João 2026!!.PNG", "png"),
    "Campanha-Sao-Joao-2026.png",
  );
});
