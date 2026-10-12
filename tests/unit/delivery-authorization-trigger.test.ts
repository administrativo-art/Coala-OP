import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const agents = readFileSync("AGENTS.md", "utf8");
const claude = readFileSync("CLAUDE.md", "utf8");

test("o gatilho compartilhado cobre a entrega integral sem ampliar o escopo", () => {
  assert.match(agents, /Gatilho compartilhado de entrega integral/);
  assert.match(agents, /"arrocha o buriti"/);
  for (const stage of [
    "commits atômicos",
    "preparação de release Android",
    "push",
    "merge dos PRs em `main`",
    "promoção para `production`",
    "validação pós-publicação",
    "remoção dos worktrees temporários",
  ]) assert.match(agents, new RegExp(stage));
  assert.match(agents, /autoriza somente a conclusão do escopo que já estiver definido/);
  assert.match(agents, /não autoriza migração ou escrita avulsa em banco real/);
  assert.match(agents, /não autoriza[\s\S]*operação financeira/);
  assert.match(agents, /não autoriza[\s\S]*controle de navegador/);
  assert.match(agents, /não dispara o fluxo quando estiver apenas citada/);
});

test("Claude importa a regra canônica compartilhada", () => {
  assert.match(claude, /^@AGENTS\.md$/m);
  assert.match(claude, /"arrocha o buriti"/);
  assert.match(claude, /definição canônica/);
});
