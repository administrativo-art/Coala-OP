import "server-only";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import type { ServerUserContext } from "@/lib/auth-server";
import type { DreExpenseAccountMeta } from "../lib/dre-expense-calculation";
import { getDreSourceData } from "./source-data.server";
import { getDreStockCmv } from "./stock-cmv.server";
import { loadDreReportWithServices } from "./report-loader";
import type { DreReportInput } from "./report-access";
export async function loadDreReport(input: DreReportInput, actor: ServerUserContext) {
  return loadDreReportWithServices(input, actor, {
    now: () => new Date(), readSources: getDreSourceData, readStock: getDreStockCmv,
    readKiosks: async () => (await dbAdmin.collection("kiosks").limit(201).select("name", "pdvFilialId").get()).docs.map(doc => ({ id: doc.id, name: String(doc.get("name") || doc.id), pdvFilialId: doc.get("pdvFilialId") as string | undefined })),
    readCenters: async () => (await financialDbAdmin.collection("resultCenters").limit(201).select("name", "unitIds").get()).docs.map(doc => ({ id: doc.id, name: String(doc.get("name") || doc.id), unitIds: Array.isArray(doc.get("unitIds")) ? doc.get("unitIds") : [] })),
    readAccounts: async ids => { const accounts: Record<string, DreExpenseAccountMeta> = {};
      for (let i = 0; i < ids.length; i += 200) for (const doc of await financialDbAdmin.getAll(...ids.slice(i, i + 200).map(id => financialDbAdmin.collection("accounts").doc(id)), { fieldMask: ["name", "dre_position", "is_dre_account"] })) {
        if (doc.exists) accounts[doc.id] = { name: String(doc.get("name") || doc.id), drePosition: doc.get("dre_position") ?? null, isDreAccount: doc.get("is_dre_account") !== false };
      } return accounts;
    },
  });
}
