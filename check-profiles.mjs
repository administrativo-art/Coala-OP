import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({
  credential: applicationDefault(),
  projectId: 'smart-converter-752gf',
});

const db = getFirestore('coala');

async function check() {
  const snap = await db.collection('profiles').get();
  snap.forEach(doc => {
    console.log(`profiles/${doc.id}:`, JSON.stringify(doc.data(), null, 2));
  });
}

check().catch(console.error);
