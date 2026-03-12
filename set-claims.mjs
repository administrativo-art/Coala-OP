import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({
  credential: applicationDefault(),
  projectId: 'smart-converter-752gf',
});

const auth = getAuth();
const db = getFirestore('coala');

async function setClaims() {
  // Busca todos os usuários do Firestore
  const usersSnap = await db.collection('users').get();
  
  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data();
    const uid = userDoc.id;
    const profileId = userData.profileId;

    if (!profileId) {
      console.log(`⚠️  Usuário ${uid} sem profileId, pulando...`);
      continue;
    }

    // Busca o perfil para saber se é admin
    const profileSnap = await db.collection('profiles').doc(profileId).get();
    const isDefaultAdmin = profileSnap.exists && profileSnap.data()?.isDefaultAdmin === true;

    // Define os custom claims no token
    await auth.setCustomUserClaims(uid, {
      profileId,
      isDefaultAdmin,
    });

    console.log(`✅ Claims definidos para ${userData.username || uid}: profileId=${profileId}, isDefaultAdmin=${isDefaultAdmin}`);
  }

  console.log('\n🎉 Custom Claims configurados para todos os usuários!');
  console.log('⚠️  Os usuários precisam fazer logout e login para o token ser atualizado.');
}

setClaims().catch(console.error);
