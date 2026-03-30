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
export const dailyPdvSync = onSchedule({
  schedule: "0 2 * * *", // Todo dia às 02:00 da manhã
  timeZone: "America/Sao_Paulo",
  retryCount: 3
}, async (event: any) => {
  console.log("Iniciando sincronização diária de vendas (PDV Legal)...");

  try {
    // Ajuste de fuso: às 02:00 BRT queremos garantir que pegamos o dia certo
    const now = new Date();
    now.setHours(now.getHours() - 3);

    // Verificar os últimos 7 dias e reprocessar qualquer dia que esteja faltando
    const LOOKBACK_DAYS = 7;
    const daysToCheck: string[] = [];
    for (let i = 1; i <= LOOKBACK_DAYS; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      daysToCheck.push(d.toISOString().split('T')[0]);
    }

    // 2. Buscar todos os quiosques cadastrados no banco de dados
    const kiosksSnap = await db.collection('kiosks').get();

    if (kiosksSnap.empty) {
      console.log("Nenhum quiosque encontrado no sistema.");
      return;
    }

    let successCount = 0;

    // 3. Para cada quiosque, verificar quais dias estão faltando e sincronizá-los
    for (const doc of kiosksSnap.docs) {
      const kiosk = doc.data();
      if (!kiosk.pdvFilialId) {
        console.log(`Quiosque ${kiosk.name} ignorado (sem pdvFilialId).`);
        continue;
      }

      for (const dateStr of daysToCheck) {
        const reportId = `sales_sync_${doc.id}_${dateStr.replace(/-/g, '_')}`;
        const existing = await db.collection('salesReports').doc(reportId).get();
        if (existing.exists) continue; // Dia já sincronizado

        console.log(`⚠️ Dia faltando: ${kiosk.name} (${dateStr}). Reprocessando...`);
        try {
          await syncDayAdmin(dateStr, doc.id, kiosk.pdvFilialId, db);
          successCount++;
          console.log(`✅ ${kiosk.name} (${dateStr}) sincronizado com sucesso.`);
        } catch (err) {
          console.error(`❌ Erro ao sincronizar ${kiosk.name} (${dateStr}):`, err);
        }
      }
    }

    console.log(`Sincronização diária concluída. ${successCount} dias preenchidos.`);
  } catch (error) {
    console.error("Erro fatal na rotina diária:", error);
  }
});

// --- Criar usuário (Auth + Firestore) server-side ---
export const createUser = onCall(
  { 
    cors: ["*"] 
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
  { cors: ["*"] },
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
