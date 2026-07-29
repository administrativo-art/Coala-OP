import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const outputDirectory = path.resolve("public/email/icons");
const boxOutputDirectory = path.join(outputDirectory, "boxes");
const variants = [
  ["calendar-days", "white", "#ffffff"],
  ["map-pin", "white", "#ffffff"],
  ["map-pin", "pink", "#db2777"],
  ["upload", "white", "#ffffff"],
  ["file-text", "pink", "#e72d87"],
  ["clock-3", "teal", "#20aeca"],
  ["clock-3", "pink", "#d92778"],
  ["clock-3", "white", "#ffffff"],
  ["building-2", "pink", "#e72d87"],
  ["user-round", "pink", "#e72d87"],
  ["stethoscope", "white", "#ffffff"],
  ["info", "gray", "#8991a5"],
  ["lock-keyhole", "white", "#ffffff"],
  ["key-round", "white", "#ffffff"],
  ["key-round", "pink", "#d92778"],
  ["briefcase-business", "white", "#ffffff"],
  ["shield-check", "pink", "#d92778"],
  ["log-out", "gray", "#697087"],
  ["check", "pink", "#d92778"],
];

function attributes(value) {
  return Object.entries(value)
    .filter(([key]) => key !== "key")
    .map(([key, item]) => `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${item}"`)
    .join(" ");
}

await mkdir(outputDirectory, { recursive: true });
for (const [icon, variant, color] of variants) {
  const module = await import(
    `../node_modules/lucide-react/dist/esm/icons/${icon}.js`
  );
  const shapes = module.__iconNode
    .map(([tag, props]) => `<${tag} ${attributes(props)} />`)
    .join("");
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`
  );
  await sharp(svg)
    .resize(48, 48)
    .png()
    .toFile(path.join(outputDirectory, `${icon}-${variant}.png`));
}

const boxes = [
  ["lock-keyhole-white.png", 27, 58, "#df2c82", 17],
  ["key-round-white.png", 27, 58, "#df2c82", 17],
  ["briefcase-business-white.png", 19, 38, "#df2c82", 11],
  ["file-text-pink.png", 13, 26, "#fff0f6", 8],
  ["lock-keyhole-white.png", 12, 18, "#d92778", 5],
  ["file-text-pink.png", 14, 28, "#fff0f6", 8],
  ["stethoscope-white.png", 20, 36, "#28b3d0", 11],
  ["building-2-pink.png", 14, 28, "#fff0f6", 9],
  ["user-round-pink.png", 14, 28, "#fff0f6", 9],
  ["info-gray.png", 13, 26, "#fff1f7", 8],
  ["file-text-pink.png", 13, 26, "#fff1f7", 8],
  ["clock-3-teal.png", 13, 26, "#e9f9fd", 8],
];

await mkdir(boxOutputDirectory, { recursive: true });
for (const [filename, iconSize, boxSize, background, radius] of boxes) {
  const backgroundName = background.replace("#", "").toLowerCase();
  const outputName = `${filename.replace(/\.png$/i, "")}-${iconSize}-in-${boxSize}-${backgroundName}-r${radius}.png`;
  const roundedBackground = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${boxSize}" height="${boxSize}" viewBox="0 0 ${boxSize} ${boxSize}"><rect width="${boxSize}" height="${boxSize}" rx="${radius}" fill="${background}" /></svg>`
  );
  const icon = await sharp(path.join(outputDirectory, filename))
    .resize(iconSize, iconSize, { fit: "contain" })
    .png()
    .toBuffer();
  const offset = Math.floor((boxSize - iconSize) / 2);
  await sharp(roundedBackground)
    .composite([{ input: icon, left: offset, top: offset }])
    .png()
    .toFile(path.join(boxOutputDirectory, outputName));
}

console.log(`Generated ${variants.length} email icons and ${boxes.length} centered boxes in ${outputDirectory}`);
