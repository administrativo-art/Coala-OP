import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();
setGlobalOptions({ maxInstances: 10 });

const db = getFirestore('coala');
const auth = getAuth();

export const onUserProfileChange = onDocumentWritten(
  { document: 'users/{userId}', database: 'coala' },
  async (event) => {
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

export const onProfileChange = onDocumentWritten(
  { document: 'profiles/{profileId}', database: 'coala' },
  async (event) => {
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
