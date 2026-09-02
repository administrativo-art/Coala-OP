import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

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

test("folgas gerenciadas pelo Bizneo só podem ser alteradas pelo servidor", async () => {
  assertFirestoreEmulatorSafety({ projectId });

  const environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });

  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await Promise.all([
        setDoc(doc(firestore, "profiles/schedule-editor"), {
          name: "Editor de escalas",
          permissions: { dp: { schedules: { edit: true } } },
        }),
        setDoc(doc(firestore, "users/editor"), {
          profileId: "schedule-editor",
          profileCompliance: { status: "complete", policyVersion: 1 },
        }),
        setDoc(doc(firestore, "dp_schedules/schedule-1"), {
          name: "Setembro de 2026",
          month: 9,
          year: 2026,
        }),
        setDoc(doc(firestore, "dp_schedules/schedule-1/shifts/managed-day-off"), {
          userId: "collaborator-1",
          unitId: "unit-1",
          date: "2026-09-07",
          startTime: "",
          endTime: "",
          type: "day_off",
          bizneoOperationId: "operation-1",
          bizneoSyncStatus: "published",
        }),
      ]);
    });

    const editor = environment.authenticatedContext("editor").firestore();
    await assertSucceeds(setDoc(doc(editor, "dp_schedules/schedule-1/shifts/work"), {
      userId: "collaborator-1",
      unitId: "unit-1",
      date: "2026-09-08",
      startTime: "10:00",
      endTime: "16:15",
      type: "work",
    }));
    await assertFails(setDoc(doc(editor, "dp_schedules/schedule-1/shifts/forged-day-off"), {
      userId: "collaborator-1",
      unitId: "unit-1",
      date: "2026-09-09",
      startTime: "",
      endTime: "",
      type: "day_off",
      bizneoOperationId: "forged-operation",
      bizneoSyncStatus: "published",
    }));
    await assertFails(updateDoc(doc(editor, "dp_schedules/schedule-1/shifts/managed-day-off"), {
      bizneoSyncStatus: "failed",
    }));
    await assertFails(updateDoc(doc(editor, "dp_schedules/schedule-1/shifts/managed-day-off"), {
      type: "work",
      startTime: "10:00",
      endTime: "16:15",
    }));
    await assertFails(deleteDoc(doc(editor, "dp_schedules/schedule-1/shifts/managed-day-off")));
    await assertFails(getDoc(doc(editor, "dp_bizneo_day_off_operations/operation-1")));
  } finally {
    await environment.cleanup();
  }
});
