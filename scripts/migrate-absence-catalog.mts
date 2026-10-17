import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { adminApp, dbAdmin } from '../src/lib/firebase-admin';
import { hrDbAdmin } from '../src/lib/firebase-rh-admin';

// Copia o catálogo de ausências de `coala` para `coala-rh` e emite o recibo que libera os pedidos.
// Sem `--apply` é só leitura (ensaio). Com `--apply`:
// - emulador: somente o projeto demo-coala-repository em loopback;
// - produção: exige `--production`, `--confirm-catalog-freeze` (ninguém editando o catálogo durante a
//   execução e até a troca de DP_ABSENCE_CATALOG_DATABASE) e `--backup-dir <pasta>`; grava a cópia de
//   segurança antes da primeira escrita. Nunca sobrescreve tipo existente no destino nem recibo divergente.
const PRODUCTION_PROJECT_ID = 'smart-converter-752gf';
const usage = 'Uso: node --env-file=.env.local --conditions=react-server --import tsx scripts/migrate-absence-catalog.mts'
  + ' [--apply [--production --confirm-catalog-freeze --backup-dir <pasta>]]\n';

const args = process.argv.slice(2);
const flagValue = (flag: string) => {
  const index = args.indexOf(flag);
  return index < 0 ? null : args[index + 1] ?? null;
};
const allowed = new Set(['--apply', '--production', '--confirm-catalog-freeze', '--backup-dir']);
const unknown = args.filter((arg, index) => arg.startsWith('--') ? !allowed.has(arg) : args[index - 1] !== '--backup-dir');
if (args.includes('--help') || unknown.length > 0) {
  process.stdout.write(usage);
  process.exit(unknown.length > 0 ? 1 : 0);
}

const apply = args.includes('--apply');
const production = args.includes('--production');
const backupDir = flagValue('--backup-dir');
const projectId = adminApp.options.projectId ?? process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (production && !apply) throw new Error('--production só faz sentido com --apply.');
if (apply && !production) {
  if (projectId !== 'demo-coala-repository' || !emulatorHost || !/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)) {
    throw new Error('Apply sem --production permitido somente no emulador demo-coala-repository.');
  }
}
if (production) {
  if (projectId !== PRODUCTION_PROJECT_ID || emulatorHost) {
    throw new Error(`--production exige o projeto ${PRODUCTION_PROJECT_ID} sem emulador configurado.`);
  }
  if (!args.includes('--confirm-catalog-freeze')) {
    throw new Error('Confirme com --confirm-catalog-freeze que ninguém está editando o catálogo de ausências.');
  }
  if (!backupDir) throw new Error('--production exige --backup-dir <pasta> para a cópia de segurança.');
}

function canonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') return { timestampMillis: (value as { toMillis(): number }).toMillis() };
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonical(nested)]));
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

type Pending = { source: FirebaseFirestore.QueryDocumentSnapshot; destination: FirebaseFirestore.DocumentSnapshot };
let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
let compared = 0;
const hashes: string[] = [];
const pending: Pending[] = [];
const backup: { id: string; source: unknown; destination: unknown }[] = [];
// Primeiro compara tudo; nenhuma escrita acontece se houver conflito em qualquer ID.
while (true) {
  let query = dbAdmin.collection('dp_absenceTypes').orderBy('__name__').limit(50);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) break;
  const target = await hrDbAdmin.getAll(...page.docs.map((doc) => hrDbAdmin.collection('dp_absenceTypes').doc(doc.id)));
  for (let index = 0; index < page.docs.length; index += 1) {
    const source = page.docs[index];
    const destination = target[index];
    const sourceHash = digest(source.data());
    if (destination.exists && digest(destination.data()) !== sourceHash) throw new Error(`Conflito no ID ${source.id}; nenhum documento sobrescrito.`);
    hashes.push(`${source.id}:${sourceHash}`);
    backup.push({ id: source.id, source: canonical(source.data()), destination: destination.exists ? canonical(destination.data()) : null });
    compared += 1;
    if (!destination.exists) pending.push({ source, destination });
  }
  cursor = page.docs.at(-1);
  if (page.size < 50) break;
}
if (compared === 0) throw new Error('Catálogo de origem vazio; nada a migrar e nenhum recibo emitido.');

const catalogHash = digest(hashes);
const receipt = hrDbAdmin.collection('dp_absenceCatalogMigrations').doc('active');
const previous = await receipt.get();
if (previous.exists && previous.get('catalogHash') !== catalogHash) throw new Error('Recibo anterior divergente; revisar antes de ativar.');

let copied = 0;
let backupPath: string | null = null;
if (apply) {
  if (production && backupDir) {
    mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `absence-catalog-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(backupPath, JSON.stringify({ projectId, catalogHash, previousReceipt: previous.exists ? canonical(previous.data()) : null,
      documents: backup }, null, 2), { flag: 'wx' });
  }
  for (const { source, destination } of pending) {
    await destination.ref.create(source.data());
    copied += 1;
  }
  await receipt.set({ state: 'ready', catalogDatabase: 'coala-rh', catalogHash, documentCount: compared, completedAt: new Date(),
    sourceDatabase: 'coala' });
}
process.stdout.write(JSON.stringify({ mode: apply ? (production ? 'production-apply' : 'emulator-apply') : 'dry-run', projectId,
  compared, toCopy: pending.length, copied, receiptExists: previous.exists, catalogHash, backupPath }) + '\n');
