"use client";

import type { PDFDocumentLoadingTask, PDFWorker } from "pdfjs-dist";

/**
 * Pasta pública com os recursos do PDF.js copiados de `node_modules/pdfjs-dist`
 * por `scripts/copy-pdfjs-assets.mjs` (antes de `dev` e `build`).
 * Sem eles, o PDF.js 6 não decodifica imagens CCITT, JBIG2 e JPEG 2000 —
 * formatos comuns em PDFs digitalizados — e a página sai em branco sem erro.
 */
export const PDFJS_ASSET_BASE = "/pdfjs/";

type Pdfjs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<Pdfjs> | null = null;
let sharedWorker: PDFWorker | null = null;

/** Carrega a biblioteca uma vez por aba e configura o worker. */
export function loadPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return pdfjs;
    }).catch((error) => { pdfjsPromise = null; throw error; });
  }
  return pdfjsPromise;
}

/** Inicia a biblioteca e o worker antes do primeiro documento, sem ler arquivo algum. */
export function warmPdfjs() {
  void loadPdfjs().then(worker).catch(() => undefined);
}

function worker(pdfjs: Pdfjs): PDFWorker {
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new pdfjs.PDFWorker();
  return sharedWorker;
}

function assetUrl(folder: string) {
  return new URL(`${PDFJS_ASSET_BASE}${folder}/`, window.location.origin).toString();
}

/**
 * Abre um PDF no worker compartilhado com os decodificadores, perfis de cor e fontes.
 * Destruir a tarefa libera só o documento; o worker continua para o próximo.
 */
export async function openPdfDocument(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({
    data,
    worker: worker(pdfjs),
    wasmUrl: assetUrl("wasm"),
    iccUrl: assetUrl("iccs"),
    standardFontDataUrl: assetUrl("standard_fonts"),
    cMapUrl: assetUrl("cmaps"),
    cMapPacked: true,
  });
}

/**
 * Visualizador nativo do navegador só no computador: no Android ele não abre
 * PDF embutido e no iPhone o comportamento varia.
 */
export function prefersNativePdfViewer(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return navigator.pdfViewerEnabled === true && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
