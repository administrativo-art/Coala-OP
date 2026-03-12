import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({
  credential: applicationDefault(),
  projectId: 'smart-converter-752gf',
});

const db = getFirestore('coala');

async function fix() {
  await db.collection('profiles').doc('admin').update({
    isDefaultAdmin: true,
  });
  console.log('✅ profiles/admin atualizado com isDefaultAdmin: true');
}

fix().catch(console.error);
