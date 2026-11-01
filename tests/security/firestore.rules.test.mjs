import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, setDoc, updateDoc, where } from "firebase/firestore";

import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const projectId = "demo-coala-rules";
const rules = await readFile(new URL("../../firestore.rules", import.meta.url), "utf8");

test("política de reposição só muda pelo servidor; normalização, custo e código de barras continuam permitidos", async () => {
  assertFirestoreEmulatorSafety({ projectId });
  const environment = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'profiles/replenishment-editor'), {
        permissions: { registration: { baseProducts: { add: true, edit: true, delete: true } } },
      });
      await setDoc(doc(db, 'users/replenishment-editor'), { profileId: 'replenishment-editor',
        profileCompliance: { status: 'complete', policyVersion: 1 } });
      await setDoc(doc(db, 'baseProducts/replenishment-protected'), { name: 'Limão', category: 'Massa', unit: 'kg',
        stockLevels: { local: { min: 10, supplyMode: 'cd' } }, replenishmentPreview: {}, replenishmentPolicyVersion: 1 });
    });
    for (const claims of [{}, { isDefaultAdmin: true }]) {
      const db = environment.authenticatedContext('replenishment-editor', claims).firestore();
      const target = doc(db, 'baseProducts/replenishment-protected');
      await assertSucceeds(getDoc(target));
      await assertSucceeds(updateDoc(target, { barcode: '123', barcodes: ['123'], lastEffectivePrice: { value: 7 } }));
      for (const patch of [
        { 'stockLevels.local.min': 999 }, { 'stockLevels.other.supplyMode': 'direct' },
        { replenishmentPreview: { local: { min: 999 } } }, { replenishmentPolicyVersion: 999 },
        { minStockRecalcPeriod: 'biweekly' }, { unit: 'g' }, { category: 'Volume' },
      ]) await assertFails(updateDoc(target, patch));
      await assertFails(setDoc(doc(db, 'baseProducts/replenishment-forged'), { name: 'Forjado', category: 'Massa', unit: 'kg',
        stockLevels: { other: { supplyMode: 'direct', min: 999 } } }));
      await assertFails(setDoc(doc(db, 'baseProducts/replenishment-forged'), { name: 'Forjado', category: 'Massa', unit: 'kg',
        stockLevels: {}, replenishmentPolicyVersion: 999 }));
      await assertSucceeds(setDoc(doc(db, 'baseProducts/replenishment-normalized'), {
        name: 'Normalizado', category: 'Massa', unit: 'kg', stockLevels: {},
      }));
      await assertSucceeds(deleteDoc(doc(db, 'baseProducts/replenishment-normalized')));
    }
  } finally { await environment.cleanup(); }
});

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
          permissions: { dp: { schedules: { create: true, edit: true } } },
        }),
        setDoc(doc(firestore, "users/editor"), {
          profileId: "schedule-editor",
          unitIds: ["unit-1"],
          profileCompliance: { status: "complete", policyVersion: 1 },
        }),
        setDoc(doc(firestore, "users/schedule-admin"), {
          profileId: "schedule-editor",
          profileCompliance: { status: "complete", policyVersion: 1 },
        }),
        setDoc(doc(firestore, "dp_schedules/schedule-1"), {
          name: "Setembro de 2026",
          month: 9,
          year: 2026,
          unitId: "unit-1",
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
        setDoc(doc(firestore, "dp_schedules/schedule-1/shifts/work-existing"), {
          userId: "collaborator-1",
          unitId: "unit-1",
          date: "2026-09-08",
          startTime: "10:00",
          endTime: "16:15",
          type: "work",
        }),
      ]);
    });

    const editor = environment.authenticatedContext("editor").firestore();
    await assertFails(updateDoc(doc(editor, "dp_schedules/schedule-1"), {
      name: "Setembro de 2026 — revisada",
    }));
    await assertFails(updateDoc(doc(editor, "dp_schedules/schedule-1"), {
      publicationStatus: "draft", draftVersion: 1,
    }));
    await assertFails(updateDoc(doc(editor, "dp_schedules/schedule-1"), {
      coverageDemands: {
        "2026-09-08": [{ startTime: "09:00", endTime: "12:00", minimumPeople: 2 }],
      },
    }));
    await assertFails(updateDoc(doc(editor, "dp_schedules/schedule-1"), {
      unitId: "unit-2",
    }));
    await assertFails(updateDoc(doc(editor, "dp_schedules/schedule-1"), {
      locked: true,
      snapshot: { users: {} },
      journeyValidation: { status: "ok", version: 0 },
    }));
    await assertFails(updateDoc(doc(editor, "dp_schedules/schedule-1"), {
      journeyValidationVersion: 999,
    }));
    await assertFails(setDoc(doc(editor, "dp_schedules/schedule-forged-demand"), {
      name: "Outubro de 2026",
      month: 10,
      year: 2026,
      coverageDemands: {
        "2026-10-01": [{ startTime: "09:00", endTime: "12:00", minimumPeople: 2 }],
      },
    }));
    await assertFails(setDoc(doc(editor, "dp_schedules/schedule-forged-lock"), {
      name: "Outubro de 2026",
      month: 10,
      year: 2026,
      locked: true,
      journeyValidationVersion: 0,
    }));
    await assertFails(setDoc(doc(editor, "dp_schedules/schedule-forged-version"), {
      name: "Outubro de 2026",
      month: 10,
      year: 2026,
      journeyValidationVersion: 1,
    }));
    await assertFails(setDoc(doc(editor, "dp_schedules/schedule-1/shifts/work"), {
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
    await assertFails(deleteDoc(doc(editor, "dp_schedules/schedule-1/shifts/work-existing")));
    await assertFails(deleteDoc(doc(environment.authenticatedContext("schedule-admin", { isDefaultAdmin: true }).firestore(), "dp_schedules/schedule-1")));
    await assertFails(getDoc(doc(editor, "dp_bizneo_day_off_operations/operation-1")));
  } finally {
    await environment.cleanup();
  }
});

test("escala respeita o escopo de unidades e participante de meta só nasce pela API", async () => {
  assertFirestoreEmulatorSafety({ projectId });
  const environment = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await Promise.all([
        setDoc(doc(firestore, "profiles/schedule-reader"), {
          permissions: { dp: { schedules: { view: true, create: true } }, goals: { manage: true } },
        }),
        setDoc(doc(firestore, "users/scoped-reader"), {
          profileId: "schedule-reader",
          unitIds: ["unit-1"],
          profileCompliance: { status: "complete", policyVersion: 1 },
        }),
        setDoc(doc(firestore, "dp_schedules/allowed-schedule"), { name: "Permitida", month: 9, year: 2026, unitId: "unit-1" }),
        setDoc(doc(firestore, "dp_schedules/blocked-schedule"), { name: "Bloqueada", month: 9, year: 2026, unitId: "unit-2" }),
        setDoc(doc(firestore, "dp_schedules/allowed-schedule/shifts/allowed-shift"), { userId: "someone", unitId: "unit-1", date: "2026-09-01", type: "work" }),
        setDoc(doc(firestore, "dp_schedules/blocked-schedule/shifts/blocked-shift"), { userId: "someone", unitId: "unit-2", date: "2026-09-01", type: "work", originUnitId: "unit-9", exceptionReason: "Cobertura externa" }),
        setDoc(doc(firestore, "goalPeriods/active-period"), { kioskId: "unit-1", status: "active", currentValue: 0 }),
      ]);
    });

    const scoped = environment.authenticatedContext("scoped-reader").firestore();
    await assertSucceeds(getDoc(doc(scoped, "dp_schedules/allowed-schedule")));
    await assertFails(getDoc(doc(scoped, "dp_schedules/blocked-schedule")));
    await assertSucceeds(getDoc(doc(scoped, "dp_schedules/allowed-schedule/shifts/allowed-shift")));
    await assertFails(getDoc(doc(scoped, "dp_schedules/blocked-schedule/shifts/blocked-shift")));
    await assertSucceeds(getDocs(query(collection(scoped, "dp_schedules"), where("unitId", "==", "unit-1"))));
    await assertFails(getDocs(collection(scoped, "dp_schedules")));
    await assertSucceeds(runTransaction(scoped, async (transaction) => {
      const target = doc(scoped, "dp_schedules/new-scoped-schedule");
      const existing = await transaction.get(target);
      if (!existing.exists()) {
        transaction.set(target, { name: "Nova", month: 10, year: 2026, unitId: "unit-1",
          publicationStatus: "draft", publicationVersion: 0 });
      }
    }));
    await assertFails(setDoc(doc(scoped, "employeeGoals/forged-external-participant"), {
      periodId: "period-1", employeeId: "someone", kioskId: "unit-1", fraction: 1, targetValue: 100, currentValue: 0,
    }));
    await assertSucceeds(updateDoc(doc(scoped, "goalPeriods/active-period"), { currentValue: 50 }));
    await assertFails(updateDoc(doc(scoped, "goalPeriods/active-period"), {
      status: "closed", closedBy: "scoped-reader", closureSnapshot: {},
    }));
  } finally {
    await environment.cleanup();
  }
});


test("snapshots internos, trocas de turno e auditoria ficam inacessíveis diretamente ao cliente", async () => {
  assertFirestoreEmulatorSafety({ projectId });
  const environment = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext("cmv-user"),
      environment.authenticatedContext("cmv-admin", { admin: true })]) {
      for (const path of ["dreCmvClosures/test", "dreCmvClosures/test/revisions/1", "dreCmvClosures/test/audit/1", "dp_shiftSwapRequests/test"]) {
        await assertFails(getDoc(doc(context.firestore(), path)));
        await assertFails(setDoc(doc(context.firestore(), path), { totalCmv: 0, status: "closed" }));
        await assertFails(deleteDoc(doc(context.firestore(), path)));
      }
    }
  } finally { await environment.cleanup(); }
});
