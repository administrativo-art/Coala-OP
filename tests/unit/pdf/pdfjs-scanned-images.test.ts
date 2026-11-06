import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { concatTransformationMatrix, drawObject, PDFDocument, PDFName, popGraphicsState, pushGraphicsState } from "pdf-lib";
import { copyPdfjsAssets, PDFJS_ASSET_FOLDERS } from "../../../scripts/copy-pdfjs-assets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** PDF de uma página com uma imagem JPEG 2000, como sai de muitos scanners. */
async function scannedPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  const image = doc.context.stream(readFileSync(join(root, "tests/fixtures/pdf/scanned-jpx-24px.jp2")), { Type: "XObject", Subtype: "Image", Width: 24, Height: 24, Filter: "JPXDecode" });
  page.node.setXObject(PDFName.of("Im0"), doc.context.register(image));
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(100, 0, 0, 100, 0, 0), drawObject("Im0"), popGraphicsState());
  return doc.save();
}

async function decodedImage(wasmUrl?: string) {
  const pdfjs = await import(pathToFileURL(join(root, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
  const task = pdfjs.getDocument({ data: await scannedPdf(), wasmUrl, verbosity: 0 });
  try {
    const page = await (await task.promise).getPage(1);
    const operators = await page.getOperatorList();
    const index = operators.fnArray.indexOf(pdfjs.OPS.paintImageXObject);
    if (index < 0) return null;
    const id = operators.argsArray[index][0] as string;
    return await new Promise<{ width: number; height: number } | null>((done) => page.objs.get(id, done));
  } finally { await task.destroy(); }
}

test("sem wasmUrl o PDF.js não decodifica a imagem digitalizada (página em branco)", async () => {
  assert.equal(await decodedImage(), null);
});

test("com os recursos copiados para public/pdfjs a imagem digitalizada é decodificada", async () => {
  const target = mkdtempSync(join(tmpdir(), "pdfjs-assets-"));
  try {
    copyPdfjsAssets({ root: target, quiet: true });
    for (const folder of PDFJS_ASSET_FOLDERS) assert.ok(existsSync(join(target, "public/pdfjs", folder)), folder);
    for (const file of ["openjpeg.wasm", "jbig2.wasm", "openjpeg_nowasm_fallback.js", "jbig2_nowasm_fallback.js"]) assert.ok(existsSync(join(target, "public/pdfjs/wasm", file)), file);
    const image = await decodedImage(`${join(target, "public/pdfjs/wasm")}/`);
    assert.deepEqual(image && { width: image.width, height: image.height }, { width: 24, height: 24 });
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("o cliente do navegador informa ao PDF.js todas as pastas copiadas", () => {
  const client = readFileSync(join(root, "src/lib/pdf/pdfjs-client.ts"), "utf8");
  for (const folder of PDFJS_ASSET_FOLDERS) assert.match(client, new RegExp(`assetUrl\\("${folder}"\\)`), folder);
});

test("toda abertura de PDF no navegador passa pelo cliente compartilhado", () => {
  const files = execFileSync("git", ["ls-files", "src"], { cwd: root, encoding: "utf8" }).split("\n").filter((file) => /\.(tsx?|mjs)$/.test(file));
  const offenders = files.filter((file) => file !== "src/lib/pdf/pdfjs-client.ts").filter((file) => {
    const source = readFileSync(join(root, file), "utf8");
    return /^["']use client["']/m.test(source) && /import\(["']pdfjs-dist["']\)|from ["']pdfjs-dist["']/.test(source) && /\bgetDocument\(/.test(source);
  });
  assert.deepEqual(offenders, []);
});
