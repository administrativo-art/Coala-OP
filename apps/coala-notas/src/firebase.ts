import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { getAuth, getReactNativePersistence, initializeAuth } from "@firebase/auth";
import { getApp, getApps, initializeApp } from "@firebase/app";

import { appConfig } from "./config";

const app = getApps().length ? getApp() : initializeApp(appConfig.firebase);

const securePersistence = {
  async key(key: string) {
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
    return `firebase_auth_${digest}`;
  },
  async getItem(key: string) {
    return SecureStore.getItemAsync(await this.key(key));
  },
  async setItem(key: string, value: string) {
    await SecureStore.setItemAsync(await this.key(key), value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
  async removeItem(key: string) {
    await SecureStore.deleteItemAsync(await this.key(key));
  },
};

export const auth = (() => {
  try {
    return initializeAuth(app, { persistence: getReactNativePersistence(securePersistence) });
  } catch {
    return getAuth(app);
  }
})();
