import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { syncDayAdmin } from './pdv-sync';

initializeApp();
setGlobalOptions({ maxInstances: 10 });

const db = getFirestore('coala');
const checklistDb = getFirestore('coala-checklist');
const auth = getAuth();

const BRT = 'America/Sao_Paulo';

function getBrtDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BRT, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);
}

function getBrtMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRT,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function parseHhmm(hhmm: string): number | null {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function resolveShiftEndDate(date: string, startTime: string, endTime: string): string {
  if (endTime <= startTime) {
    const d = new Date(date + 'T12:00:00Z');
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  return date;
}

function isShiftEnded(shiftEndDate: string, shiftEndTime: string, now: Date): boolean {
  const endMinutes = parseHhmm(shiftEndTime);
  if (endMinutes === null) return false;
  const nowDate = getBrtDate(now);
  const nowMinutes = getBrtMinutes(now);
  if (shiftEndDate < nowDate) return true;
  if (shiftEndDate > nowDate) return false;
  return endMinutes <= nowMinutes;
}

// --- Rotina Diária de Sincronização (PDV Legal -> Coala) ---
// --- Rotina Horária de Sincronização (PDV Legal -> Coala) ---
// Mantém as metas atualizadas durante o dia de funcionamento
export const hourlyPdvSync = onSchedule({
  schedule: "0 8-23 * * *", // Cada hora das 08:00 às 23:00
  timeZone: "America/Sao_Paulo",
  retryCount: 2
}, async () => {
  console.log("Iniciando sincronização horária (hoje)...");
  try {
    const now = new Date();
    now.setHours(now.getHours() - 3); // BRT
    const dateStr = now.toISOString().split('T')[0];
    const kiosksSnap = await db.collection('kiosks').get();
    
    for (const doc of kiosksSnap.docs) {
      const kiosk = doc.data();
      if (!kiosk.pdvFilialId) continue;
      
      console.log(`Sincronizando hoje (${dateStr}) para ${kiosk.name}...`);
      await syncDayAdmin(dateStr, doc.id, kiosk.pdvFilialId, db);
    }
  } catch (e) {
    console.error("Erro na rotina horária:", e);
  }
});

// --- Sincronizar metas para um intervalo de datas (trigger manual) ---
export const syncGoalsForRange = onCall(
  { cors: true, timeoutSeconds: 540, memory: '512MiB' },
  async (request: any) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado.');

    // Verifica permissão: admin customClaim OU settings.manageUsers no perfil
    const token = request.auth.token;
    if (!token.isDefaultAdmin) {
      const profileId = token.profileId;
      if (!profileId) throw new HttpsError('permission-denied', 'Apenas administradores.');
      const profileDoc = await db.collection('profiles').doc(profileId).get();
      const perms = profileDoc.data()?.permissions;
      if (!perms?.settings?.manageUsers && !perms?.goals?.manage) {
        throw new HttpsError('permission-denied', 'Apenas administradores.');
      }
    }

    const { kioskId, startDate, endDate, pdvFilialId: pdvFilialIdParam } = request.data as {
      kioskId: string; startDate: string; endDate: string; pdvFilialId?: string;
    };
    if (!kioskId || !startDate || !endDate) throw new HttpsError('invalid-argument', 'kioskId, startDate e endDate são obrigatórios.');

    const kioskDoc = await db.collection('kiosks').doc(kioskId).get();
    if (!kioskDoc.exists) throw new HttpsError('not-found', 'Quiosque não encontrado.');

    const FALLBACK_MAP: Record<string, string> = {
      'tirirical': '17343',
      'joao-paulo': '17344',
    };
    const pdvFilialId = pdvFilialIdParam || kioskDoc.data()?.pdvFilialId || FALLBACK_MAP[kioskId];
    if (!pdvFilialId) throw new HttpsError('failed-precondition', 'Quiosque sem pdvFilialId configurado. Informe o ID da filial no PDV Legal.');

    const results: { date: string; revenue?: number; error?: string }[] = [];
    const current = new Date(startDate + 'T12:00:00Z');
    const end = new Date(endDate + 'T12:00:00Z');

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      try {
        const result = await syncDayAdmin(dateStr, kioskId, pdvFilialId, db) as any;
        results.push({ date: dateStr, revenue: result.dailyRevenue });
      } catch (e: any) {
        console.error(`[syncGoalsForRange] Erro em ${dateStr}:`, e);
        results.push({ date: dateStr, error: e.message });
      }
      current.setDate(current.getDate() + 1);
    }

    return { results };
  }
);

// --- Criar usuário (Auth + Firestore) server-side ---
export const createUser = onCall(
  { 
    cors: [/smart-converter-752gf\.web\.app$/, /smart-converter-752gf\.firebaseapp\.com$/, /localhost(:\d+)?$/] 
  },
  async (request: any) => {
    // Apenas admins podem criar usuários
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Não autenticado.');
    }
    
    // Verifica se é admin via claims
    if (!request.auth.token.isDefaultAdmin) {
      throw new HttpsError('permission-denied', 'Apenas administradores podem criar novos usuários.');
    }

    const { email, password, username, profileId, assignedKioskIds, avatarUrl, operacional } = request.data;

    if (!email || !password || !username || !profileId) {
      throw new HttpsError('invalid-argument', 'Campos obrigatórios: email, password, username, profileId.');
    }

    try {
      // 1. Cria no Firebase Auth
      const userRecord = await auth.createUser({ 
        email, 
        password,
        displayName: username 
      });

      // 2. Busca info do perfil para setar os claims imediatamente
      const profileSnap = await db.collection('profiles').doc(profileId).get();
      const isDefaultAdmin = profileSnap.exists && profileSnap.data()?.isDefaultAdmin === true;

      // 3. Seta Custom Claims
      await auth.setCustomUserClaims(userRecord.uid, { profileId, isDefaultAdmin });

      // 4. Cria documento no Firestore
      await db.collection('users').doc(userRecord.uid).set({
        email,
        username,
        profileId,
        assignedKioskIds: assignedKioskIds || [],
        avatarUrl: avatarUrl || '',
        operacional: operacional || false,
      });

      return { uid: userRecord.uid };
    } catch (error: any) {
      console.error("Erro ao criar usuário:", error);
      throw new HttpsError('internal', error.message || 'Erro interno ao criar usuário.');
    }
  }
);

// --- Deletar usuário (Auth + Firestore) server-side ---
export const deleteUser = onCall(
  { cors: [/smart-converter-752gf\.web\.app$/, /smart-converter-752gf\.firebaseapp\.com$/, /localhost(:\d+)?$/] },
  async (request: any) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Não autenticado.');
    }
    if (!request.auth.token.isDefaultAdmin) {
      throw new HttpsError('permission-denied', 'Apenas administradores podem excluir usuários.');
    }

    const { uid } = request.data;
    if (!uid) {
      throw new HttpsError('invalid-argument', 'O UID do usuário é obrigatório.');
    }

    try {
      // 1. Deleta do Firebase Auth
      await auth.deleteUser(uid);
      // 2. Deleta o documento no Firestore
      await db.collection('users').doc(uid).delete();
      return { success: true };
    } catch (error: any) {
      console.error("Erro ao deletar usuário:", error);
      throw new HttpsError('internal', error.message || 'Erro ao deletar usuário.');
    }
  }
);

// --- Desligamento DP: remove do Auth, mantém no Firestore para histórico ---
export const terminateUser = onCall(
  { cors: [/smart-converter-752gf\.web\.app$/, /smart-converter-752gf\.firebaseapp\.com$/, /localhost(:\d+)?$/] },
  async (request: any) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado.');
    if (!request.auth.token.isDefaultAdmin) {
      throw new HttpsError('permission-denied', 'Apenas administradores podem desligar usuários.');
    }

    const { uid, terminationReason, terminationCause, terminationNotes, terminationDate } = request.data;
    if (!uid) throw new HttpsError('invalid-argument', 'O UID do usuário é obrigatório.');

    try {
      // 1. Remove do Firebase Auth (não consegue mais logar)
      await auth.deleteUser(uid);

      // 2. Mantém o documento no Firestore marcado como inativo
      await db.collection('users').doc(uid).update({
        isActive: false,
        terminationDate: terminationDate ?? new Date().toISOString(),
        terminationReason: terminationReason ?? null,
        terminationCause: terminationCause ?? null,
        terminationNotes: terminationNotes ?? null,
      });

      return { success: true };
    } catch (error: any) {
      console.error('Erro ao desligar usuário:', error);
      throw new HttpsError('internal', error.message || 'Erro ao desligar usuário.');
    }
  }
);

// --- Custom Claims Sync: quando o documento do usuário muda ---
export const onUserProfileChange = onDocumentWritten(
  { document: 'users/{userId}', database: 'coala' },
  async (event: any) => {
    const userId = event.params.userId;

    if (!event.data?.after.exists) {
      await auth.setCustomUserClaims(userId, {});
      console.log(`🗑️  Claims removidos para ${userId}`);
      return;
    }

    const userData = event.data.after.data()!;
    const profileId = userData.profileId;

    if (!profileId) {
      console.log(`⚠️  Usuário ${userId} sem profileId`);
      return;
    }

    const profileSnap = await db.collection('profiles').doc(profileId).get();
    const isDefaultAdmin = profileSnap.exists && profileSnap.data()?.isDefaultAdmin === true;

    await auth.setCustomUserClaims(userId, { profileId, isDefaultAdmin });
    console.log(`✅ Claims atualizados: ${userId} profileId=${profileId} isDefaultAdmin=${isDefaultAdmin}`);
  }
);

// --- Custom Claims Sync: quando o perfil muda (atualiza todos os usuários do perfil) ---
export const onProfileChange = onDocumentWritten(
  { document: 'profiles/{profileId}', database: 'coala' },
  async (event: any) => {
    const profileId = event.params.profileId;

    const usersSnap = await db.collection('users')
      .where('profileId', '==', profileId)
      .get();

    if (usersSnap.empty) {
      console.log(`ℹ️  Nenhum usuário com profileId=${profileId}`);
      return;
    }

    const profileData = event.data?.after.exists ? event.data.after.data() : null;
    const isDefaultAdmin = profileData?.isDefaultAdmin === true;

    const promises = usersSnap.docs.map(userDoc =>
      auth.setCustomUserClaims(userDoc.id, { profileId, isDefaultAdmin })
        .then(() => console.log(`✅ ${userDoc.data().username || userDoc.id} atualizado`))
    );

    await Promise.all(promises);
    console.log(`🎉 ${promises.length} usuário(s) atualizados para profileId=${profileId}`);
  }
);

// --- Geração diária automática de checklists ---
export const checklistDailyGenerate = onSchedule(
  { schedule: '5 0 * * *', timeZone: BRT, retryCount: 2, memory: '256MiB' },
  async () => {
    const now = new Date();
    const today = getBrtDate(now);
    console.log(`[checklistDailyGenerate] Gerando checklists para ${today}`);

    const [templatesSnap, shiftsSnap, existingSnap] = await Promise.all([
      checklistDb.collection('checklistTemplates').where('isActive', '==', true).get(),
      db.collectionGroup('shifts').where('date', '==', today).get(),
      checklistDb.collection('checklistExecutions').where('checklistDate', '==', today).get(),
    ]);

    const existingIds = new Set(existingSnap.docs.map((d) => d.id));

    const unitNames = new Map<string, string>();
    const shiftDefNames = new Map<string, string>();
    const [unitsSnap, shiftDefsSnap] = await Promise.all([
      db.collection('dp_units').get(),
      db.collection('dp_shiftDefinitions').get(),
    ]);
    unitsSnap.docs.forEach((d) => { const n = d.data()?.name; if (n) unitNames.set(d.id, n); });
    shiftDefsSnap.docs.forEach((d) => { const n = d.data()?.name; if (n) shiftDefNames.set(d.id, n); });

    const userIds = [...new Set(
      shiftsSnap.docs
        .filter((d) => d.data()?.type === 'work')
        .map((d) => d.data()?.userId as string)
        .filter(Boolean)
    )];
    const userDocs = await Promise.all(userIds.map((uid) => db.collection('users').doc(uid).get()));
    const usernames = new Map<string, string>(
      userDocs.map((d) => [d.id, d.data()?.username || d.id])
    );

    let created = 0;
    let skipped = 0;
    const batchItems: Array<{ id: string; data: Record<string, unknown> }> = [];

    for (const tDoc of templatesSnap.docs) {
      const t = tDoc.data();
      if (!t.name || !Array.isArray(t.sections) || t.isActive !== true) continue;

      const tUnitIds: string[] = Array.isArray(t.unitIds) ? t.unitIds : [];
      const tShiftDefIds: string[] = Array.isArray(t.shiftDefinitionIds) ? t.shiftDefinitionIds : [];

      for (const sDoc of shiftsSnap.docs) {
        const s = sDoc.data();
        if (s?.type !== 'work') continue;
        if (!s.scheduleId || !s.unitId || !s.userId || !s.startTime || !s.endTime) continue;

        if (tUnitIds.length > 0 && !tUnitIds.includes(s.unitId)) continue;
        if (tShiftDefIds.length > 0) {
          if (!s.shiftDefinitionId || !tShiftDefIds.includes(s.shiftDefinitionId)) continue;
        }

        const execId = `${today}__${s.scheduleId}__${sDoc.id}__${tDoc.id}`;
        if (existingIds.has(execId)) { skipped++; continue; }
        existingIds.add(execId);
        created++;

        const items: Record<string, unknown>[] = [];
        for (const section of (t.sections as any[])) {
          for (const item of (section.items as any[] ?? [])) {
            items.push({
              templateItemId: item.id,
              sectionId: section.id,
              sectionTitle: section.title,
              order: item.order ?? 0,
              title: item.title,
              description: item.description ?? null,
              type: item.type,
              required: item.required,
              weight: item.weight ?? 1,
              config: item.config ?? null,
              checked: item.type === 'checkbox' ? false : null,
              textValue: (item.type === 'text' || item.type === 'select') ? '' : null,
              numberValue: null,
              photoUrls: item.type === 'photo' ? [] : null,
              signatureUrl: null,
              isLate: false,
              isOutOfRange: false,
              completedAt: null,
              completedByUserId: null,
            });
          }
        }

        batchItems.push({
          id: execId,
          data: {
            checklistDate: today,
            templateId: tDoc.id,
            templateName: t.name,
            scheduleId: s.scheduleId,
            shiftId: sDoc.id,
            unitId: s.unitId,
            unitName: unitNames.get(s.unitId) ?? s.unitId,
            shiftDefinitionId: s.shiftDefinitionId ?? null,
            shiftDefinitionName: s.shiftDefinitionId ? shiftDefNames.get(s.shiftDefinitionId) ?? s.shiftDefinitionId : null,
            assignedUserId: s.userId,
            assignedUsername: usernames.get(s.userId) ?? s.userId,
            shiftStartTime: s.startTime,
            shiftEndTime: s.endTime,
            shiftEndDate: resolveShiftEndDate(today, s.startTime, s.endTime),
            status: 'pending',
            score: null,
            items,
            claimedByUserId: null,
            claimedByUsername: null,
            claimedAt: null,
            completedByUserId: null,
            completedByUsername: null,
            completedAt: null,
            reviewedBy: null,
            reviewNotes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
    }

    for (let i = 0; i < batchItems.length; i += 400) {
      const batch = checklistDb.batch();
      batchItems.slice(i, i + 400).forEach((entry) => {
        batch.set(checklistDb.collection('checklistExecutions').doc(entry.id), entry.data);
      });
      await batch.commit();
    }

    console.log(`[checklistDailyGenerate] Criadas: ${created}, já existentes: ${skipped}`);
  }
);

// --- Marcação automática de execuções em atraso ---
export const checklistMarkOverdue = onSchedule(
  { schedule: '*/15 * * * *', timeZone: BRT, retryCount: 1, memory: '256MiB' },
  async () => {
    const now = new Date();
    console.log(`[checklistMarkOverdue] Verificando atrasos em ${now.toISOString()}`);

    const pendingSnap = await checklistDb
      .collection('checklistExecutions')
      .where('status', 'in', ['pending', 'claimed'])
      .get();

    if (pendingSnap.empty) return;

    const toMark = pendingSnap.docs.filter((doc) => {
      const data = doc.data();
      if (!data.shiftEndDate || !data.shiftEndTime) return false;
      return isShiftEnded(data.shiftEndDate as string, data.shiftEndTime as string, now);
    });

    if (toMark.length === 0) {
      console.log('[checklistMarkOverdue] Nenhuma execução em atraso.');
      return;
    }

    for (let i = 0; i < toMark.length; i += 400) {
      const batch = checklistDb.batch();
      toMark.slice(i, i + 400).forEach((doc) => {
        batch.update(doc.ref, { status: 'overdue', updatedAt: new Date() });
      });
      await batch.commit();
    }

    console.log(`[checklistMarkOverdue] ${toMark.length} execuções marcadas como overdue.`);
  }
);
