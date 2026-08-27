import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

import {
  REQUIRED_SKILLS,
  validateAgentSkills,
} from "../../../scripts/validate-agent-skills.mjs";

test("descobre e valida as seis skills canônicas", () => {
  const result = validateAgentSkills(process.cwd());
  assert.equal(result.checked.length, 6);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.checked.map((item: { name: string }) => item.name), REQUIRED_SKILLS);
});

test("mantém invocação manual em Claude e Codex", () => {
  for (const skill of REQUIRED_SKILLS) {
    const markdown = readFileSync(join(process.cwd(), ".agents", "skills", skill, "SKILL.md"), "utf8");
    const openai = readFileSync(join(process.cwd(), ".agents", "skills", skill, "agents", "openai.yaml"), "utf8");
    assert.match(markdown, /^disable-model-invocation:\s*true$/m);
    assert.match(markdown, /^user-invocable:\s*true$/m);
    assert.match(openai, /^\s{2}allow_implicit_invocation:\s*false$/m);
  }
});

test("entradas Claude são symlinks relativos para a fonte canônica", () => {
  for (const skill of REQUIRED_SKILLS) {
    const path = join(process.cwd(), ".claude", "skills", skill);
    assert.equal(lstatSync(path).isSymbolicLink(), true);
  }
});

test(".ai-work é ignorado e os adaptadores Claude são versionáveis", () => {
  const ignored = execFileSync("git", ["check-ignore", ".ai-work/probe"], { cwd: process.cwd(), encoding: "utf8" }).trim();
  assert.equal(ignored, ".ai-work/probe");
  const check = spawnSync("git", ["check-ignore", "--no-index", ".claude/skills/coala-issue-draft"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(check.status, 1, check.stdout || check.stderr);
});
