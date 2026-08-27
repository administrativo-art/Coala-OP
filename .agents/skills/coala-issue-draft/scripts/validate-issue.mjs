#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scanSensitiveText } from "./scan-sensitive-content.mjs";

export const ISSUE_HEADINGS = [
  "Status do rascunho",
  "Origem",
  "Ambiente",
  "Falha observada",
  "Evidências",
  "Passos de reprodução",
  "Comportamento esperado",
  "Comportamento ocorrido",
  "Impacto",
  "Classe da falha",
  "Contrato ou invariante possivelmente violado",
  "Superfícies potencialmente afetadas",
  "Escopo",
  "Não escopo",
  "Causa confirmada",
  "Hipóteses ainda não verificadas",
  "Teste de regressão esperado",
  "Validação pós-implantação",
  "Dados removidos ou anonimizados",
  "Pendências para completar a issue",
];

function repositoryRoot(cwd) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sectionBody(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

export function validateIssueDocument({ filePath, repositoryRoot: root, markdown }) {
  const errors = [];
  const absolute = resolve(filePath);
  const expectedRoot = resolve(realpathSync(root), ".ai-work", "issues");
  let canonicalCandidate = absolute;
  try {
    canonicalCandidate = join(realpathSync(dirname(absolute)), basename(absolute));
  } catch {
    // A validação detalhada do diretório abaixo produzirá uma mensagem específica.
  }
  const relativePath = relative(expectedRoot, canonicalCandidate);
  if (relativePath.startsWith("..") || relativePath === "" || relativePath.split(sep).includes("..")) {
    errors.push("O arquivo deve estar dentro de .ai-work/issues/.");
  }

  try {
    const realParent = realpathSync(dirname(absolute));
    const realExpected = realpathSync(expectedRoot);
    if (realParent !== realExpected && !realParent.startsWith(`${realExpected}${sep}`)) {
      errors.push("O diretório do arquivo resolve para fora de .ai-work/issues/.");
    }
  } catch {
    errors.push("Não foi possível confirmar o diretório real do arquivo.");
  }

  if (!/^#\s+\S.+/m.test(markdown)) errors.push("Título principal ausente ou vazio.");
  for (const heading of ISSUE_HEADINGS) {
    if (!new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(markdown)) {
      errors.push(`Heading obrigatório ausente: ${heading}.`);
    }
  }

  const status = sectionBody(markdown, "Status do rascunho");
  if (!/^(PRONTO PARA REVISÃO|INCOMPLETO)\b/.test(status)) {
    errors.push("Status do rascunho deve ser PRONTO PARA REVISÃO ou INCOMPLETO.");
  }
  if (scanSensitiveText(markdown).length) errors.push("O documento contém padrões sensíveis evidentes.");
  return { valid: errors.length === 0, errors };
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const input = process.argv[2];
  if (!input) {
    console.error("Informe o arquivo de issue que deve ser validado.");
    process.exitCode = 1;
  } else {
    try {
      const filePath = resolve(input);
      const root = repositoryRoot(dirname(filePath));
      const result = validateIssueDocument({ filePath, repositoryRoot: root, markdown: readFileSync(filePath, "utf8") });
      if (!result.valid) {
        for (const error of result.errors) console.error(`- ${error}`);
        process.exitCode = 2;
      } else {
        process.stdout.write("Rascunho de issue válido.\n");
      }
    } catch (error) {
      console.error(`Não foi possível validar o rascunho: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
