import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// We use initializeApp if it hasn't been initialized yet
import { dbAdmin } from './src/lib/firebase-admin';

async function checkKiosks() {
  const db = getFirestore();
  const snap = await db.collection('kiosks').get();
  console.log('--- KIOSKS IN FIRESTORE ---');
  snap.forEach(doc => {
    console.log(`ID: ${doc.id}, Name: ${doc.data().name}`);
  });
}

checkKiosks().catch(console.error);
