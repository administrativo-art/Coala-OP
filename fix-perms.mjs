import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({
  credential: applicationDefault(),
  projectId: 'smart-converter-752gf',
});

const db = getFirestore('coala');

async function fix() {
  await db.collection('profiles').doc('admin').update({
    'permissions.dashboard': {
      view: true,
      operational: true,
      pricing: true,
      technicalSheets: true,
      audit: true,
    },
    'permissions.tasks': {
      view: true,
      create: true,
      edit: true,
      delete: true,
    },
    'permissions.itemRequests': {
      approve: true,
    },
    'permissions.returns': {
      view: true,
      add: true,
      updateStatus: true,
      delete: true,
    },
  });
  console.log('✅ Permissões atualizadas!');
}

fix().catch(console.error);
