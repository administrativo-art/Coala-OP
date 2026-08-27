import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const width = 2480;
const height = 3508;
const outputPath = path.join(
  process.cwd(),
  "src/features/hr/documents/assets/coala-shakes-letterhead-a4-v2.png",
);
const overlayPath = path.join(
  process.cwd(),
  "src/features/hr/documents/assets/coala-shakes-letterhead-overlay-a4-v2.png",
);
const logoPath = path.join(
  process.cwd(),
  "src/features/hr/documents/assets/coala-shakes-letterhead-mark-v1.png",
);

await mkdir(path.dirname(outputPath), { recursive: true });

const logo = await sharp(logoPath)
  .trim()
  .resize({ width: 310, withoutEnlargement: true })
  .png()
  .toBuffer();
const logoMetadata = await sharp(logo).metadata();
const logoHeight = logoMetadata.height ?? 140;
const topRule = Buffer.from(`
  <svg width="${width}" height="16" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="coala-rule" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#ef4f9a"/>
        <stop offset="52%" stop-color="#ef4f9a"/>
        <stop offset="100%" stop-color="#42b9d0"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="16" fill="url(#coala-rule)"/>
  </svg>
`);

await sharp({
  create: {
    width,
    height,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  },
})
  .composite([
    { input: topRule, top: 0, left: 0 },
    { input: logo, top: height - logoHeight - 82, left: width - 310 - 92 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

await sharp({
  create: {
    width,
    height,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  },
})
  .composite([
    { input: topRule, top: 0, left: 0 },
    { input: logo, top: height - logoHeight - 82, left: width - 310 - 92 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(overlayPath);

console.log(outputPath);
console.log(overlayPath);
