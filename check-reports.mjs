import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

// Try to find service account or use default
let db;
try {
  initializeApp();
  db = getFirestore();
} catch (e) {
  console.error('Initialization failed:', e.message);
  process.exit(1);
}

async function run() {
  const kiosksSnap = await db.collection('kiosks').get();
  console.log('--- KIOSKS ---');
  kiosksSnap.forEach(doc => console.log(doc.id, doc.data().name));

  const reportsSnap = await db.collection('salesReports').get();
  console.log('\n--- SALES REPORTS ---');
  console.log('Total:', reportsSnap.size);
  
  const byKiosk = {};
  reportsSnap.forEach(doc => {
    const d = doc.data();
    const k = d.kioskId || 'unknown';
    if (!byKiosk[k]) byKiosk[k] = 0;
    byKiosk[k]++;
  });
  console.log('By Kiosk:', byKiosk);
}

run().catch(console.error);
