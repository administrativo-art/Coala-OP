#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PATTERNS = [
  { type: "PRIVATE_KEY", expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi },
  { type: "BEARER_TOKEN", expression: /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}={0,2}/gi },
  { type: "JWT", expression: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    type: "NAMED_SECRET",
    expression: /\b(?:api[_-]?key|secret|token|password|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9._~+\/-]{12,}/gi,
  },
  { type: "EMAIL", expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: "CPF", expression: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g },
  { type: "BRAZIL_PHONE", expression: /(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}\b/g },
];

function maskMatch(value) {
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***`;
  }
  if (value.length <= 8) return "***";
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

export function scanSensitiveText(text) {
  const findings = [];
  for (const pattern of PATTERNS) {
    pattern.expression.lastIndex = 0;
    for (const match of text.matchAll(pattern.expression)) {
      findings.push({
        type: pattern.type,
        index: match.index ?? 0,
        preview: maskMatch(match[0]),
      });
    }
  }
  return findings.sort((left, right) => left.index - right.index || left.type.localeCompare(right.type));
}

export function scanSensitiveFile(filePath) {
  return scanSensitiveText(readFileSync(filePath, "utf8"));
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Informe o arquivo que deve ser verificado.");
    process.exitCode = 1;
  } else {
    try {
      const findings = scanSensitiveFile(resolve(filePath));
      if (findings.length) {
        console.error(`Conteúdo sensível detectado (${findings.length} ocorrência(s)).`);
        for (const finding of findings) {
          console.error(`- ${finding.type} na posição ${finding.index}: ${finding.preview}`);
        }
        process.exitCode = 2;
      } else {
        process.stdout.write("Nenhum padrão sensível evidente foi encontrado.\n");
      }
    } catch (error) {
      console.error(`Não foi possível verificar o conteúdo sensível: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
