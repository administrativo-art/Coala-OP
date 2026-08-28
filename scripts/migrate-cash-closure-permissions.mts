/**
 * Popula as chaves de fechamento e depósito em todos os perfis existentes.
 * Seguro por padrão: apenas perfis marcados como default admin recebem acesso;
 * os demais recebem todas as novas autoridades como false para configuração
 * explícita posterior na tela de perfis.
 *
 * Uso:
 *   node --import tsx scripts/migrate-cash-closure-permissions.mts
 *   node --import tsx scripts/migrate-cash-closure-permissions.mts --execute
 */
import { FieldPath } from "firebase-admin/firestore";
import { config } from "dotenv";

config({ path: ".env.local" });
const { dbAdmin } = await import("../src/lib/firebase-admin");

const execute = process.argv.includes("--execute");
const snapshot = await dbAdmin.collection("profiles").orderBy(FieldPath.documentId()).get();
const batch = dbAdmin.batch();
const changes: Array<{ id: string; admin: boolean }> = [];

for (const document of snapshot.docs) {
  const data = document.data();
  const admin = data.isDefaultAdmin === true;
  const currentFinancial = data.permissions?.financial ?? {};
  const currentCashClosures = currentFinancial.cashClosures ?? {};
  const cashClosures = {
    view: currentCashClosures.view ?? admin,
    edit: currentCashClosures.edit ?? admin,
    approve: currentCashClosures.approve ?? admin,
    adjustExpected: currentCashClosures.adjustExpected ?? admin,
    reopen: currentCashClosures.reopen ?? admin,
    resync: currentCashClosures.resync ?? admin,
  };
  const cashDeposits = currentFinancial.cashDeposits ?? {
    view: admin,
    issue: admin,
    cancel: admin,
    adjust: admin,
  };
  if (
    currentFinancial.cashClosures?.adjustExpected !== undefined
    && currentFinancial.cashDeposits
  ) continue;
  changes.push({ id: document.id, admin });
  if (execute) {
    batch.set(document.ref, {
      permissions: {
        financial: {
          ...currentFinancial,
          cashClosures,
          cashDeposits,
        },
      },
    }, { merge: true });
  }
}

if (execute && changes.length > 0) await batch.commit();

console.log(JSON.stringify({
  mode: execute ? "EXECUTED" : "DRY_RUN",
  scanned: snapshot.size,
  changed: changes.length,
  profiles: changes,
}, null, 2));
