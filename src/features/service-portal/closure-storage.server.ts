import 'server-only';
import { getStorage } from 'firebase-admin/storage';
import { adminApp } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';

export const closureStorage = {
  async readStorage(path: string) {
    return (await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).download())[0];
  },
};
