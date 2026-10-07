export const FIREBASE_TEST_CREDENTIAL_ENV_KEYS: readonly string[];
export function assertNoFirebaseTestCredentials(env?: NodeJS.ProcessEnv): void;
export function assertFirestoreEmulatorSafety(input: {
  projectId: string;
  env?: NodeJS.ProcessEnv;
}): Readonly<{ projectId: string }>;
