import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const projectId = "demo-coala-rules";
const rules = await readFile(new URL("../../firestore.rules", import.meta.url), "utf8");

test("regras principais preservam leitura autenticada e bloqueiam acesso não autenticado e escrita direta", async () => {
  assertFirestoreEmulatorSafety({ projectId });

  const environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });

  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "profiles/basic"), {
        name: "Perfil básico",
        permissions: {},
      });
    });

    const unauthenticated = environment.unauthenticatedContext();
    const authenticated = environment.authenticatedContext("user-1");

    await assertFails(getDoc(doc(unauthenticated.firestore(), "profiles/basic")));
    await assertSucceeds(getDoc(doc(authenticated.firestore(), "profiles/basic")));
    await assertFails(setDoc(doc(authenticated.firestore(), "users/forged"), {
      username: "forged",
      email: "forged@example.invalid",
      profileId: "basic",
      assignedKioskIds: [],
    }));
  } finally {
    await environment.cleanup();
  }

});
