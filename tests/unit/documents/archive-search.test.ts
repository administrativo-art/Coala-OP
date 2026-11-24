import assert from "node:assert/strict";
import test from "node:test";
import { matchesArchiveSearch, matchingArchiveFolders, normalizeArchiveText, parseArchiveSearch } from "../../../src/lib/documents/archive-search";

test("normaliza acentos, maiúsculas e espaços", () => {
  assert.equal(normalizeArchiveText("  Férias   SAÚDE "), "ferias saude");
});

test("separa termos e mantém frases entre aspas", () => {
  assert.deepEqual(parseArchiveSearch('atestado  "período aquisitivo" Agosto atestado'), ["atestado", "periodo aquisitivo", "agosto"]);
  assert.deepEqual(parseArchiveSearch('   ""  '), []);
});

test("todos os termos precisam aparecer, em qualquer campo e ordem", () => {
  const fields = ["13/08/2026 a 14/08/2026 — Atestado", "Afastamentos › 2026 › Agosto"];
  assert.equal(matchesArchiveSearch(parseArchiveSearch("agosto atestado"), fields), true);
  assert.equal(matchesArchiveSearch(parseArchiveSearch("atestado setembro"), fields), false);
  assert.equal(matchesArchiveSearch([], fields), true);
  assert.equal(matchesArchiveSearch(parseArchiveSearch('"2026 agosto"'), fields), false);
});

test("acha pastas pelo nome e devolve o caminho completo uma vez", () => {
  const paths = [["Férias", "Período aquisitivo 2024-2025", "Parcela 01"], ["Férias", "Período aquisitivo 2024-2025"], ["Afastamentos", "2026", "Agosto"]];
  assert.deepEqual(matchingArchiveFolders(paths, parseArchiveSearch("periodo")), [["Férias", "Período aquisitivo 2024-2025"]]);
  assert.deepEqual(matchingArchiveFolders(paths, parseArchiveSearch("ferias parcela")), [["Férias", "Período aquisitivo 2024-2025", "Parcela 01"]]);
  assert.deepEqual(matchingArchiveFolders(paths, []), []);
});
