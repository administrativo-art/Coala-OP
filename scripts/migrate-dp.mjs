/**
 * Script de migração: Coala-DP → Coala-OP (módulo Departamento Pessoal)
 *
 * CONFIGURAÇÃO:
 *   Guarde os arquivos JSON das service accounts fora do repositório
 *   (ex.: ~/.config/coala/keys/) e informe por variável de ambiente:
 *     FIREBASE_SERVICE_ACCOUNT_PATH       → Coala-OP  (smart-converter-752gf)
 *     DP_FIREBASE_SERVICE_ACCOUNT_PATH    → Coala-DP  (studio-7671525955-67ff0)
 *
 *   Ou passe os caminhos explicitamente:
 *     node scripts/migrate-dp.mjs phase1 --op=caminho/op.json --dp=caminho/dp.json
 *
 * USO:
 *   node scripts/migrate-dp.mjs phase1   → coleções simples + relatório de colaboradores
 *   node scripts/migrate-dp.mjs phase2   → usuários + escalas + férias (após revisar o relatório)
 *   node scripts/migrate-dp.mjs all      → executa tudo de uma vez
 */

import { initializeApp, cert, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ─── Resolve caminhos dos service accounts ────────────────────────────────────

function resolveArg(name) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
}

const dpPath = resolveArg('dp') ?? process.env.DP_FIREBASE_SERVICE_ACCOUNT_PATH ?? null;
const opPath = resolveArg('op') ?? process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? null; // opcional — usa ADC se não informado

if (!dpPath || !existsSync(dpPath)) {
  console.error(`❌ Service account do Coala-DP não encontrado. Informe --dp=... ou DP_FIREBASE_SERVICE_ACCOUNT_PATH.`);
  process.exit(1);
}

const dpSA = JSON.parse(readFileSync(dpPath, 'utf-8'));
const reportsDir = process.env.COALA_REPORTS_DIR ?? join(homedir(), '.config', 'coala', 'reports');
mkdirSync(reportsDir, { recursive: true });
const collaboratorMappingPath = join(reportsDir, 'dp-collaborator-mapping.json');
const dpIdMapPath = join(reportsDir, 'dp-id-map.json');

// ─── Firebase apps ────────────────────────────────────────────────────────────

function initOP() {
  const existing = getApps().find(a => a.name === 'op');
  if (existing) return existing;

  // Se tiver chave explícita, usa ela. Caso contrário, usa ADC (gcloud auth application-default login)
  if (opPath && existsSync(opPath)) {
    const opSA = JSON.parse(readFileSync(opPath, 'utf-8'));
    return initializeApp({ credential: cert(opSA) }, 'op');
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: 'smart-converter-752gf',
  }, 'op');
}

function initDP() {
  const existing = getApps().find(a => a.name === 'dp');
  if (existing) return existing;
  return initializeApp({ credential: cert(dpSA) }, 'dp');
}

const opApp = initOP();
const dpApp = initDP();

const opDB  = getFirestore(opApp, 'coala');
const dpDB  = getFirestore(dpApp, 'coaladp');
const opAuth = getAuth(opApp);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalize(name = '') {
  return name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function readAll(db, collectionName) {
  const snap = await db.collection(collectionName).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function writeBatched(db, collectionName, docs) {
  const BATCH_SIZE = 499;
  let count = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { id, ...data } of chunk) {
      const ref = id ? db.collection(collectionName).doc(id) : db.collection(collectionName).doc();
      batch.set(ref, data);
    }
    await batch.commit();
    count += chunk.length;
    console.log(`  ✓ ${collectionName}: ${count}/${docs.length}`);
  }
}

// ─── FASE 1: Coleções simples ────────────────────────────────────────────────
// units, unitGroups, shiftDefinitions, calendars, holidays

async function migrateSimpleCollections() {
  console.log('\n── Fase 1: Coleções simples ──────────────────────────────────');

  // Unidades
  const units = await readAll(dpDB, 'units');
  await writeBatched(opDB, 'dp_units', units);
  console.log(`  → dp_units: ${units.length} documentos`);

  // Grupos de unidades
  const groups = await readAll(dpDB, 'unitGroups');
  await writeBatched(opDB, 'dp_unitGroups', groups);
  console.log(`  → dp_unitGroups: ${groups.length} documentos`);

  // Definições de turno
  const defs = await readAll(dpDB, 'shiftDefinitions');
  await writeBatched(opDB, 'dp_shiftDefinitions', defs);
  console.log(`  → dp_shiftDefinitions: ${defs.length} documentos`);

  // Calendários + feriados (subcoleção)
  const calendars = await readAll(dpDB, 'calendars');
  for (const cal of calendars) {
    const { id: calId, ...calData } = cal;
    await opDB.collection('dp_calendars').doc(calId).set(calData);

    const holidaysSnap = await dpDB.collection('calendars').doc(calId).collection('holidays').get();
    if (!holidaysSnap.empty) {
      const batch = opDB.batch();
      holidaysSnap.docs.forEach(h => {
        const ref = opDB.collection('dp_calendars').doc(calId).collection('holidays').doc(h.id);
        batch.set(ref, h.data());
      });
      await batch.commit();
    }
    console.log(`  → dp_calendars/${calId}: ${holidaysSnap.size} feriados`);
  }

  console.log('\n✅ Fase 1 concluída.');
}

// ─── Fase 1b: Relatório de colaboradores ─────────────────────────────────────

async function generateCollaboratorReport() {
  console.log('\n── Relatório de colaboradores ────────────────────────────────');

  const dpCollabs = await readAll(dpDB, 'collaborators');
  const opUsers   = await readAll(opDB, 'users');

  const report = dpCollabs.map(collab => {
    // Tenta encontrar usuário OP pelo nome normalizado
    const match = opUsers.find(u => normalize(u.username) === normalize(collab.name));
    return {
      dp_id:          collab.id,
      dp_name:        collab.name,
      dp_registrationId: collab.registrationId ?? '',
      dp_isActive:    collab.isActive,
      op_userId:      match?.id ?? null,
      op_username:    match?.username ?? null,
      status:         match ? 'MATCHED' : 'NEW_USER',
      // Para usuários novos, preencher manualmente:
      new_email:      '',
      new_password:   '',
    };
  });

  const matched = report.filter(r => r.status === 'MATCHED').length;
  const newUsers = report.filter(r => r.status === 'NEW_USER').length;

  writeFileSync(collaboratorMappingPath, JSON.stringify(report, null, 2));

  console.log(`\n  Colaboradores Coala-DP:  ${dpCollabs.length}`);
  console.log(`  Matched com Coala-OP:    ${matched}`);
  console.log(`  Precisam ser criados:    ${newUsers}`);
  console.log(`\n📄 Relatório salvo em: ${collaboratorMappingPath}`);
  console.log('   → Revise o arquivo, preencha new_email e new_password para os NEW_USER');
  console.log('   → Corrija op_userId para matches incorretos');
  console.log('   → Execute "node scripts/migrate-dp.mjs phase2" quando pronto\n');

  return report;
}

// ─── FASE 2: Usuários + Escalas + Férias ─────────────────────────────────────

async function migrateUsersAndRelational() {
  console.log('\n── Fase 2: Usuários, escalas e férias ────────────────────────');

  if (!existsSync(collaboratorMappingPath)) {
    console.error('❌ Arquivo de mapeamento não encontrado. Execute phase1 primeiro.');
    process.exit(1);
  }

  const mapping = JSON.parse(readFileSync(collaboratorMappingPath, 'utf-8'));

  // Valida NEW_USER sem email
  const sem_email = mapping.filter(m => m.status === 'NEW_USER' && !m.new_email);
  if (sem_email.length > 0) {
    console.error(`❌ ${sem_email.length} colaboradores NEW_USER sem new_email preenchido:`);
    sem_email.forEach(m => console.error(`   - ${m.dp_name} (dp_id: ${m.dp_id})`));
    process.exit(1);
  }

  // Mapa: dp_id → op userId
  const dpToOp = {};

  // Carrega dados DP dos colaboradores
  const dpCollabs = await readAll(dpDB, 'collaborators');
  const dpCollabMap = Object.fromEntries(dpCollabs.map(c => [c.id, c]));

  // Carrega perfil padrão não-admin do OP para novos usuários
  const profilesSnap = await opDB.collection('profiles').where('isDefaultAdmin', '!=', true).limit(1).get();
  const defaultProfileId = profilesSnap.empty ? null : profilesSnap.docs[0].id;

  // ── Atualiza usuários existentes e cria novos ──
  for (const entry of mapping) {
    const collab = dpCollabMap[entry.dp_id];
    if (!collab) continue;

    const dpFields = {
      registrationId:      collab.registrationId ?? null,
      admissionDate:       collab.admissionDate ?? null,
      birthDate:           collab.birthDate ?? null,
      unitIds:             collab.unitIds ?? [],
      shiftDefinitionId:   collab.shiftDefinitionId ?? null,
      needsTransportVoucher: collab.needsTransportVoucher ?? false,
      transportVoucherValue: collab.transportVoucherValue ?? null,
      isActive:            collab.isActive ?? true,
      terminationDate:     collab.terminationDate ?? null,
      terminationReason:   collab.terminationReason ?? null,
      terminationCause:    collab.terminationCause ?? null,
      terminationNotes:    collab.terminationNotes ?? null,
    };

    // Remove campos null para não poluir o documento
    Object.keys(dpFields).forEach(k => dpFields[k] === null && delete dpFields[k]);

    if (entry.status === 'MATCHED' && entry.op_userId) {
      // Atualiza usuário existente com campos DP + nome completo do DP
      await opDB.collection('users').doc(entry.op_userId).update({
        username: entry.dp_name,
        ...dpFields,
      });
      dpToOp[entry.dp_id] = entry.op_userId;
      console.log(`  ✓ UPDATED  ${entry.dp_name} → ${entry.op_userId}`);

    } else if (entry.status === 'NEW_USER' && entry.new_email) {
      // Cria usuário no Firebase Auth do OP
      const authUser = await opAuth.createUser({
        email: entry.new_email,
        password: entry.new_password || Math.random().toString(36).slice(-10),
        displayName: entry.dp_name,
      });

      // Cria documento em users/
      await opDB.collection('users').doc(authUser.uid).set({
        username: collab.name,
        email: entry.new_email,
        profileId: defaultProfileId ?? '',
        assignedKioskIds: [],
        operacional: false,
        ...dpFields,
      });

      dpToOp[entry.dp_id] = authUser.uid;
      console.log(`  ✓ CREATED  ${entry.dp_name} → ${authUser.uid}`);
    }
  }

  // Salva o mapa dp_id → op_userId para referência
  writeFileSync(dpIdMapPath, JSON.stringify(dpToOp, null, 2));
  console.log(`\n📄 Mapa de IDs salvo em: ${dpIdMapPath}`);

  // ── Migra escalas + turnos ──
  console.log('\n  Migrando escalas...');
  const schedules = await readAll(dpDB, 'schedules');
  for (const { id: schedId, ...schedData } of schedules) {
    await opDB.collection('dp_schedules').doc(schedId).set(schedData);

    const shiftsSnap = await dpDB.collection('schedules').doc(schedId).collection('shifts').get();
    if (!shiftsSnap.empty) {
      const BATCH = 499;
      const docs = shiftsSnap.docs;
      for (let i = 0; i < docs.length; i += BATCH) {
        const batch = opDB.batch();
        docs.slice(i, i + BATCH).forEach(s => {
          const shift = s.data();
          const ref = opDB.collection('dp_schedules').doc(schedId).collection('shifts').doc(s.id);
          batch.set(ref, {
            ...shift,
            userId: dpToOp[shift.collaboratorId] ?? shift.collaboratorId, // fallback ao original se não mapeado
          });
        });
        await batch.commit();
      }
    }
    console.log(`  → dp_schedules/${schedId}: ${shiftsSnap.size} turnos`);
  }

  // ── Migra férias ──
  console.log('\n  Migrando férias...');
  const vacations = await readAll(dpDB, 'vacations');
  const vacMapped = vacations.map(({ collaboratorId, ...rest }) => ({
    ...rest,
    userId: dpToOp[collaboratorId] ?? collaboratorId,
  }));
  await writeBatched(opDB, 'dp_vacations', vacMapped);
  console.log(`  → dp_vacations: ${vacations.length} registros`);

  console.log('\n✅ Fase 2 concluída.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const phase = process.argv[2] ?? 'help';

if (phase === 'phase1' || phase === 'all') {
  await migrateSimpleCollections();
  await generateCollaboratorReport();
}

if (phase === 'phase2' || phase === 'all') {
  await migrateUsersAndRelational();
}

if (phase === 'help' || !['phase1', 'phase2', 'all'].includes(phase)) {
  console.log(`
Uso: node scripts/migrate-dp.mjs <phase>

  phase1  → Migra unidades, grupos, turnos, calendários + gera relatório de colaboradores
  phase2  → Cria/atualiza usuários e migra escalas + férias (requer relatório revisado)
  all     → Executa phase1 + phase2 em sequência
  `);
}
