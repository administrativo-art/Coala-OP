#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSecurityContractState } from "./check-security-contracts.mjs";

export function generateSecurityContractInventory(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const { results } = loadSecurityContractState(root);
  const count = (status) => results.filter((route) => route.status === status).length;
  const lines = [
    "# Inventário de contratos de segurança das APIs",
    "",
    "Arquivo gerado. O baseline congela dívida estrutural e **não aprova** autenticação, autorização ou comportamento das rotas legadas.",
    "",
    `- Arquivos de rota: **${results.length}**`,
    `- Totalmente contratados: **${count("CONTRACTED")}**`,
    `- Legados congelados: **${count("LEGACY_BASELINE")}**`,
    `- Exceções temporárias: **${count("EXCEPTION")}**`,
    `- Violações: **${count("VIOLATION")}**`,
    "",
    "Qualquer arquivo de rota novo ou alterado precisa usar `secureRoute` em todos os métodos exportados ou possuir exceção temporária válida. Uma rota só deixa de ser legada quando seus métodos são efetivamente contratados.",
    "",
    "| Rota | Métodos | Estado | Fonte |",
    "| --- | --- | --- | --- |",
  ];
  for (const route of results) {
    const methods = route.methods
      .map((method) => `${method.method}${method.contracted ? " ✓" : ""}`)
      .join(", ") || "—";
    const link = `../../${route.source}`;
    lines.push(`| \`${route.route}\` | ${methods} | \`${route.status}\` | [${route.source}](${link}) |`);
  }
  return `${lines.join("\n")}\n`;
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = join(root, "docs", "engineering", "security-contract-inventory.md");
  try {
    const expected = generateSecurityContractInventory(root);
    if (process.argv.includes("--check")) {
      if (!existsSync(output) || readFileSync(output, "utf8") !== expected) {
        throw new Error("security-contract-inventory.md está desatualizado; execute npm run security-contracts:inventory.");
      }
      process.stdout.write("security-contract-inventory.md está atualizado.\n");
    } else {
      writeFileSync(output, expected, { flag: "w" });
      process.stdout.write("Inventário de contratos de segurança atualizado.\n");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
