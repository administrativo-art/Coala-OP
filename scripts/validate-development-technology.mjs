import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const roles = ['edna', 'gandalf', 'r2d2', 'rocket', 'shuri', 'trinity', 'velma'];
const reviewers = new Set(['gandalf', 'rocket', 'trinity', 'velma']);

function read(path) {
  return readFileSync(path, 'utf8');
}

function tomlValue(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'));
  assert.ok(match, `Chave TOML ausente: ${key}`);
  return match[1].trim();
}

function projectFiles(directory, extension) {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(extension))
    .map((entry) => entry.slice(0, -extension.length))
    .sort();
}

assert.deepEqual(projectFiles('.codex/agents', '.toml'), roles, 'Os sete perfis Codex devem coincidir');
assert.deepEqual(projectFiles('.claude/agents', '.md'), roles, 'Os sete perfis Claude devem coincidir');

const codex = read('.codex/config.toml');
assert.equal(tomlValue(codex, 'model'), '"gpt-6-sol"');
assert.equal(tomlValue(codex, 'default_subagent_model'), '"gpt-6-sol"');
assert.equal(tomlValue(codex, 'max_concurrent_threads_per_session'), '1');
assert.match(codex, /\[agents\]\s*enabled\s*=\s*true/m);

const claude = JSON.parse(read('.claude/settings.json'));
assert.equal(claude.model, 'sonnet');
assert.deepEqual([...claude.availableModels].sort(), ['haiku', 'sonnet']);
assert.equal(claude.enforceAvailableModels, true);
assert.equal(claude.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, '1');
assert.equal(claude.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '1');
assert.equal(claude.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, '1');
assert.equal(claude.env.CLAUDE_CODE_FORK_SUBAGENT, '0');
assert.match(read('CLAUDE.md'), /^@AGENTS\.md$/m);

for (const role of roles) {
  const codexAgent = read(join('.codex/agents', `${role}.toml`));
  assert.equal(tomlValue(codexAgent, 'name'), `"${role}"`);
  assert.match(codexAgent, /\[agents\]\s*enabled\s*=\s*false/m);
  assert.doesNotMatch(codexAgent, /^model\s*=/m, `${role}: modelo deve ser escolhido por tarefa`);
  assert.match(codexAgent, /Não delegue nem invoque outros agentes\./);
  if (reviewers.has(role)) {
    assert.equal(tomlValue(codexAgent, 'sandbox_mode'), '"read-only"');
  }

  const claudeAgent = read(join('.claude/agents', `${role}.md`));
  const frontmatter = claudeAgent.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, `${role}: frontmatter Claude ausente`);
  assert.match(frontmatter[1], new RegExp(`^name: ${role}$`, 'm'));
  const toolLine = frontmatter[1].match(/^tools: (.+)$/m);
  assert.ok(toolLine, `${role}: ferramentas Claude ausentes`);
  const tools = toolLine[1].split(',').map((tool) => tool.trim());
  assert.ok(!tools.includes('Agent'), `${role}: delegação não permitida`);
  if (reviewers.has(role)) {
    assert.deepEqual(tools, ['Read', 'Glob', 'Grep', ...(role === 'gandalf' ? ['WebSearch', 'WebFetch'] : [])]);
  }
  assert.match(claudeAgent, /Não delegue nem invoque outros agentes\./);
}

console.log('Departamento de Desenvolvimento e Tecnologia: sete perfis e limites estáticos válidos.');
