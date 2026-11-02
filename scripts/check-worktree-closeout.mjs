#!/usr/bin/env node

// Read-only aid for the local closeout required by AGENTS.md.
import { existsSync, lstatSync, readlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  const result = spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} falhou`);
  return result.stdout.trim();
}

function worktrees() {
  return git(['worktree', 'list', '--porcelain']).split(/\n\n+/).filter(Boolean).map(block => {
    const lines = block.split('\n');
    return {
      path: resolve(lines.find(line => line.startsWith('worktree ')).slice(9)),
      branch: lines.find(line => line.startsWith('branch '))?.slice(7) ?? null,
    };
  });
}

function parseArgs() {
  const [mode, path, ...rest] = process.argv.slice(2);
  if (!['--audit', '--verify-removed'].includes(mode) || !path) {
    throw new Error('Uso: node scripts/check-worktree-closeout.mjs --audit <worktree> | --verify-removed <worktree> --branch <branch> [--archive <diretório>]');
  }
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--branch', '--archive'].includes(rest[i]) || !rest[i + 1]) throw new Error('Opção inválida ou sem valor.');
    options[rest[i].slice(2)] = rest[i + 1];
  }
  return { mode, path: resolve(path), options };
}

function inspect(path, entries) {
  const entry = entries.find(item => item.path === path);
  if (!entry) throw new Error('O caminho não é um worktree registrado.');
  if (entries[0].path === path) throw new Error('O checkout principal não é um worktree temporário para encerramento.');
  const status = git(['-C', path, 'status', '--porcelain', '--untracked-files=all']);
  const ignored = git(['-C', path, 'status', '--ignored', '--short', '--untracked-files=normal'])
    .split('\n').filter(line => line.startsWith('!! ')).map(line => line.slice(3));
  const local = ['node_modules', '.next', '.ai-work', '.env.local', 'tsconfig.tsbuildinfo', 'apps/coala-one-android/app/build']
    .flatMap(name => {
      const item = join(path, name);
      if (!existsSync(item) && !isLink(item)) return [];
      const stat = lstatSync(item);
      return [{ name, kind: stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : 'file',
        ...(stat.isSymbolicLink() ? { target: resolve(dirname(item), readlinkSync(item)) } : {}) }];
    });
  const dependencies = join(path, 'node_modules');
  const incomingLinks = entries.filter(item => item.path !== path).flatMap(item => {
    const link = join(item.path, 'node_modules');
    return isLink(link) && resolve(dirname(link), readlinkSync(link)) === dependencies ? [item.path] : [];
  });
  console.log(JSON.stringify({ worktree: path, branch: entry.branch, status: status ? status.split('\n') : [], ignored,
    local, incomingDependencyLinks: incomingLinks }, null, 2));
  console.log('Conferir manualmente: PR/integração, rollout quando aplicável, processos, arquivos exclusivos e integridade do arquivo preservado.');
}

function isLink(path) {
  try { return lstatSync(path).isSymbolicLink(); } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function verifyRemoved(path, options, entries) {
  if (!options.branch || isAbsolute(options.branch) || options.branch.startsWith('refs/')) {
    throw new Error('Informe o nome curto da branch com --branch.');
  }
  const failures = [];
  if (entries.some(item => item.path === path)) failures.push('worktree ainda registrado');
  if (existsSync(path) || isLink(path)) failures.push('diretório ainda presente');
  if (!git(['branch', '--list', '--format=%(refname:short)', options.branch]).split('\n').includes(options.branch)) {
    failures.push('branch local não preservada');
  }
  if (options.archive && (!existsSync(resolve(options.archive)) || !lstatSync(resolve(options.archive)).isDirectory())) {
    failures.push('diretório de arquivo não encontrado');
  }
  if (failures.length) throw new Error(failures.join('; '));
  console.log(`Encerramento local confirmado: ${path}; branch preservada: ${options.branch}${options.archive ? `; arquivo presente: ${resolve(options.archive)}` : ''}.`);
}

try {
  const { mode, path, options } = parseArgs();
  const entries = worktrees();
  if (mode === '--audit') inspect(path, entries);
  else verifyRemoved(path, options, entries);
} catch (error) {
  process.stderr.write(`Falha na checagem de encerramento: ${error.message}\n`);
  process.exitCode = 1;
}
