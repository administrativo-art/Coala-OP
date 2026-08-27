#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HANDOFF_HEADINGS = [
  "Objetivo",
  "Estado inicial",
  "Estado atual",
  "Alterações preexistentes",
  "Alterações feitas nesta sessão",
  "Arquivos modificados",
  "Comandos realmente executados",
  "Verificações realmente executadas",
  "Decisões tomadas",
  "Fundamentação",
  "Alternativas rejeitadas",
  "Fatos confirmados",
  "Hipóteses não verificadas",
  "Problemas encontrados",
  "Bloqueios",
  "Pendências",
  "Próximo passo exato",
  "Critério de conclusão",
  "Instrução para retomada",
  "Estado final do Git",
];

export function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { data: null, body: markdown, error: "Frontmatter ausente." };
  const data = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim()) continue;
    const field = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/i);
    if (!field) return { data: null, body: markdown, error: `Linha de frontmatter inválida: ${line}` };
    let value = field[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else if (value === "true" || value === "false") {
      value = value === "true";
    }
    data[field[1]] = value;
  }
  return { data, body: markdown.slice(match[0].length), error: null };
}

export function extractSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return null;
  const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  return lines.slice(start + 1, end).join("\n").trim();
}

export function validateHandoffMarkdown(markdown) {
  const errors = [];
  const parsed = parseFrontmatter(markdown);
  if (parsed.error) errors.push(parsed.error);
  const metadata = parsed.data ?? {};
  const requiredFields = [
    "handoff_version",
    "created_at",
    "repository",
    "branch",
    "base_commit",
    "working_tree_dirty",
    "continuation_mode",
  ];
  for (const field of requiredFields) {
    if (metadata[field] === undefined || metadata[field] === "") errors.push(`Metadado obrigatório ausente: ${field}.`);
  }
  if (metadata.handoff_version !== undefined && metadata.handoff_version !== "1") {
    errors.push("handoff_version deve ser 1.");
  }
  if (metadata.base_commit && !/^[0-9a-f]{40}$/i.test(String(metadata.base_commit))) {
    errors.push("base_commit deve ser um hash Git completo.");
  }
  if (metadata.continuation_mode && metadata.continuation_mode !== "validate-first") {
    errors.push("continuation_mode deve ser validate-first.");
  }
  if (!/^# Handoff — \S.+/m.test(parsed.body)) errors.push("Título principal do handoff ausente ou vazio.");

  for (const heading of HANDOFF_HEADINGS) {
    const section = extractSection(parsed.body, heading);
    if (section === null) errors.push(`Heading obrigatório ausente: ${heading}.`);
  }
  for (const heading of ["Objetivo", "Próximo passo exato", "Critério de conclusão", "Instrução para retomada"]) {
    const section = extractSection(parsed.body, heading);
    if (section !== null && (!section || /^(?:TODO|TBD|PREENCHER|NÃO INFORMADO)$/i.test(section))) {
      errors.push(`Seção crítica vazia ou com placeholder: ${heading}.`);
    }
  }
  return { valid: errors.length === 0, errors, metadata, body: parsed.body };
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const input = process.argv[2];
  if (!input) {
    console.error("Informe o arquivo de handoff que deve ser validado.");
    process.exitCode = 1;
  } else {
    try {
      const result = validateHandoffMarkdown(readFileSync(resolve(input), "utf8"));
      if (!result.valid) {
        for (const error of result.errors) console.error(`- ${error}`);
        process.exitCode = 2;
      } else {
        process.stdout.write("Handoff válido.\n");
      }
    } catch (error) {
      console.error(`Não foi possível validar o handoff: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
