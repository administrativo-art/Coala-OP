import { createHash } from "node:crypto";
import { z } from "zod";

import { isDocumentVariableKey } from "@/features/hr/integration/document-variables";

/** Versão do formato do conteúdo salvo. Incrementar exige migração explícita. */
export const EDITOR_CONTENT_SCHEMA_VERSION = 1 as const;

/**
 * Limites aplicados no servidor (o cliente nunca é confiável).
 * - Profundidade 12: doc>tabela>linha>célula>parágrafo>texto usa 6; cada nível de lista aninhada
 *   soma 2, o que permite ~5 níveis de lista. Acima disso é abuso ou colagem corrompida.
 * - 5.000 nós: um documento de RH de dezenas de páginas tem centenas de nós; o teto protege o
 *   renderizador e o PDF contra entradas patológicas.
 * - 300 KB de JSON UTF-8: ordem de grandeza maior que o maior termo previsto e muito abaixo do
 *   limite de documento do Firestore (1 MiB).
 */
export const EDITOR_CONTENT_MAX_DEPTH = 12;
export const EDITOR_CONTENT_MAX_NODES = 5000;
export const EDITOR_CONTENT_MAX_BYTES = 300 * 1024;
/** Teto por nó de texto, para evitar um único nó dominar o orçamento de bytes. */
export const EDITOR_CONTENT_MAX_TEXT_LENGTH = 20000;

export type EditorMarkType = "bold" | "italic" | "underline";
export type EditorMark = { type: EditorMarkType };

export type EditorTextNode = { type: "text"; text: string; marks?: EditorMark[] };
export type EditorHardBreakNode = { type: "hardBreak" };
export type EditorDocumentFieldNode = { type: "documentField"; attrs: { key: string } };
export type EditorInlineNode = EditorTextNode | EditorHardBreakNode | EditorDocumentFieldNode;

export type EditorParagraphNode = { type: "paragraph"; content?: EditorInlineNode[] };
export type EditorHeadingNode = {
  type: "heading";
  attrs: { level: 1 | 2 | 3 };
  content?: EditorInlineNode[];
};
export type EditorListItemNode = {
  type: "listItem";
  content: Array<EditorParagraphNode | EditorBulletListNode | EditorOrderedListNode>;
};
export type EditorBulletListNode = { type: "bulletList"; content: EditorListItemNode[] };
export type EditorOrderedListNode = {
  type: "orderedList";
  attrs?: { start?: number };
  content: EditorListItemNode[];
};
export type EditorCellAttrs = { colspan?: number; rowspan?: number; colwidth?: null };
export type EditorTableCellNode = {
  type: "tableCell" | "tableHeader";
  attrs?: EditorCellAttrs;
  content: Array<EditorParagraphNode | EditorBulletListNode | EditorOrderedListNode>;
};
export type EditorTableRowNode = { type: "tableRow"; content: EditorTableCellNode[] };
export type EditorTableNode = { type: "table"; content: EditorTableRowNode[] };
export type EditorBlockNode =
  | EditorParagraphNode
  | EditorHeadingNode
  | EditorBulletListNode
  | EditorOrderedListNode
  | EditorTableNode;
export type EditorContent = { type: "doc"; content: EditorBlockNode[] };

const markSchema = z.strictObject({ type: z.enum(["bold", "italic", "underline"]) });

const textSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string().min(1).max(EDITOR_CONTENT_MAX_TEXT_LENGTH),
  marks: z.array(markSchema).max(3).optional(),
});
const hardBreakSchema = z.strictObject({ type: z.literal("hardBreak") });
const documentFieldSchema = z.strictObject({
  type: z.literal("documentField"),
  attrs: z.strictObject({
    key: z.string().refine((key) => isDocumentVariableKey(key), "Variável fora do catálogo."),
  }),
});
const inlineSchema = z.union([textSchema, hardBreakSchema, documentFieldSchema]);

const paragraphSchema = z.strictObject({
  type: z.literal("paragraph"),
  content: z.array(inlineSchema).optional(),
});
const headingSchema = z.strictObject({
  type: z.literal("heading"),
  attrs: z.strictObject({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  content: z.array(inlineSchema).optional(),
});

// Esquemas mutuamente recursivos (lista dentro de item de lista); z.lazy adia a resolução.
const listItemSchema: z.ZodType<EditorListItemNode> = z.lazy(() =>
  z.strictObject({
    type: z.literal("listItem"),
    content: z.array(z.union([paragraphSchema, bulletListSchema, orderedListSchema])).min(1),
  }),
);
const bulletListSchema: z.ZodType<EditorBulletListNode> = z.lazy(() =>
  z.strictObject({
    type: z.literal("bulletList"),
    content: z.array(listItemSchema).min(1),
  }),
);
const orderedListSchema: z.ZodType<EditorOrderedListNode> = z.lazy(() =>
  z.strictObject({
    type: z.literal("orderedList"),
    attrs: z.strictObject({ start: z.number().int().min(1).max(9999).optional() }).optional(),
    content: z.array(listItemSchema).min(1),
  }),
);

const cellAttrsSchema = z.strictObject({
  colspan: z.number().int().min(1).max(12).optional(),
  rowspan: z.number().int().min(1).max(12).optional(),
  colwidth: z.null().optional(),
});
const cellContentSchema = z
  .array(z.union([paragraphSchema, bulletListSchema, orderedListSchema]))
  .min(1);
const tableCellSchema = z.strictObject({
  type: z.enum(["tableCell", "tableHeader"]),
  attrs: cellAttrsSchema.optional(),
  content: cellContentSchema,
});
const tableRowSchema = z.strictObject({
  type: z.literal("tableRow"),
  content: z.array(tableCellSchema).min(1).max(12),
});
const tableSchema = z.strictObject({
  type: z.literal("table"),
  content: z.array(tableRowSchema).min(1),
});

const blockSchema = z.union([
  paragraphSchema,
  headingSchema,
  bulletListSchema,
  orderedListSchema,
  tableSchema,
]);

export const editorContentSchema: z.ZodType<EditorContent> = z.strictObject({
  type: z.literal("doc"),
  content: z.array(blockSchema).min(1),
});

export type EditorContentIssue = { path: string; message: string };
export type ParseEditorContentResult =
  | { ok: true; content: EditorContent; stats: { bytes: number; nodes: number; depth: number } }
  | { ok: false; issues: EditorContentIssue[] };

const MAX_REPORTED_ISSUES = 20;

function fail(message: string, path = ""): ParseEditorContentResult {
  return { ok: false, issues: [{ path, message }] };
}

function measure(input: unknown): { nodes: number; depth: number } {
  // Percurso iterativo: uma entrada profunda não pode estourar a pilha antes da validação.
  let nodes = 0;
  let depth = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 1 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!current.value || typeof current.value !== "object" || Array.isArray(current.value)) continue;
    nodes += 1;
    if (current.depth > depth) depth = current.depth;
    if (nodes > EDITOR_CONTENT_MAX_NODES || depth > EDITOR_CONTENT_MAX_DEPTH) break;
    const children = (current.value as { content?: unknown }).content;
    if (Array.isArray(children)) {
      for (const child of children) stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return { nodes, depth };
}

/**
 * Valida o conteúdo do editor por allowlist estrita. As mensagens são fixas/saneadas: não repassam
 * o valor recebido nem detalhes internos do validador.
 */
export function parseEditorContent(input: unknown): ParseEditorContentResult {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return fail("Conteúdo não serializável.");
  }
  if (typeof serialized !== "string") return fail("Conteúdo inválido.");
  const bytes = new TextEncoder().encode(serialized).length;
  if (bytes > EDITOR_CONTENT_MAX_BYTES) {
    return fail(`Conteúdo excede o limite de ${EDITOR_CONTENT_MAX_BYTES} bytes.`);
  }
  const { nodes, depth } = measure(input);
  if (depth > EDITOR_CONTENT_MAX_DEPTH) {
    return fail(`Conteúdo excede a profundidade máxima de ${EDITOR_CONTENT_MAX_DEPTH} níveis.`);
  }
  if (nodes > EDITOR_CONTENT_MAX_NODES) {
    return fail(`Conteúdo excede o máximo de ${EDITOR_CONTENT_MAX_NODES} nós.`);
  }

  const parsed = editorContentSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
      path: issue.path.map(String).join("."),
      message: "Estrutura, nó, marca, atributo ou variável não permitidos.",
    }));
    return { ok: false, issues: issues.length > 0 ? issues : [{ path: "", message: "Conteúdo inválido." }] };
  }
  return { ok: true, content: parsed.data, stats: { bytes, nodes, depth } };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

/** SHA-256 (hex) do JSON canônico com chaves ordenadas; independe da ordem das chaves. */
export function hashEditorContent(content: EditorContent): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(content))).digest("hex");
}

type FieldNodeLike = { type?: unknown; attrs?: { key?: unknown }; content?: unknown };

/** Chaves únicas e ordenadas dos campos `documentField` do conteúdo (base de `fieldKeys` do modelo). */
export function collectEditorFieldKeys(content: EditorContent): string[] {
  const keys = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const item = node as FieldNodeLike;
    if (item.type === "documentField" && typeof item.attrs?.key === "string") keys.add(item.attrs.key);
    if (Array.isArray(item.content)) item.content.forEach(walk);
  };
  walk(content);
  return [...keys].sort();
}
