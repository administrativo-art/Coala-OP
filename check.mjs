import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({
  credential: applicationDefault(),
  projectId: 'smart-converter-752gf',
});

const db = getFirestore('coala');

async function check() {
  const userDoc = await db.collection('users').doc('U0Q9YZIl7XhQU2B0tB5U6Zpt5Td2').get();
  console.log('users doc:', JSON.stringify(userDoc.data(), null, 2));
  
  const profileDoc = await db.collection('profiles').doc('admin').get();
  console.log('profile admin:', JSON.stringify(profileDoc.data(), null, 2));
}

check().catch(console.error);
