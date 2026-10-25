import { hrDbAdmin } from "@/lib/firebase-rh-admin";

import {
  planExecutiveJobRoleHierarchy,
  type ExecutiveHierarchyPlan,
} from "./job-role-hierarchy";

export async function loadExecutiveJobRoleHierarchyPlan() {
  const snapshot = await hrDbAdmin.collection("jobRoles").get();
  return planExecutiveJobRoleHierarchy(
    snapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }))
  );
}

export async function reconcileExecutiveJobRoleHierarchy(): Promise<ExecutiveHierarchyPlan> {
  const plan = await loadExecutiveJobRoleHierarchyPlan();
  if (plan.updates.length === 0) return plan;

  const batch = hrDbAdmin.batch();
  const updatedAt = new Date().toISOString();
  for (const update of plan.updates) {
    batch.set(
      hrDbAdmin.collection("jobRoles").doc(update.id),
      {
        parentId: update.parentId,
        reportsTo: update.reportsTo,
        updatedAt,
      },
      { merge: true }
    );
  }
  await batch.commit();
  return plan;
}
