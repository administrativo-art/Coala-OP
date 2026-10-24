import {
  loadExecutiveJobRoleHierarchyPlan,
  reconcileExecutiveJobRoleHierarchy,
} from "../src/features/hr/lib/job-role-hierarchy.server";

const apply = process.argv.includes("--apply");
const projectId =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  "";

if (projectId !== "smart-converter-752gf") {
  throw new Error(
    "A reconciliação real exige FIREBASE_PROJECT_ID=smart-converter-752gf."
  );
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("A reconciliação real não aceita FIRESTORE_EMULATOR_HOST.");
}

const plan = await loadExecutiveJobRoleHierarchyPlan();
if (!plan.generalDirectorId || !plan.deputyGeneralDirectorId) {
  throw new Error(
    "Não foi possível identificar de forma única Diretor geral e Vice-diretor geral."
  );
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  projectId,
  database: "coala-rh",
  generalDirectorId: plan.generalDirectorId,
  deputyGeneralDirectorId: plan.deputyGeneralDirectorId,
  updates: plan.updates,
}, null, 2));

if (apply && plan.updates.length > 0) {
  await reconcileExecutiveJobRoleHierarchy();
  const verification = await loadExecutiveJobRoleHierarchyPlan();
  if (verification.updates.length > 0) {
    throw new Error("A hierarquia continuou divergente após a reconciliação.");
  }
  console.log(JSON.stringify({ status: "reconciled", updated: plan.updates.length }, null, 2));
}

process.exit(0);
