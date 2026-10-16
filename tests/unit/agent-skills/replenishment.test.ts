import assert from "node:assert/strict";
import { lstatSync, readFileSync, realpathSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../../");
const skillRoot = join(repositoryRoot, ".agents", "skills", "coala-reposicao");

test("contrato da skill de reposição mantém cálculo, limites e entrada Claude", () => {
  const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
  const openai = readFileSync(join(skillRoot, "agents", "openai.yaml"), "utf8");
  const cases = JSON.parse(readFileSync(join(skillRoot, "evals", "cases.json"), "utf8")) as unknown;
  const claudeEntry = join(repositoryRoot, ".claude", "skills", "coala-reposicao");

  for (const phrase of [
    "Mostre esse valor como **Comprar**",
    "Nunca use a quantidade da compra anterior como recomendação atual",
    "Converta **Comprar** para unidades inteiras do derivado selecionado e arredonde para cima",
    "Agrupe a lista final pelo fornecedor",
    "Sem derivado definido pela última compra",
  ]) {
    assert.equal(skill.includes(phrase), true, `frase ausente na skill: ${phrase}`);
  }

  assert.doesNotMatch(skill, /TODO|PLACEHOLDER|TBD/);
  assert.match(openai, /allow_implicit_invocation: true/);
  assert.match(openai, /\$coala-reposicao/);
  assert.ok(Array.isArray(cases));
  assert.ok(cases.length >= 3);
  assert.equal(lstatSync(claudeEntry).isSymbolicLink(), true);
  assert.equal(
    realpathSync(resolve(dirname(claudeEntry), readlinkSync(claudeEntry))),
    realpathSync(skillRoot),
  );
});
