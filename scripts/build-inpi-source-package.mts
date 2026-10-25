import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { selectRepPSourceFiles, type RepPSourceScope } from './lib/inpi-controle-ponto-scope';

const root = fileURLToPath(new URL('..', import.meta.url));
export const REP_P_SCOPE_PATH = 'config/inpi-controle-ponto-source-scope.json';

const sha256Of = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

const valueAfter = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const parseScope = (raw: string) => JSON.parse(raw) as RepPSourceScope;

const checkWorktreeScope = () => {
  const rawScope = readFileSync(resolve(root, REP_P_SCOPE_PATH), 'utf8');
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  const selected = selectRepPSourceFiles(files, parseScope(rawScope));
  console.log(JSON.stringify({
    mode: 'worktree-preflight',
    scopeFile: REP_P_SCOPE_PATH,
    scopeSha256: sha256Of(rawScope),
    fileCount: selected.length,
    fileListSha256: sha256Of(`${selected.join('\n')}\n`),
  }, null, 2));
};

const buildCommittedPackage = (requestedRef: string, requestedOut: string) => {
  const commit = git(['rev-parse', '--verify', `${requestedRef}^{commit}`]);
  const tree = git(['rev-parse', `${commit}^{tree}`]);
  const files = git(['ls-tree', '-r', '--name-only', commit]).split('\n').filter(Boolean);
  let rawScope: string;
  try {
    rawScope = git(['show', `${commit}:${REP_P_SCOPE_PATH}`]);
  } catch {
    throw new Error(`A revisão ${commit} não contém ${REP_P_SCOPE_PATH}.`);
  }
  const scope = parseScope(rawScope);
  const selected = selectRepPSourceFiles(files, scope);
  const short = commit.slice(0, 12);
  const outDir = resolve(requestedOut);
  const archiveName = `${scope.archiveSlug}-source-${short}.zip`;
  const archivePath = resolve(outDir, archiveName);
  const manifestPath = resolve(outDir, `${scope.archiveSlug}-source-${short}.manifest.json`);
  mkdirSync(outDir, { recursive: true, mode: 0o700 });

  const temporaryDirectory = mkdtempSync(join(outDir, '.inpi-controle-ponto-'));
  const temporaryArchive = resolve(temporaryDirectory, archiveName);
  try {
    execFileSync('git', [
      'archive', '--format=zip', `--prefix=${scope.archiveSlug}-${short}/`, `--output=${temporaryArchive}`,
      commit, '--', ...selected,
    ], { cwd: root, stdio: 'inherit' });
    const archive = readFileSync(temporaryArchive);
    const sha256 = sha256Of(archive);
    if (existsSync(archivePath)) {
      const existingSha256 = sha256Of(readFileSync(archivePath));
      if (existingSha256 !== sha256) {
        throw new Error('O ZIP preservado para esta revisão possui outro hash; não foi sobrescrito.');
      }
    } else {
      copyFileSync(temporaryArchive, archivePath, constants.COPYFILE_EXCL);
    }

    const manifest = {
      schemaVersion: 2,
      purpose: 'INPI software registration technical-content archive',
      programName: scope.programName,
      scopeDescription: scope.description,
      holder: { legalName: 'CT SORVETES LTDA', cnpj: '14.276.603/0001-25' },
      requestedRef,
      commit,
      tree,
      scopeFile: REP_P_SCOPE_PATH,
      scopeSha256: sha256Of(rawScope),
      fileCount: selected.length,
      fileListSha256: sha256Of(`${selected.join('\n')}\n`),
      files: selected,
      archiveFile: basename(archivePath),
      archiveBytes: archive.byteLength,
      hashAlgorithm: 'SHA-256',
      sha256,
      preservation: 'Preservar este ZIP exato. Recompactar ou alterar qualquer byte produz outro hash.',
    };
    const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    if (existsSync(manifestPath)) {
      const existing = readFileSync(manifestPath, 'utf8');
      if (existing !== serializedManifest) {
        throw new Error('O manifesto preservado para esta revisão diverge; não foi sobrescrito.');
      }
    } else {
      writeFileSync(manifestPath, serializedManifest, { mode: 0o600, flag: 'wx' });
    }
    console.log(JSON.stringify({
      archivePath,
      manifestPath,
      commit,
      tree,
      fileCount: selected.length,
      archiveBytes: archive.byteLength,
      sha256,
    }, null, 2));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

const main = () => {
  if (process.argv.includes('--check-worktree')) return checkWorktreeScope();
  const requestedRef = valueAfter('--ref');
  const requestedOut = valueAfter('--out-dir');
  if (!requestedRef || !requestedOut) {
    throw new Error('Use --check-worktree ou --ref <commit/tag> --out-dir <pasta-segura>.');
  }
  buildCommittedPackage(requestedRef, requestedOut);
};

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) main();
