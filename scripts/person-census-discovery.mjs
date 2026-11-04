import { readFileSync, realpathSync, lstatSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { matchesPersonWorkspace } from '../src/features/privacy/person-workspace.ts';
import { CENSUS_FIELDS, safeIdentifier } from './person-census-core.mjs';

const IDENTITY = new Set(['main/users', 'hr/employees', 'hr/candidates']);
const DOCUMENTS = new Set(['main/generatedDocuments', 'hr/employeeDocuments', 'hr/hrSignatureRequests', 'hr/onboardingProcesses']);
export function loadIdentityCensus({ runDir, privateRoot, projectId, workspace, mode, policySha256, maxRows }) {
  const directory = resolve(runDir);
  const rel = relative(privateRoot, realpathSync(directory));
  if (!rel || rel.startsWith('..') || rel.startsWith('/') || lstatSync(directory).isSymbolicLink()) throw new Error('Censo de identidade fora do diretório privado.');
  const file = join(directory, 'census.jsonl'); const manifestFile = join(directory, 'manifest.json');
  for (const path of [file, manifestFile]) if (lstatSync(path).isSymbolicLink() || (statSync(path).mode & 0o077)) throw new Error('Arquivo de identidade deve ser privado 0600.');
  if (statSync(file).size > 2_000_000) throw new Error('Censo de identidade acima do teto.');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const raw = readFileSync(file, 'utf8');
  const hash = createHash('sha256').update(raw).digest('hex');
  const lines = raw.split('\n').filter(Boolean);
  if (manifest.schema !== 1 || manifest.status !== 'complete' || manifest.gaps?.length || manifest.mode !== mode
    || manifest.projectId !== projectId || manifest.workspace !== workspace || manifest.sha256 !== hash
    || manifest.rows !== lines.length || lines.length > maxRows || manifest.legacyDeployment?.policySha256 !== policySha256
    || !['main/users', 'hr/employees', 'hr/candidates'].every((source) => manifest.sources?.some((entry) =>
      `${entry.database}/${entry.collection}` === source && entry.scopeField === 'legacy-deployment' && entry.status === 'complete'))) throw new Error('Censo de identidade incompleto ou divergente.');
  const rows = lines.map((line) => JSON.parse(line));
  if (rows.some((row) => !IDENTITY.has(`${row.database}/${row.collection}`) || !safeIdentifier(row.id)
    || !matchesPersonWorkspace(row.data, workspace, row.scopeEvidence === 'legacy-deployment')
    || !['legacy-deployment', 'explicit-workspace'].includes(row.scopeEvidence))) throw new Error('Linha de identidade inválida.');
  return { rows, sha256: hash };
}

export async function discoverLegacyDocumentTargets({ dbFor, selected, identityRows, workspace, pageSize, maxReads, maxQueries, maxTargets }) {
  if (selected.some((source) => !DOCUMENTS.has(`${source.database}/${source.collection}`))) throw new Error('Fonte documental fora da descoberta.');
  const bySource = new Map(selected.map((source) => [`${source.database}/${source.collection}`, source]));
  const users = identityRows.filter((row) => row.database === 'main' && row.collection === 'users');
  const employees = identityRows.filter((row) => row.database === 'hr' && row.collection === 'employees');
  const candidates = identityRows.filter((row) => row.database === 'hr' && row.collection === 'candidates');
  const subjects = [...users.map((row) => ({ namespace: 'main.users', id: row.id })),
    ...employees.map((row) => ({ namespace: 'hr.employees', id: row.id }))];
  const candidateIds = new Set(candidates.map((row) => row.id)); // Only backed candidate rows; native manual/PJ placeholders are never candidates.
  const candidatesRefs = [...candidateIds].map((id) => ({ namespace: 'hr.candidates', id }));
  const targets = [];
  const searched = new Set();
  let reads = 0; let queries = 0; let rejectedScope = 0; let limitReached = false;
  async function search(source, field, value, subject) {
    if (!source || !safeIdentifier(value)) return;
    const queryKey = `${source.database}/${source.collection}/${field}/${value}/${subject.namespace}/${subject.id}`;
    if (searched.has(queryKey)) return;
    searched.add(queryKey);
    let cursor = null;
    for (;;) {
      if (reads >= maxReads || queries >= maxQueries || targets.length >= maxTargets) { limitReached = true; return; }
      const size = Math.min(pageSize, maxReads - reads);
      let query = dbFor(source.database).collection(source.collection).where(field, '==', value).orderBy('__name__').limit(size);
      if (cursor) query = query.startAfter(cursor);
      const snap = await query.select(...CENSUS_FIELDS).get();
      reads += Math.max(1, snap.size); queries++;
      for (const doc of snap.docs) {
        if (!safeIdentifier(doc.id) || cursor && doc.id <= cursor) throw new Error('cursor_repeated');
        if (!matchesPersonWorkspace(doc.data(), workspace, true)) { rejectedScope++; continue; }
        targets.push({ database: source.database, collection: source.collection, id: doc.id, subject });
        if (targets.length >= maxTargets) { limitReached = true; return; }
      }
      if (!snap.docs.length || snap.docs.length < size) return;
      cursor = snap.docs.at(-1).id;
    }
  }
  const processes = bySource.get('hr/onboardingProcesses');
  for (const subject of [...subjects.filter((ref) => ref.namespace === 'main.users'), ...candidatesRefs]) {
    await search(processes, subject.namespace === 'main.users' ? 'collaboratorUserId' : 'candidateId', subject.id, subject);
    if (limitReached) break;
  }
  const processTargets = targets.filter((target) => target.collection === 'onboardingProcesses');
  for (const source of selected.filter((item) => item.collection !== 'onboardingProcesses')) {
    for (const subject of subjects) {
      await search(source, 'employeeId', subject.id, subject);
      if (limitReached) break;
    }
    if (limitReached) break;
    for (const process of processTargets) {
      await search(source, 'onboardingId', process.id, process.subject);
      await search(source, 'sourceOnboardingId', process.id, process.subject);
      if (limitReached) break;
    }
    if (limitReached) break;
  }
  return { targets, reads, queries, rejectedScope, status: limitReached || rejectedScope ? 'incomplete' : 'complete',
    reason: limitReached ? 'limit_reached' : rejectedScope ? 'scope_mismatch' : null };
}
