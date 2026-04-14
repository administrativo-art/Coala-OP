/**
 * Migração: vincula todas as escalas existentes ao calendário "Coala | 2026"
 *
 * Pré-requisito: coloque o service account do projeto Coala-OP em scripts/sa-op.json
 *   (Firebase Console → Configurações do projeto → Contas de serviço → Gerar nova chave)
 *
 * Uso:
 *   node scripts/link-schedules-calendar.mjs
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const SA_PATH = 'scripts/sa-op.json';
const CALENDAR_2026_ID = 'C7DrZ2HS8WrlFXqYuCS9'; // Coala | 2026
const CALENDAR_2025_ID = 'LSByMMYnT4oAQIAqCBVe'; // Coala | 2025

const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const snap = await db.collection('dp_schedules').get();

let updated = 0;
const batch = db.batch();

snap.docs.forEach(doc => {
  const data = doc.data();
  if (data.calendarId) return; // já tem calendário, pula

  // Dezembro 2025 → calendário 2025; demais → calendário 2026
  const calendarId = Number(data.year) <= 2025 ? CALENDAR_2025_ID : CALENDAR_2026_ID;
  batch.update(doc.ref, { calendarId });
  console.log(`  ${data.name} → ${calendarId === CALENDAR_2026_ID ? 'Coala | 2026' : 'Coala | 2025'}`);
  updated++;
});

await batch.commit();
console.log(`\nConcluído: ${updated} escala(s) atualizada(s).`);
