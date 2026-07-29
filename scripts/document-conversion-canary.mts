import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { PDFDocument } from "pdf-lib";

import { cloudRunIdentityAuthorization } from "../src/features/hr/documents/cloud-run-auth.server";
import { validateDocxForLetterhead } from "../src/features/hr/documents/docx-template-validation";
import { applyCoalaLetterheadToPdf } from "../src/features/hr/documents/letterhead-pdf.server";
import { SYSTEM_DOCUMENT_TEMPLATES } from "../src/features/hr/documents/system-template-catalog";

const execFileAsync = promisify(execFile);
const GOLDEN_PATH = path.resolve(
  "docs/modelos-documentos/admissionais/conversion-golden.json",
);
const OUTPUT_DIRECTORY = path.resolve("output/pdf/document-canary");
const EXISTING_RAW_DIRECTORY = path.resolve(
  process.env.DOCUMENT_CANARY_RAW_DIR
    ?? "output/pdf/document-conversion-spike/raw",
);
const USE_EXISTING = process.env.DOCUMENT_CANARY_USE_EXISTING === "true";
const UPDATE_GOLDEN = process.env.DOCUMENT_CANARY_UPDATE_GOLDEN === "true";
const PAGE_TOLERANCE_POINTS = 0.25;
const ANCHOR_TOLERANCE_POINTS = 4;
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

type AnchorDefinition = {
  page: number;
  phrase: string;
};

const ANCHORS: Record<string, AnchorDefinition[]> = {
  "system-admission-employment-probation-contract": [
    { page: 1, phrase: "CONTRATO DE TRABALHO A TÍTULO DE EXPERIÊNCIA" },
    { page: 3, phrase: "E por estarem de pleno acordo" },
  ],
  "system-admission-hours-bank-agreement": [
    { page: 1, phrase: "ACORDO INDIVIDUAL DE BANCO DE HORAS" },
    { page: 2, phrase: "E por estarem de pleno acordo" },
  ],
  "system-admission-lgpd-awareness-term": [
    { page: 1, phrase: "TERMO DE CIÊNCIA SOBRE O TRATAMENTO DE DADOS PESSOAIS" },
    { page: 9, phrase: "compreende que a assinatura registra ciência" },
  ],
  "system-admission-image-voice-consent": [
    { page: 1, phrase: "TERMO DE CONSENTIMENTO PARA USO DE IMAGEM E VOZ" },
    { page: 2, phrase: "removerá em prazo razoável" },
  ],
  "system-admission-goals-awards-policy": [
    { page: 1, phrase: "REGULAMENTO DE METAS E PRÊMIOS POR DESEMPENHO" },
    { page: 2, phrase: "não integram a remuneração" },
  ],
  "system-admission-transportation-voucher-request": [
    { page: 1, phrase: "SOLICITAÇÃO DE VALE-TRANSPORTE" },
    { page: 1, phrase: "poderei requerê-lo a qualquer tempo" },
  ],
  "system-admission-confidentiality-agreement": [
    { page: 1, phrase: "TERMO DE CONFIDENCIALIDADE E SIGILO" },
    { page: 2, phrase: "Consequências" },
  ],
  "system-admission-electronic-time-tracking-awareness": [
    { page: 1, phrase: "TERMO DE CIÊNCIA REGISTRO ELETRÔNICO DE PONTO" },
    { page: 1, phrase: "Portaria MTP" },
  ],
  "system-admission-bundle-closing-term": [
    { page: 1, phrase: "TERMO DE ENCERRAMENTO CIÊNCIA E ASSINATURA" },
    { page: 1, phrase: "EMPREGADORA CONTROLADORA" },
  ],
};

type TextBox = {
  text: string;
  normalized: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

type AnchorEvidence = AnchorDefinition & {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

type TemplateEvidence = {
  sourcePath: string;
  sourceHash: string;
  pageCount: number;
  pageSizes: Array<{ width: number; height: number }>;
  fonts: Array<{ name: string; embedded: boolean }>;
  wordsPerPage: number[];
  anchors: AnchorEvidence[];
  safeAreaProfile: string;
};

type CanaryGolden = {
  schemaVersion: 1;
  renderer: {
    officeFont: "Calibri";
    converterFont: "Carlito";
    letterheadVersion: "coala-letterhead-v2";
  };
  templates: Record<string, TemplateEvidence>;
};

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function normalizeToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function parseBbox(xml: string) {
  const pages: TextBox[][] = [];
  for (const pageMatch of xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)) {
    const words: TextBox[] = [];
    for (const wordMatch of pageMatch[1].matchAll(
      /<word\b[^>]*xMin="([^"]+)"[^>]*yMin="([^"]+)"[^>]*xMax="([^"]+)"[^>]*yMax="([^"]+)"[^>]*>([\s\S]*?)<\/word>/g,
    )) {
      const text = decodeXml(wordMatch[5].replace(/<[^>]+>/g, ""));
      words.push({
        text,
        normalized: normalizeToken(text),
        xMin: Number(wordMatch[1]),
        yMin: Number(wordMatch[2]),
        xMax: Number(wordMatch[3]),
        yMax: Number(wordMatch[4]),
      });
    }
    pages.push(words);
  }
  return pages;
}

function locateAnchor(words: TextBox[], definition: AnchorDefinition): AnchorEvidence {
  const searchableWords = words.filter((word) => word.normalized);
  const expected = definition.phrase
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
  const actual = searchableWords.map((word) => word.normalized);
  for (let start = 0; start <= actual.length - expected.length; start += 1) {
    if (expected.every((token, index) => actual[start + index] === token)) {
      const found = searchableWords.slice(start, start + expected.length);
      return {
        ...definition,
        xMin: round(Math.min(...found.map((word) => word.xMin))),
        yMin: round(Math.min(...found.map((word) => word.yMin))),
        xMax: round(Math.max(...found.map((word) => word.xMax))),
        yMax: round(Math.max(...found.map((word) => word.yMax))),
      };
    }
  }
  throw new Error(
    `Âncora não encontrada na página ${definition.page}: ${definition.phrase}`,
  );
}

async function pdfFonts(pdfPath: string) {
  const { stdout } = await execFileAsync("pdffonts", [pdfPath], {
    timeout: 30_000,
  });
  return stdout
    .split(/\r?\n/)
    .slice(2)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const columns = line.split(/\s+/);
      return {
        name: columns[0].replace(/^[A-Z]{6}\+/, ""),
        embedded: columns.at(-5) === "yes",
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function inspectPdf(
  pdfPath: string,
  sourcePath: string,
  source: Buffer,
  anchorDefinitions: AnchorDefinition[],
): Promise<TemplateEvidence> {
  const pdfBuffer = await readFile(pdfPath);
  const pdf = await PDFDocument.load(pdfBuffer);
  const pages = pdf.getPages();
  const { stdout: bboxXml } = await execFileAsync(
    "pdftotext",
    ["-bbox-layout", pdfPath, "-"],
    { timeout: 30_000, maxBuffer: 25 * 1024 * 1024 },
  );
  const textPages = parseBbox(bboxXml);
  if (textPages.length !== pages.length) {
    throw new Error(
      `Extração retornou ${textPages.length} páginas para PDF com ${pages.length}.`,
    );
  }
  const pageSizes = pages.map((page, index) => {
    const { width, height } = page.getSize();
    if (
      Math.abs(width - A4_WIDTH) > PAGE_TOLERANCE_POINTS ||
      Math.abs(height - A4_HEIGHT) > PAGE_TOLERANCE_POINTS
    ) {
      throw new Error(`Página ${index + 1} não está em A4 retrato.`);
    }
    for (const word of textPages[index]) {
      if (
        word.xMin < -PAGE_TOLERANCE_POINTS ||
        word.yMin < -PAGE_TOLERANCE_POINTS ||
        word.xMax > width + PAGE_TOLERANCE_POINTS ||
        word.yMax > height + PAGE_TOLERANCE_POINTS
      ) {
        throw new Error(
          `Texto "${word.text}" saiu da página ${index + 1}.`,
        );
      }
    }
    if (!textPages[index].length) {
      throw new Error(`Página ${index + 1} não possui texto extraível.`);
    }
    return { width: round(width), height: round(height) };
  });
  const safeArea = validateDocxForLetterhead(source);
  if (!safeArea.valid) {
    throw new Error(
      `Modelo viola área segura: ${safeArea.issues.map((issue) => issue.message).join(" ")}`,
    );
  }
  const fonts = await pdfFonts(pdfPath);
  if (!fonts.length || fonts.some((font) => !font.embedded)) {
    throw new Error("O PDF possui fonte ausente ou não incorporada.");
  }
  if (!fonts.some((font) => font.name.toLocaleLowerCase().includes("carlito"))) {
    throw new Error("O PDF não incorporou Carlito.");
  }

  return {
    sourcePath,
    sourceHash: sha256(source),
    pageCount: pages.length,
    pageSizes,
    fonts,
    wordsPerPage: textPages.map((words) => words.length),
    anchors: anchorDefinitions.map((definition) => {
      const words = textPages[definition.page - 1];
      if (!words) throw new Error(`Página ${definition.page} da âncora não existe.`);
      return locateAnchor(words, definition);
    }),
    safeAreaProfile: safeArea.profileId,
  };
}

async function authorizationHeader() {
  const explicit = process.env.DOCUMENT_CANARY_ID_TOKEN?.trim();
  if (explicit) return `Bearer ${explicit}`;
  const audience = process.env.DOCX_TO_PDF_AUDIENCE?.trim();
  return audience
    ? await cloudRunIdentityAuthorization(audience)
    : null;
}

async function convertRemote(source: Buffer, fileName: string) {
  const configured = process.env.DOCX_TO_PDF_URL?.trim();
  if (!configured) {
    throw new Error("Defina DOCX_TO_PDF_URL para executar o canário remoto.");
  }
  const url = new URL(configured);
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/forms/libreoffice/convert";
  }
  const form = new FormData();
  form.set(
    "files",
    new Blob([new Uint8Array(source)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    fileName,
  );
  const authorization = await authorizationHeader();
  const response = await fetch(url, {
    method: "POST",
    body: form,
    headers: authorization ? { Authorization: authorization } : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(
      `Gotenberg respondeu ${response.status}: ${(await response.text()).slice(0, 500)}`,
    );
  }
  const result = Buffer.from(await response.arrayBuffer());
  if (result.subarray(0, 4).toString() !== "%PDF") {
    throw new Error("Gotenberg não devolveu um PDF.");
  }
  return result;
}

function compareNumber(
  errors: string[],
  label: string,
  actual: number,
  expected: number,
  tolerance: number,
) {
  if (Math.abs(actual - expected) > tolerance) {
    errors.push(`${label}: ${actual}, esperado ${expected} ± ${tolerance}.`);
  }
}

function compareEvidence(
  id: string,
  actual: TemplateEvidence,
  expected: TemplateEvidence,
) {
  const errors: string[] = [];
  if (actual.sourceHash !== expected.sourceHash) {
    errors.push("hash do DOCX divergiu do golden");
  }
  if (actual.pageCount !== expected.pageCount) {
    errors.push(
      `páginas: ${actual.pageCount}, esperado ${expected.pageCount}`,
    );
  }
  if (JSON.stringify(actual.fonts) !== JSON.stringify(expected.fonts)) {
    errors.push(
      `fontes: ${JSON.stringify(actual.fonts)}, esperado ${JSON.stringify(expected.fonts)}`,
    );
  }
  if (actual.safeAreaProfile !== expected.safeAreaProfile) {
    errors.push("perfil de área segura divergiu");
  }
  actual.pageSizes.forEach((size, index) => {
    const goldenSize = expected.pageSizes[index];
    if (!goldenSize) return;
    compareNumber(
      errors,
      `página ${index + 1} largura`,
      size.width,
      goldenSize.width,
      PAGE_TOLERANCE_POINTS,
    );
    compareNumber(
      errors,
      `página ${index + 1} altura`,
      size.height,
      goldenSize.height,
      PAGE_TOLERANCE_POINTS,
    );
  });
  actual.wordsPerPage.forEach((count, index) => {
    const goldenCount = expected.wordsPerPage[index];
    if (goldenCount !== undefined && count !== goldenCount) {
      errors.push(
        `página ${index + 1} palavras: ${count}, esperado ${goldenCount}`,
      );
    }
  });
  actual.anchors.forEach((anchor, index) => {
    const goldenAnchor = expected.anchors[index];
    if (!goldenAnchor || anchor.phrase !== goldenAnchor.phrase) {
      errors.push(`âncora ${index + 1} não corresponde ao golden`);
      return;
    }
    for (const coordinate of ["xMin", "yMin", "xMax", "yMax"] as const) {
      compareNumber(
        errors,
        `âncora "${anchor.phrase}" ${coordinate}`,
        anchor[coordinate],
        goldenAnchor[coordinate],
        ANCHOR_TOLERANCE_POINTS,
      );
    }
  });
  if (errors.length) {
    throw new Error(`${id}:\n- ${errors.join("\n- ")}`);
  }
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const templates = SYSTEM_DOCUMENT_TEMPLATES.filter(
  (template) => template.renderer === "admission_docx" && template.sourcePath,
);
const evidence: Record<string, TemplateEvidence> = {};

for (const template of templates) {
  const sourcePath = path.resolve(template.sourcePath!);
  const source = await readFile(sourcePath);
  const rawPdf = USE_EXISTING
    ? await readFile(
        path.join(
          EXISTING_RAW_DIRECTORY,
          path.basename(sourcePath).replace(/\.docx$/i, ".pdf"),
        ),
      )
    : await convertRemote(source, path.basename(sourcePath));
  const officialPdf = await applyCoalaLetterheadToPdf(rawPdf);
  const outputPath = path.join(OUTPUT_DIRECTORY, `${template.id}.pdf`);
  await writeFile(outputPath, officialPdf);
  evidence[template.id] = await inspectPdf(
    outputPath,
    template.sourcePath!,
    source,
    ANCHORS[template.id] ?? [],
  );
}

const current: CanaryGolden = {
  schemaVersion: 1,
  renderer: {
    officeFont: "Calibri",
    converterFont: "Carlito",
    letterheadVersion: "coala-letterhead-v2",
  },
  templates: evidence,
};

if (UPDATE_GOLDEN) {
  await writeFile(GOLDEN_PATH, `${JSON.stringify(current, null, 2)}\n`);
  process.stdout.write(`Golden atualizado: ${GOLDEN_PATH}\n`);
} else {
  const golden = JSON.parse(await readFile(GOLDEN_PATH, "utf8")) as CanaryGolden;
  if (golden.schemaVersion !== current.schemaVersion) {
    throw new Error(`Schema do golden incompatível: ${golden.schemaVersion}.`);
  }
  for (const template of templates) {
    const expected = golden.templates[template.id];
    if (!expected) throw new Error(`Golden ausente para ${template.id}.`);
    compareEvidence(template.id, current.templates[template.id], expected);
  }
  process.stdout.write(
    `${JSON.stringify({
      status: "passed",
      mode: USE_EXISTING ? "existing" : "remote",
      templateCount: templates.length,
      golden: path.relative(process.cwd(), GOLDEN_PATH),
      outputDirectory: path.relative(process.cwd(), OUTPUT_DIRECTORY),
    }, null, 2)}\n`,
  );
}
