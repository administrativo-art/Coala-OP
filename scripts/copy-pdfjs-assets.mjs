#!/usr/bin/env node
// Copia os recursos do PDF.js usados pela prévia no navegador para public/pdfjs/.
// Sem `wasm/`, o PDF.js 6 não decodifica imagens CCITT, JBIG2 e JPEG 2000
// (PDFs digitalizados) e a página sai em branco sem erro. Roda antes de `dev` e `build`;
// a pasta de destino é gerada e fica fora do git.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const PDFJS_ASSET_FOLDERS = ["wasm", "iccs", "standard_fonts", "cmaps"];

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(projectRoot, "package.json"));

export function copyPdfjsAssets({ root = projectRoot, quiet = false } = {}) {
  const packageDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const { version } = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  const target = path.join(root, "public", "pdfjs");
  const stamp = path.join(target, ".version");
  const current = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : "";
  const complete = PDFJS_ASSET_FOLDERS.every((folder) => existsSync(path.join(target, folder)));
  if (current === version && complete) return { version, copied: false };
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const folder of PDFJS_ASSET_FOLDERS) {
    const source = path.join(packageDir, folder);
    if (!existsSync(source)) throw new Error(`pdfjs-dist ${version} sem a pasta ${folder}/`);
    cpSync(source, path.join(target, folder), { recursive: true });
  }
  writeFileSync(stamp, `${version}\n`);
  if (!quiet) console.log(`pdfjs-dist ${version}: recursos copiados para public/pdfjs/`);
  return { version, copied: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) copyPdfjsAssets();
