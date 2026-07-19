import Docxtemplater from "docxtemplater";
import expressionParser from "docxtemplater/expressions.js";
import PizZip from "pizzip";

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function encodeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Reúne tags partidas em vários runs do Word e converte #if/#unless para loops condicionais. */
export function normalizeDocxTemplateXml(xml: string) {
  const textPattern = /<w:t([^>]*)>([\s\S]*?)<\/w:t>/g;
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
  const stack: string[] = [];
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
  if (stack.length) throw new Error("Condicional #if/#unless sem fechamento no modelo DOCX.");

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

function normalizedZip(input: Buffer) {
  const zip = new PizZip(input);
  Object.keys(zip.files)
    .filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name))
    .forEach((name) => {
      const xml = zip.file(name)?.asText();
      if (xml) zip.file(name, normalizeDocxTemplateXml(xml));
    });
  return zip;
}

export function extractDocxVariables(input: Buffer) {
  const zip = normalizedZip(input);
  const keys = new Set<string>();
  Object.keys(zip.files).filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name)).forEach((name) => {
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
  return template.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
