import {
  formatDocumentVariableValue,
  getDocumentVariable,
} from "@/features/hr/integration/document-variables";

import type {
  EditorBlockNode,
  EditorCellAttrs,
  EditorContent,
  EditorInlineNode,
  EditorMark,
} from "./content-schema";
import { EDITOR_SAMPLE_VALUES } from "./sample-values";

export type EditorPageLayout = {
  widthPx: number;
  heightPx: number;
  marginTopPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  marginRightPx: number;
};

/**
 * PROVISÓRIO: A4 a 96 dpi com margens estimadas. Substituir pelas medidas reais do timbre
 * `coala-letterhead-v2` quando forem medidas (pendência do chamado).
 */
export const PROVISIONAL_PAGE_LAYOUT: Readonly<EditorPageLayout> = Object.freeze({
  widthPx: 794,
  heightPx: 1123,
  marginTopPx: 120,
  marginBottomPx: 135,
  marginLeftPx: 76,
  marginRightPx: 76,
});

export type RenderEditorHtmlOptions = {
  /** Valores brutos por chave do catálogo. Em `sample`, complementam/sobrepõem os exemplos. */
  values?: Record<string, unknown>;
  mode: "sample" | "resolved";
  page?: Partial<EditorPageLayout>;
};

/**
 * Defesa em profundidade dentro do próprio HTML: sem script, imagem, fonte, frame ou rede; só CSS inline.
 * NÃO substitui negar rede/JS na configuração do Gotenberg/Chromium (do serviço; não verificada aqui).
 */
export const EDITOR_HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'";

export type RenderEditorHtmlResult = { html: string; missingKeys: string[] };

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function resolvePage(page: Partial<EditorPageLayout> | undefined): EditorPageLayout {
  const merged = { ...PROVISIONAL_PAGE_LAYOUT, ...(page ?? {}) };
  for (const [name, value] of Object.entries(merged)) {
    if (!Number.isInteger(value) || value < 0 || value > 5000) {
      throw new RangeError(`Dimensão de página inválida: ${name}.`);
    }
  }
  if (merged.widthPx - merged.marginLeftPx - merged.marginRightPx < 100) {
    throw new RangeError("Margens laterais não deixam área útil.");
  }
  if (merged.heightPx - merged.marginTopPx - merged.marginBottomPx < 100) {
    throw new RangeError("Margens verticais não deixam área útil.");
  }
  return merged;
}

const CSS = (page: EditorPageLayout) => `
@page { size: ${page.widthPx}px ${page.heightPx}px; margin: ${page.marginTopPx}px ${page.marginRightPx}px ${page.marginBottomPx}px ${page.marginLeftPx}px; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "Times New Roman", Times, "Liberation Serif", Georgia, serif; font-size: 12pt; line-height: 1.5; color: #000; }
@media screen { body { width: ${page.widthPx}px; min-height: ${page.heightPx}px; padding: ${page.marginTopPx}px ${page.marginRightPx}px ${page.marginBottomPx}px ${page.marginLeftPx}px; } }
p { margin: 0 0 8pt; overflow-wrap: break-word; }
h1, h2, h3 { font-weight: bold; margin: 12pt 0 6pt; line-height: 1.25; break-after: avoid; }
h1 { font-size: 16pt; } h2 { font-size: 14pt; } h3 { font-size: 12pt; }
ul, ol { margin: 0 0 8pt; padding-left: 24pt; }
table { width: 100%; border-collapse: collapse; margin: 0 0 8pt; table-layout: fixed; }
th, td { border: 1px solid #000; padding: 4pt 6pt; vertical-align: top; overflow-wrap: break-word; }
th { font-weight: bold; text-align: left; }
tr { break-inside: avoid; }
.field { white-space: nowrap; }
.field-missing { white-space: nowrap; background: #fff3cd; }
`;

type RenderState = {
  mode: "sample" | "resolved";
  values: Record<string, unknown>;
  missing: Set<string>;
};

function renderField(key: string, state: RenderState): string {
  const variable = getDocumentVariable(key);
  if (!variable) {
    state.missing.add(key);
    return `<span class="field-missing" data-field="${escapeHtml(key)}">[${escapeHtml(key)}]</span>`;
  }
  const raw = Object.prototype.hasOwnProperty.call(state.values, key) ? state.values[key] : undefined;
  const text = formatDocumentVariableValue(raw, variable.format);
  if (text === "" && variable.format !== "checkbox_mark") {
    // Valor ausente nunca vira texto vazio silencioso: fica marcado e listado em missingKeys.
    if (state.mode === "resolved") state.missing.add(key);
    return `<span class="field-missing" data-field="${escapeHtml(key)}">[${escapeHtml(variable.label)}]</span>`;
  }
  return `<span class="field" data-field="${escapeHtml(key)}">${escapeHtml(text)}</span>`;
}

function applyMarks(html: string, marks: EditorMark[] | undefined): string {
  if (!marks || marks.length === 0) return html;
  const types = new Set(marks.map((mark) => mark.type));
  let out = html;
  // Ordem fixa para que a mesma marca em ordem diferente gere o mesmo HTML.
  if (types.has("underline")) out = `<u>${out}</u>`;
  if (types.has("italic")) out = `<em>${out}</em>`;
  if (types.has("bold")) out = `<strong>${out}</strong>`;
  return out;
}

function renderInline(nodes: EditorInlineNode[] | undefined, state: RenderState): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === "text") return applyMarks(escapeHtml(node.text), node.marks);
      if (node.type === "hardBreak") return "<br>";
      return renderField(node.attrs.key, state);
    })
    .join("");
}

type ListChild = Extract<EditorBlockNode, { type: "paragraph" | "bulletList" | "orderedList" }>;

function renderBlock(node: EditorBlockNode | ListChild, state: RenderState): string {
  switch (node.type) {
    case "paragraph": {
      const inner = renderInline(node.content, state);
      return `<p>${inner === "" ? "<br>" : inner}</p>`;
    }
    case "heading":
      return `<h${node.attrs.level}>${renderInline(node.content, state)}</h${node.attrs.level}>`;
    case "bulletList":
      return `<ul>${node.content.map((item) => renderListItem(item.content, state)).join("")}</ul>`;
    case "orderedList": {
      const start = node.attrs?.start;
      const attr = start && start !== 1 ? ` start="${start}"` : "";
      return `<ol${attr}>${node.content.map((item) => renderListItem(item.content, state)).join("")}</ol>`;
    }
    case "table":
      return `<table><tbody>${node.content
        .map((row) => `<tr>${row.content.map((cell) => renderCell(cell, state)).join("")}</tr>`)
        .join("")}</tbody></table>`;
  }
}

function renderListItem(children: ListChild[], state: RenderState): string {
  return `<li>${children.map((child) => renderBlock(child, state)).join("")}</li>`;
}

function spanAttrs(attrs: EditorCellAttrs | undefined): string {
  let out = "";
  if (attrs?.colspan && attrs.colspan > 1) out += ` colspan="${attrs.colspan}"`;
  if (attrs?.rowspan && attrs.rowspan > 1) out += ` rowspan="${attrs.rowspan}"`;
  return out;
}

function renderCell(
  cell: { type: "tableCell" | "tableHeader"; attrs?: EditorCellAttrs; content: ListChild[] },
  state: RenderState,
): string {
  const tag = cell.type === "tableHeader" ? "th" : "td";
  return `<${tag}${spanAttrs(cell.attrs)}>${cell.content.map((child) => renderBlock(child, state)).join("")}</${tag}>`;
}

/**
 * Gera o HTML A4 completo (autocontido) do conteúdo já validado por `parseEditorContent`.
 * Determinístico: depende apenas de `content`, `values`, `mode` e `page`. Sem recursos remotos.
 * `sample` usa valores de exemplo; `resolved` usa só `values` e informa `missingKeys` (ordenadas,
 * sem repetição) para o chamador bloquear a geração oficial.
 */
export function renderEditorHtml(
  content: EditorContent,
  options: RenderEditorHtmlOptions,
): RenderEditorHtmlResult {
  const page = resolvePage(options.page);
  const state: RenderState = {
    mode: options.mode,
    values:
      options.mode === "sample"
        ? { ...EDITOR_SAMPLE_VALUES, ...(options.values ?? {}) }
        : { ...(options.values ?? {}) },
    missing: new Set<string>(),
  };
  const body = content.content.map((block) => renderBlock(block, state)).join("\n");
  const html = [
    "<!doctype html>",
    '<html lang="pt-BR">',
    `<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${EDITOR_HTML_CSP}"><title>Documento</title>`,
    `<style>${CSS(page)}</style></head>`,
    `<body>\n${body}\n</body>`,
    "</html>",
  ].join("\n");
  return { html, missingKeys: [...state.missing].sort() };
}
