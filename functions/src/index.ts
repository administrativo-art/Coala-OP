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
const auth = getAuth();

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
