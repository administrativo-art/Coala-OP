#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_SKILLS = [
  "coala-issue-draft",
  "coala-handoff",
  "coala-resume-handoff",
  "coala-security-scan",
  "coala-supply-chain-audit",
  "coala-error-triage",
];

export const MAX_SKILL_BYTES = 12_000;

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([a-z][a-z0-9-]*):\s*(.*)$/i);
    if (!field) continue;
    let value = field[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else if (value === "true" || value === "false") value = value === "true";
    data[field[1]] = value;
  }
  return data;
}

function sensitivePattern(file, text) {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
    /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/i,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    /\b(?:api[_-]?key|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9._~+\/-]{12,}/i,
  ];
  return patterns.some((pattern) => pattern.test(text)) ? `Possível segredo hardcoded em ${file}.` : null;
}

function validateReferencedFiles(repositoryRoot, skillRoot, markdown, errors) {
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const reference = match[1].split("#")[0];
    if (!reference || /^(?:https?:|#)/.test(reference)) continue;
    if (!existsSync(resolve(skillRoot, reference))) errors.push(`Referência relativa inexistente em ${relative(repositoryRoot, skillRoot)}: ${reference}.`);
  }
  const skillName = skillRoot.split("/").pop();
  const scriptPattern = new RegExp(`\\.agents/skills/${skillName}/(scripts/[A-Za-z0-9._/-]+)`, "g");
  for (const match of markdown.matchAll(scriptPattern)) {
    if (!existsSync(join(skillRoot, match[1]))) errors.push(`Script citado não existe: ${match[0]}.`);
  }
}

function validateExecutableScripts(repositoryRoot, skillRoot, errors) {
  const directory = join(skillRoot, "scripts");
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
    const file = join(directory, entry.name);
    const source = readFileSync(file, "utf8");
    if (!source.includes("console.error")) errors.push(`Script sem mensagem de erro: ${relative(repositoryRoot, file)}.`);
    if (!source.includes("process.exitCode")) errors.push(`Script sem exit code explícito: ${relative(repositoryRoot, file)}.`);
    const secret = sensitivePattern(relative(repositoryRoot, file), source);
    if (secret) errors.push(secret);
  }
}

function validateDangerousWorkflow(skillFile, markdown, errors) {
  const dangerous = /\b(?:git\s+push|gh\s+(?:issue|pr)\s+(?:create|edit|close|merge)|npm\s+(?:update|install)|(?:deploy|rollout)\s+--)/i;
  for (const [index, line] of markdown.split("\n").entries()) {
    if (!dangerous.test(line)) continue;
    if (/\b(?:não|nunca|proibid[oa]|forbidden|sem)\b/i.test(line)) continue;
    errors.push(`Comando mutável sem negação explícita em ${skillFile}:${index + 1}.`);
  }
}

export function validateAgentSkills(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const errors = [];
  const checked = [];
  const names = new Set();

  for (const skillName of REQUIRED_SKILLS) {
    const skillRoot = join(root, ".agents", "skills", skillName);
    const skillFile = join(skillRoot, "SKILL.md");
    const openaiFile = join(skillRoot, "agents", "openai.yaml");
    const claudePath = join(root, ".claude", "skills", skillName);
    if (!existsSync(skillRoot)) {
      errors.push(`Skill ausente: ${skillName}.`);
      continue;
    }
    if (!existsSync(skillFile)) {
      errors.push(`SKILL.md ausente: ${skillName}.`);
      continue;
    }

    const markdown = readFileSync(skillFile, "utf8");
    const metadata = parseFrontmatter(markdown);
    if (!metadata) errors.push(`Frontmatter Agent Skills base ausente: ${skillName}.`);
    else {
      if (metadata.name !== skillName) errors.push(`Nome da skill não corresponde ao diretório: ${skillName}.`);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name ?? "")) errors.push(`Nome fora de kebab-case: ${skillName}.`);
      if (!metadata.description || String(metadata.description).length < 40) errors.push(`Descrição ausente ou genérica: ${skillName}.`);
      if (metadata["disable-model-invocation"] !== true) errors.push(`Extensão Claude de invocação manual ausente: ${skillName}.`);
      if (metadata["user-invocable"] !== true) errors.push(`Skill não está marcada como invocável pelo usuário no Claude: ${skillName}.`);
      if (names.has(metadata.name)) errors.push(`Nome duplicado no cliente canônico: ${metadata.name}.`);
      names.add(metadata.name);
    }
    if (Buffer.byteLength(markdown, "utf8") > MAX_SKILL_BYTES) errors.push(`SKILL.md excede ${MAX_SKILL_BYTES} bytes: ${skillName}.`);
    if (/allowed-tools:\s*.*(?:Bash\(\*\)|\*)/i.test(markdown)) errors.push(`Permissão irrestrita detectada: ${skillName}.`);
    if (!markdown.includes(".ai-work/")) errors.push(`Caminho de saída .ai-work não documentado: ${skillName}.`);
    validateReferencedFiles(root, skillRoot, markdown, errors);
    validateDangerousWorkflow(relative(root, skillFile), markdown, errors);
    validateExecutableScripts(root, skillRoot, errors);
    const secret = sensitivePattern(relative(root, skillFile), markdown);
    if (secret) errors.push(secret);

    if (!existsSync(openaiFile)) errors.push(`Configuração Codex ausente: ${skillName}.`);
    else {
      const openai = readFileSync(openaiFile, "utf8");
      if (!/^policy:\s*$[\s\S]*?^\s{2}allow_implicit_invocation:\s*false\s*$/m.test(openai)) {
        errors.push(`Política Codex de invocação manual ausente: ${skillName}.`);
      }
      if (!openai.includes(`$${skillName}`)) errors.push(`default_prompt do Codex não cita $${skillName}.`);
    }

    if (!existsSync(claudePath)) errors.push(`Entrada Claude ausente: ${skillName}.`);
    else {
      const stat = lstatSync(claudePath);
      if (!stat.isSymbolicLink()) errors.push(`Entrada Claude deve ser symlink: ${skillName}.`);
      else if (realpathSync(claudePath) !== realpathSync(skillRoot)) errors.push(`Symlink Claude aponta para origem incorreta: ${skillName}.`);
    }

    const evalsFile = join(skillRoot, "evals", "cases.json");
    if (!existsSync(evalsFile)) errors.push(`Casos de avaliação ausentes: ${skillName}.`);
    else {
      try {
        const cases = JSON.parse(readFileSync(evalsFile, "utf8"));
        if (!Array.isArray(cases) || !cases.length) errors.push(`Casos de avaliação vazios: ${skillName}.`);
        else if (cases.some((item) => !item.name || !item.input || !Array.isArray(item.expected_behaviors) || !Array.isArray(item.forbidden_behaviors))) {
          errors.push(`Contrato inválido em evals/cases.json: ${skillName}.`);
        }
      } catch (error) {
        errors.push(`JSON inválido em evals/cases.json de ${skillName}: ${error.message}`);
      }
    }

    checked.push({
      name: skillName,
      agentSkillsBase: Boolean(metadata?.name && metadata?.description),
      claudeExtension: metadata?.["disable-model-invocation"] === true,
      codexPolicy: existsSync(openaiFile),
      coalaOutputRule: markdown.includes(".ai-work/"),
    });
  }

  const ignoreFile = join(root, ".gitignore");
  if (!existsSync(ignoreFile) || !/^\/?\.ai-work\/?$/m.test(readFileSync(ignoreFile, "utf8"))) {
    errors.push(".ai-work/ não está ignorado pelo Git.");
  }

  return { valid: errors.length === 0, errors, checked };
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const result = validateAgentSkills(repositoryRoot);
    if (!result.valid) {
      console.error(`Validação das Agent Skills falhou com ${result.errors.length} erro(s):`);
      for (const error of result.errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`Agent Skills válidas: ${result.checked.map((item) => item.name).join(", ")}\n`);
    }
  } catch (error) {
    console.error(`Não foi possível validar as Agent Skills: ${error.message}`);
    process.exitCode = 1;
  }
}
