import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Classe de cor `*-ds-<nome>` sem `--color-ds-<nome>` no tema não gera CSS: o elemento
// fica sem fundo/cor e pode sumir (ex.: abas do painel de edição do colaborador).
const root = process.cwd();
const globals = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const colorTokens = new Set([...globals.matchAll(/--color-ds-([a-z0-9-]+)\s*:/g)].map((match) => match[1]));

const COLOR_CLASS =
  /(?<![\w-])(?:bg|text|border(?:-[trblxy])?|ring|outline|fill|stroke|divide|placeholder|from|via|to|decoration|caret|accent)-ds-([a-z0-9-]+)(?:\/\d+)?(?![\w-])/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

test("o tema define tokens de cor do design system", () => {
  assert.ok(colorTokens.size > 20, "nenhum --color-ds-* encontrado em globals.css");
});

test("toda classe de cor ds-* usa um token existente", () => {
  const missing: string[] = [];
  for (const file of sourceFiles(path.join(root, "src"))) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(COLOR_CLASS)) {
      if (!colorTokens.has(match[1])) missing.push(`${path.relative(root, file)}: ${match[0]}`);
    }
  }
  assert.deepEqual(missing, [], `classes sem token --color-ds-*:\n${missing.join("\n")}`);
});
