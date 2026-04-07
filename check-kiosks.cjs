const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

// Simple initialization for check
const projectId = 'smart-converter-752gf';
const app = initializeApp({
  projectId: projectId,
});

const db = getFirestore(app, "coala");

async function checkKiosks() {
  const snap = await db.collection('kiosks').get();
  console.log('--- KIOSKS IN FIRESTORE ---');
  snap.forEach(doc => {
    console.log(`ID: ${doc.id}, Name: ${doc.data().name}`);
  });
}

checkKiosks().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
