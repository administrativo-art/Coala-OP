import { matchesPersonWorkspace } from '../src/features/privacy/person-workspace.ts';
import { openSync, writeSync, closeSync, mkdirSync, realpathSync, writeFileSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PERSON_SOURCES } from '../src/features/privacy/person-inventory.ts';
import { censusSource, censusLegacyDeploymentSource, projectCensusData, assertCensusProjection, CENSUS_FIELDS, sha256 } from './person-census-core.mjs';
import { verifyCensusTarget, projectedById } from './person-census-targets.mjs';
import { loadIdentityCensus, discoverLegacyDocumentTargets } from './person-census-discovery.mjs';

const args = process.argv.slice(2);
function value(flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; }
function bounded(flag, fallback, ceiling) { const number = Number(value(flag) ?? fallback); if (!Number.isInteger(number) || number < 1 || number > ceiling) throw new Error(`${flag} inválido`); return number; }
const projectId = value('--project');
const workspace = value('--workspace');
const real = args.includes('--real-readonly');
const legacyDeployment = args.includes('--legacy-deployment');
const discoverDocuments = args.includes('--discover-legacy-document-targets');
const targetsOnly = args.includes('--targets-only');
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!projectId || !workspace || !/^[a-zA-Z0-9_-]{2,100}$/.test(projectId) || !/^[a-zA-Z0-9_-]{1,150}$/.test(workspace)) throw new Error('Use --project e --workspace explícitos.');
if (real && emulator) throw new Error('Modo real não aceita FIRESTORE_EMULATOR_HOST.');
if (!real && (!emulator || !projectId.startsWith('demo-'))) throw new Error('Modo padrão exige FIRESTORE_EMULATOR_HOST e projeto demo-.');
if (args.includes('--apply') || args.includes('--write')) throw new Error('Export é somente leitura.');
const pageSize = bounded('--page-size', 100, 500);
const maxReads = bounded('--max-reads-per-source', 1000, 100000);
const maxPages = bounded('--max-pages-per-source', 20, 1000);
const maxTargets = bounded('--max-targets', 100, 1000);
const maxTargetReads = bounded('--max-target-reads', 100, 500);
const maxDiscoveryReads = bounded('--max-discovery-reads', 500, 10000);
const maxDiscoveryQueries = bounded('--max-discovery-queries', 100, 2000);
const dbIds = { main: 'coala', hr: 'coala-rh', financial: 'coala-financeiro', 'rep-p': 'coala-rep-p' };
const policyRaw = readFileSync('config/person-legacy-deployment-sources.json', 'utf8');
const policy = JSON.parse(policyRaw);
if (policy.schemaVersion !== 1 || !Array.isArray(policy.entries)) throw new Error('Política legacy inválida.');
const policyEntry = (source) => policy.entries.find((item) => item.project === projectId && item.database === dbIds[source.database]
  && item.collection === source.collection && item.workspace === workspace);
const requested = value('--sources')?.split(',').filter(Boolean) ?? null;
const sources = [...new Map(PERSON_SOURCES.filter((source) => source.field !== '__parent__' && !source.parentCollection && source.permissionPolicy !== 'cursor-private')
  .map((source) => [`${source.database}/${source.collection}`, { database: source.database, collection: source.collection }])).values()];
if (requested?.some((item) => !sources.some((source) => `${source.database}/${source.collection}` === item))) throw new Error('Fonte não cadastrada.');
const selected = requested ? sources.filter((source) => requested.includes(`${source.database}/${source.collection}`)) : sources;
if (!selected.length) throw new Error('Nenhuma fonte selecionada.');
const exactDocumentTargets = (Boolean(value('--targets')) || discoverDocuments) && selected.every((source) =>
  ['main/generatedDocuments', 'hr/employeeDocuments', 'hr/hrSignatureRequests', 'hr/onboardingProcesses'].includes(`${source.database}/${source.collection}`));
if (legacyDeployment && selected.some((source) => !policyEntry(source)) && !exactDocumentTargets) throw new Error('LEGACY_DEPLOYMENT fora da allowlist versionada.');
if (targetsOnly && (!value('--targets') || discoverDocuments || !exactDocumentTargets)) throw new Error('targets-only exige arquivo de targets documentais explícitos.');
if (discoverDocuments && (!legacyDeployment || !value('--identity-run') || value('--targets') || !exactDocumentTargets)) throw new Error('Descoberta exige --legacy-deployment, --identity-run e fontes documentais exatas.');
const privateRoot = resolve('.ai-work/development-technology/person-traceability-20261103/census');
mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
if (realpathSync(privateRoot) !== privateRoot) throw new Error('Diretório privado indireto.');
let targets = [];
if (value('--targets')) {
  const path = resolve(value('--targets'));
  const parentPath = realpathSync(resolve(path, '..'));
  const relativePath = relative(privateRoot, parentPath);
  if (relativePath.startsWith('..') || relativePath.startsWith('/') || lstatSync(path).isSymbolicLink() || (lstatSync(path).mode & 0o077)) throw new Error('Targets exigem arquivo privado 0600 no census do chamado.');
  targets = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(targets) || targets.length > maxTargets || targets.some((target) =>
    !selected.some((source) => source.database === target.database && source.collection === target.collection)
    || !/^[a-zA-Z0-9_-]{1,200}$/.test(target.id ?? '')
    || !['main.users', 'hr.employees', 'hr.candidates', 'hr.onboardingPersons'].includes(target.subject?.namespace)
    || !/^[a-zA-Z0-9_-]{1,200}$/.test(target.subject?.id ?? ''))) throw new Error('Targets inválidos ou fora do teto.');
}
const identityCensus = discoverDocuments ? loadIdentityCensus({ runDir: value('--identity-run'), privateRoot,
  projectId, workspace, mode: real ? 'real-readonly' : 'emulator-readonly', policySha256: sha256(policyRaw), maxRows: 1500 }) : null;
const outDir = resolve(value('--out-dir') ?? join(privateRoot, `census-${Date.now()}-${process.pid}`));
const parent = resolve(outDir, '..');
const lexical = relative(privateRoot, outDir);
if (!lexical || lexical.startsWith('..') || lexical.startsWith('/') || lexical.split('/').includes('..')) throw new Error('Saída deve ficar no census privado do chamado.');
mkdirSync(parent, { recursive: true, mode: 0o700 });
const rel = relative(realpathSync(privateRoot), realpathSync(parent));
if (rel.startsWith('..') || rel.startsWith('/') || outDir === privateRoot) throw new Error('Saída deve ficar no census privado do chamado.');
mkdirSync(outDir, { mode: 0o700 });
if (realpathSync(outDir) !== outDir) throw new Error('Caminho de saída indireto.');
const jsonlPath = join(outDir, 'census.jsonl');
const manifestPath = join(outDir, 'manifest.json');
const fd = openSync(jsonlPath, 'wx', 0o600);
const hash = (await import('node:crypto')).createHash('sha256');
const seen = new Set();
let rows = 0;
let app;
const manifest = { schema: 1, status: 'incomplete', mode: real ? 'real-readonly' : 'emulator-readonly', projectId, workspace,
  databases: dbIds, limits: { pageSize, maxReadsPerSource: maxReads, maxPagesPerSource: maxPages, maxTargets, maxTargetReads,
    maxDiscoveryReads, maxDiscoveryQueries, maxIdentityRows: 1500, targetsOnly }, rows: 0, sha256: null,
  sources: [], gaps: [], globalCoverage: 'incomplete', globalGaps: [],
  legacyDeployment: legacyDeployment ? { policyVersion: policy.schemaVersion, policySha256: sha256(policyRaw),
    entries: (exactDocumentTargets ? policy.entries.filter((item) => item.project === projectId && item.workspace === workspace)
      : selected.map((source) => policyEntry(source)).filter(Boolean)), exactDocumentTargets } : null,
  createdAt: new Date().toISOString() };
try {
  app = initializeApp({ projectId }, `person-census-${process.pid}`);
  if (identityCensus) {
    for (const row of identityCensus.rows) {
      const key = `${row.database}/${row.collection}/${row.id}`;
      if (seen.has(key)) throw new Error('Identidade duplicada no censo.');
      seen.add(key);
      const line = `${JSON.stringify(row)}\n`;
      writeSync(fd, line); hash.update(line); rows++;
    }
    manifest.identityRows = identityCensus.rows.length;
  }
  for (const source of targetsOnly ? [] : selected) {
    const db = getFirestore(app, dbIds[source.database]);
    if (legacyDeployment && policyEntry(source)) {
      const result = await censusLegacyDeploymentSource({ db, ...source, workspace, pageSize, maxReads, maxPages, onRow(row) {
        const key = `${row.database}/${row.collection}/${row.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        const line = `${JSON.stringify(row)}\n`;
        writeSync(fd, line); hash.update(line); rows++;
      } });
      manifest.sources.push(result);
      if (result.status !== 'complete') manifest.gaps.push({ source: `${source.database}/${source.collection}`, scopeField: 'legacy-deployment', reason: result.reason });
      continue;
    }
    let sourceReads = 0; let sourcePages = 0;
    for (const scopeField of ['workspaceId', 'workspace_id']) {
      const result = await censusSource({ db, ...source, workspace, scopeField, pageSize, maxReads: maxReads - sourceReads, maxPages: maxPages - sourcePages,
        onRow(row) {
          const key = `${row.database}/${row.collection}/${row.id}`;
          if (seen.has(key)) return;
          seen.add(key);
          const line = `${JSON.stringify(row)}\n`;
          writeSync(fd, line);
          hash.update(line);
          rows++;
        } });
      manifest.sources.push(result);
      sourceReads += result.scanned; sourcePages += result.pages;
      if (result.status !== 'complete') manifest.gaps.push({ source: `${source.database}/${source.collection}`, scopeField, reason: result.reason });
    }
  }
  if (discoverDocuments) {
    const discovery = await discoverLegacyDocumentTargets({ dbFor: (database) => getFirestore(app, dbIds[database]), selected,
      identityRows: identityCensus.rows, workspace, pageSize, maxReads: maxDiscoveryReads, maxQueries: maxDiscoveryQueries, maxTargets });
    targets = discovery.targets;
    manifest.discovery = { identitySha256: identityCensus.sha256, status: discovery.status, reads: discovery.reads,
      queries: discovery.queries, proposedTargets: discovery.targets.length, rejectedScope: discovery.rejectedScope, reason: discovery.reason };
    if (discovery.status !== 'complete') manifest.gaps.push({ source: 'legacy-document-discovery', reason: discovery.reason });
  }
  let acceptedTargets = 0; let rejectedTargets = 0; const contextRecords = new Set();
  const targetReasons = {};
  for (const target of targets) {
    try {
      const doc = await projectedById(getFirestore(app, dbIds[target.database]), target.collection, target.id, CENSUS_FIELDS);
      if (!doc) { rejectedTargets++; targetReasons.record_missing = (targetReasons.record_missing ?? 0) + 1; continue; }
      const rawData = doc.data();
      const data = projectCensusData(rawData);
      assertCensusProjection(rawData, data);
      if (!matchesPersonWorkspace(rawData, workspace, true)) { rejectedTargets++; targetReasons.scope_mismatch = (targetReasons.scope_mismatch ?? 0) + 1; continue; }
      const verified = await verifyCensusTarget({ target, data, workspace, maxReads: maxTargetReads - 1,
        allowLegacyIdentity: (database, collection) => legacyDeployment && Boolean(policyEntry({ database, collection })),
        dbFor: (database) => getFirestore(app, dbIds[database]) });
      if (!verified.ok) { rejectedTargets++; targetReasons[verified.reason] = (targetReasons[verified.reason] ?? 0) + 1; continue; }
      const row = { database: target.database, collection: target.collection, id: target.id, data,
        ...(verified.contextOnly ? { contextOnly: true, contextReason: verified.contextReason } : {}) };
      if (verified.contextOnly) contextRecords.add(`${row.database}/${row.collection}/${row.id}`);
      const recordKey = `${row.database}/${row.collection}/${row.id}`;
      if (!seen.has(recordKey)) {
        seen.add(recordKey);
        const line = `${JSON.stringify(row)}\n`;
        writeSync(fd, line); hash.update(line); rows++;
      }
      acceptedTargets++;
    } catch (error) { rejectedTargets++; const reason = ['target_read_limit', 'process_limit', 'scope_mismatch', 'projection_invalid'].includes(error?.message) ? error.message : 'read_failed'; targetReasons[reason] = (targetReasons[reason] ?? 0) + 1; }
  }
  manifest.targeted = { requested: targets.length, accepted: acceptedTargets, rejected: rejectedTargets, contextOnly: contextRecords.size, reasons: targetReasons, evidence: 'anchor_workspace_and_strict_namespace_link' };
  if (contextRecords.size) manifest.gaps.push({ source: 'hr/onboardingProcesses', reason: 'manual_person_identity_missing', count: contextRecords.size });
  if (rejectedTargets) manifest.gaps.push({ source: 'targets', reason: 'target_unverified_or_read_failed', count: rejectedTargets });
  // No full-tenant assertion: old records without workspace are excluded until their
  // IDs or parent links are independently established within this tenant.
  manifest.globalGaps.push({ source: 'legacy-unscoped', reason: 'workspace_or_parent_evidence_required' });
  if (selected.length !== sources.length) manifest.globalGaps.push({ source: 'selection', reason: 'sources_omitted' });
  manifest.globalGaps.push({ source: 'hr/consentimentos_imagem_voz_historico', reason: 'parent_employee_traversal_pending' });
  manifest.globalGaps.push({ source: 'main/dp_schedules/revisions/people', reason: 'legacy_parent_revision_traversal_pending' });
  manifest.globalGaps.push({ source: 'financial/expenses', reason: 'untyped_employeeId_requires_process_evidence' });
  manifest.globalGaps.push({ source: 'main/actionLogs', reason: 'target_type_not_universally_person' });
  manifest.status = manifest.gaps.length ? 'incomplete' : 'complete';
} finally {
  closeSync(fd);
  manifest.rows = rows;
  manifest.sha256 = hash.digest('hex');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  if (app) await deleteApp(app);
}
console.log(JSON.stringify({ status: manifest.status, rows, sources: manifest.sources.length, gaps: manifest.gaps.length, outDir }));
