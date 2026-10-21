import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cada atalho fixo da barra lateral tem o mesmo título na barra superior", async () => {
  const [sidebar, header] = await Promise.all([
    readFile(new URL("../../src/components/sidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/components/header.tsx", import.meta.url), "utf8"),
  ]);
  const links = [...sidebar.matchAll(/quickLink\("([^"]+)", "([^"]+)"/gu)].map(([, href, label]) => ({ href, label }));
  assert.ok(links.length >= 2, "atalhos fixos da barra lateral não encontrados");
  const labelMap = header.slice(header.indexOf("const LABEL_MAP"), header.indexOf("};", header.indexOf("const LABEL_MAP")));
  for (const { href, label } of links) {
    // Sem a chave exata, a busca por prefixo devolve o pai (ex.: "/dashboard" → "Painel da gestão").
    assert.ok(labelMap.includes(`"${href}": "${label}"`), `${href} deveria aparecer como "${label}" na barra superior`);
  }
});
