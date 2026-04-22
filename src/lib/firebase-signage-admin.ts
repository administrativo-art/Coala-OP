import { getFirestore } from 'firebase-admin/firestore';

import { adminApp } from './firebase-admin';

export const signageDbAdmin = getFirestore(adminApp, 'coala-signage');
