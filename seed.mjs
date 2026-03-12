import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({
  credential: applicationDefault(),
  projectId: 'smart-converter-752gf',
});

const db = getFirestore('coala');

async function seed() {
  await db.collection('profiles').doc('admin').set({
    name: 'Administrador',
    permissions: {
      settings: { manageUsers: true, manageProfiles: true },
      stock: {
        inventoryControl: { view: true, addLot: true, editLot: true, writeDown: true },
        purchasing: { view: true, suggest: true, approve: true, deleteHistory: true },
        returns: { view: true, add: true, updateStatus: true, delete: true },
        audit: { view: true, start: true, approve: true },
        analysis: { restock: true }
      },
      registration: {
        items: { add: true, edit: true, delete: true },
        baseProducts: { add: true, edit: true, delete: true }
      },
      pricing: { simulate: true, manageParameters: true }
    }
  });
  console.log('✅ profiles/admin criado');

  await db.collection('users').doc('U0Q9YZIl7XhQU2B0tB5U6Zpt5Td2').set({
    username: 'Administrador',
    email: 'administrativo@coalas.com',
    profileId: 'admin',
    assignedKioskIds: []
  });
  console.log('✅ users/admin criado');
}

seed().catch(console.error);
