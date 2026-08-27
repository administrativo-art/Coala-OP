import Docxtemplater from "docxtemplater";
import expressionParser from "docxtemplater/expressions.js";
import PizZip from "pizzip";

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function encodeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function normalizeTextFragment(xml: string, stack: string[] = [], requireClosed = true) {
  const textPattern = /<w:t(?=[\s>])([^>]*)>([\s\S]*?)<\/w:t>/g;
  const nodes: Array<{ full: string; attrs: string; value: string; start: number; end: number }> = [];
  let logical = "";
  let match: RegExpExecArray | null;
  while ((match = textPattern.exec(xml))) {
    const value = decodeXml(match[2]);
    const start = logical.length;
    logical += value;
    nodes.push({ full: match[0], attrs: match[1], value, start, end: logical.length });
  }
  const tags = Array.from(logical.matchAll(/\{\{([\s\S]*?)\}\}/g));
  const replacements = tags.map((tag) => {
    const raw = tag[1].trim();
    let next = tag[0];
    if (raw.startsWith("#if ")) {
      const expression = raw.slice(4).trim(); stack.push(expression); next = `{{#${expression}}}`;
    } else if (raw === "/if") {
      const expression = stack.pop() ?? "false"; next = `{{/${expression}}}`;
    } else if (raw.startsWith("#unless ")) {
      const expression = `!(${raw.slice(8).trim()})`; stack.push(expression); next = `{{#${expression}}}`;
    } else if (raw === "/unless") {
      const expression = stack.pop() ?? "false"; next = `{{/${expression}}}`;
    }
    return { start: tag.index ?? 0, end: (tag.index ?? 0) + tag[0].length, next };
  });
  if (requireClosed && stack.length) throw new Error("Condicional #if/#unless sem fechamento no modelo DOCX.");

  replacements.reverse().forEach((replacement) => {
    const first = nodes.findIndex((node) => replacement.start >= node.start && replacement.start < node.end);
    const last = nodes.findIndex((node) => replacement.end > node.start && replacement.end <= node.end);
    if (first < 0 || last < 0) return;
    const startOffset = replacement.start - nodes[first].start;
    const endOffset = replacement.end - nodes[last].start;
    if (first === last) nodes[first].value = nodes[first].value.slice(0, startOffset) + replacement.next + nodes[first].value.slice(endOffset);
    else {
      nodes[first].value = nodes[first].value.slice(0, startOffset) + replacement.next;
      for (let index = first + 1; index < last; index += 1) nodes[index].value = "";
      nodes[last].value = nodes[last].value.slice(endOffset);
    }
  });

  let index = 0;
  return xml.replace(textPattern, () => {
    const node = nodes[index++];
    return `<w:t${node.attrs}>${encodeXml(node.value)}</w:t>`;
  });
}

/**
 * Reúne tags partidas em vários runs sem permitir que um placeholder atravesse
 * parágrafos. A visão lógica é virtual: o OOXML inteiro não é "limpo" nem tem
 * bookmarks, revisões ou propriedades de run reescritos globalmente.
 */
export function normalizeDocxTemplateXml(xml: string) {
  const paragraphPattern = /<w:p\b[\s\S]*?<\/w:p>/g;
  if (!paragraphPattern.test(xml)) return normalizeTextFragment(xml);
  paragraphPattern.lastIndex = 0;
  const stack: string[] = [];
  const normalized = xml.replace(
    paragraphPattern,
    (paragraph) => normalizeTextFragment(paragraph, stack, false),
  );
  if (stack.length) throw new Error("Condicional #if/#unless sem fechamento no modelo DOCX.");
  return normalized;
}

const STORY_PART_PATTERN = /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/;

function normalizedZip(input: Buffer) {
  const zip = new PizZip(input);
  Object.keys(zip.files)
    .filter((name) => STORY_PART_PATTERN.test(name))
    .forEach((name) => {
      const xml = zip.file(name)?.asText();
      if (xml) zip.file(name, normalizeDocxTemplateXml(xml));
    });
  return zip;
}

function sanitizeGeneratedMetadata(zip: PizZip) {
  const corePath = "docProps/core.xml";
  const core = zip.file(corePath)?.asText();
  if (!core) return;
  const replace = (xml: string, tag: string, value: string) => {
    const pattern = new RegExp(`(<${tag}(?:\\s[^>]*)?>)[\\s\\S]*?(<\\/${tag}>)`);
    return pattern.test(xml)
      ? xml.replace(pattern, `$1${encodeXml(value)}$2`)
      : xml;
  };
  zip.file(
    corePath,
    replace(
      replace(core, "dc:creator", "Coala One"),
      "cp:lastModifiedBy",
      "Coala One",
    ),
  );
}

function replaceTextInFragment(xml: string, search: string, replacement: string) {
  const textPattern = /<w:t(?=[\s>])([^>]*)>([\s\S]*?)<\/w:t>/g;
  const nodes: Array<{ attrs: string; value: string; start: number; end: number }> = [];
  let logical = "";
  let match: RegExpExecArray | null;
  while ((match = textPattern.exec(xml))) {
    const value = decodeXml(match[2]);
    const start = logical.length;
    logical += value;
    nodes.push({ attrs: match[1], value, start, end: logical.length });
  }

  const occurrences: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while ((cursor = logical.indexOf(search, cursor)) >= 0) {
    occurrences.push({ start: cursor, end: cursor + search.length });
    cursor += search.length;
  }

  occurrences.reverse().forEach((occurrence) => {
    const first = nodes.findIndex((node) => occurrence.start >= node.start && occurrence.start < node.end);
    const last = nodes.findIndex((node) => occurrence.end > node.start && occurrence.end <= node.end);
    if (first < 0 || last < 0) return;
    const startOffset = occurrence.start - nodes[first].start;
    const endOffset = occurrence.end - nodes[last].start;
    if (first === last) {
      nodes[first].value = `${nodes[first].value.slice(0, startOffset)}${replacement}${nodes[first].value.slice(endOffset)}`;
      return;
    }
    nodes[first].value = `${nodes[first].value.slice(0, startOffset)}${replacement}`;
    for (let index = first + 1; index < last; index += 1) nodes[index].value = "";
    nodes[last].value = nodes[last].value.slice(endOffset);
  });

  let index = 0;
  const output = xml.replace(textPattern, () => {
    const node = nodes[index++];
    return `<w:t${node.attrs}>${encodeXml(node.value)}</w:t>`;
  });
  return { xml: output, replacements: occurrences.length };
}

function replaceTextInXml(xml: string, search: string, replacement: string) {
  const paragraphPattern = /<w:p\b[\s\S]*?<\/w:p>/g;
  if (!paragraphPattern.test(xml)) return replaceTextInFragment(xml, search, replacement);
  paragraphPattern.lastIndex = 0;
  let replacements = 0;
  const output = xml.replace(paragraphPattern, (paragraph) => {
    const result = replaceTextInFragment(paragraph, search, replacement);
    replacements += result.replacements;
    return result.xml;
  });
  return { xml: output, replacements };
}

/** Converte texto literal existente no Word em um placeholder sem exigir novo upload. */
export function replaceDocxTextWithVariable(input: Buffer, searchText: string, variableKey: string) {
  const search = searchText.trim();
  const key = variableKey.trim();
  if (!search) throw new Error("Informe o texto exato que será substituído.");
  if (!/^[a-z][a-z0-9_.]*$/i.test(key)) throw new Error("Variável inválida.");

  const zip = new PizZip(input);
  let replacements = 0;
  Object.keys(zip.files)
    .filter((name) => STORY_PART_PATTERN.test(name))
    .forEach((name) => {
      const xml = zip.file(name)?.asText();
      if (!xml) return;
      const result = replaceTextInXml(xml, search, `{{${key}}}`);
      replacements += result.replacements;
      zip.file(name, result.xml);
    });
  if (!replacements) throw new Error(`O texto “${search}” não foi encontrado no DOCX.`);
  return {
    buffer: zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer,
    replacements,
  };
}

/** Substituição literal determinística usada somente na preparação controlada de matrizes. */
export function replaceDocxText(
  input: Buffer,
  searchText: string,
  replacementText: string,
) {
  const search = searchText.trim();
  if (!search) throw new Error("Informe o texto exato que será substituído.");
  const zip = new PizZip(input);
  let replacements = 0;
  Object.keys(zip.files)
    .filter((name) => STORY_PART_PATTERN.test(name))
    .forEach((name) => {
      const xml = zip.file(name)?.asText();
      if (!xml) return;
      const result = replaceTextInXml(xml, search, replacementText);
      replacements += result.replacements;
      zip.file(name, result.xml);
    });
  if (!replacements) throw new Error(`O texto “${search}” não foi encontrado no DOCX.`);
  return {
    buffer: zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer,
    replacements,
  };
}

function paragraphText(xml: string) {
  return Array.from(xml.matchAll(/<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) => decodeXml(match[1]))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove parágrafos por texto exato, preservando todas as demais partes OOXML. */
export function removeDocxParagraphsByExactText(
  input: Buffer,
  expectedTexts: readonly string[],
  options?: { maximumPerText?: number },
) {
  const wanted = new Set(expectedTexts.map((value) => value.replace(/\s+/g, " ").trim()));
  const removed = new Map<string, number>();
  const zip = new PizZip(input);
  Object.keys(zip.files)
    .filter((name) => STORY_PART_PATTERN.test(name))
    .forEach((name) => {
      const xml = zip.file(name)?.asText();
      if (!xml) return;
      const output = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
        const text = paragraphText(paragraph);
        if (!wanted.has(text)) return paragraph;
        if (
          options?.maximumPerText !== undefined
          && (removed.get(text) ?? 0) >= options.maximumPerText
        ) {
          return paragraph;
        }
        removed.set(text, (removed.get(text) ?? 0) + 1);
        return "";
      });
      zip.file(name, output);
    });
  return {
    buffer: zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer,
    removed: Object.fromEntries(removed),
  };
}

export function extractDocxVariables(input: Buffer) {
  const zip = normalizedZip(input);
  const keys = new Set<string>();
  Object.keys(zip.files).filter((name) => STORY_PART_PATTERN.test(name)).forEach((name) => {
    const xml = decodeXml(zip.file(name)?.asText() ?? "");
    for (const tag of xml.matchAll(/\{\{[#/]?\s*([^{}]+?)\s*\}\}/g)) {
      const expression = tag[1].replace(/^if\s+|^unless\s+/, "").trim();
      if (/^[a-z][a-z0-9_.]*$/i.test(expression)) keys.add(expression);
    }
  });
  return Array.from(keys).sort();
}

export function generateDocx(input: Buffer, data: Record<string, unknown>) {
  const template = new Docxtemplater(normalizedZip(input), {
    delimiters: { start: "{{", end: "}}" },
    parser: expressionParser,
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  template.render(data);
  const zip = template.getZip();
  sanitizeGeneratedMetadata(zip);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
