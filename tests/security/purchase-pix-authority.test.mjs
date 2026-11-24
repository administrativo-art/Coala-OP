import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const root = new URL("../../", import.meta.url);

test("cliente não cria indicação Pix nem muda a indicação gravada pelo servidor", async () => {
  const rules = await readFile(new URL("firestore.financial.rules", root), "utf8");
  const env = await initializeTestEnvironment({ projectId: "demo-purchase-pix-financial-rules", firestore: { rules } });
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "users/editor"), {
        active: true, permissions: { view: true, expenses: { view: true, create: true, edit: true } },
      });
      await setDoc(doc(db, "expenses/one"), { status: "pending", notes: "original" });
      await setDoc(doc(db, "expenses/two"), { status: "pending", notes: "original",
        purchasePixIndication: { beneficiaryEntityId: "receiver-one", confirmedBy: "operator" } });
    });
    const db = env.authenticatedContext("editor").firestore();
    await assertSucceeds(updateDoc(doc(db, "expenses/one"), { notes: "revisado" }));
    await assertSucceeds(updateDoc(doc(db, "expenses/two"), { notes: "revisado com indicação preservada" }));
    await assertFails(updateDoc(doc(db, "expenses/one"), {
      purchasePixIndication: { beneficiaryEntityId: "receiver-two", confirmedBy: "editor" },
    }));
    await assertFails(updateDoc(doc(db, "expenses/two"), {
      purchasePixIndication: { beneficiaryEntityId: "receiver-two", confirmedBy: "editor" },
    }));
    let saved;
    await env.withSecurityRulesDisabled(async (context) => { saved = await getDoc(doc(context.firestore(), "expenses/two")); });
    assert.equal(saved.data()?.purchasePixIndication?.beneficiaryEntityId, "receiver-one");
  } finally { await env.cleanup(); }
});

test("cliente não forja confirmação ou NF de compra confirmada", async () => {
  const rules = await readFile(new URL("firestore.rules", root), "utf8");
  const env = await initializeTestEnvironment({ projectId: "demo-purchase-pix-main-rules", firestore: { rules } });
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "users/buyer"), { profileId: "buyer", profileCompliance: { status: "complete", policyVersion: 1 } });
      await setDoc(doc(db, "profiles/buyer"), { isDefaultAdmin: true });
      await setDoc(doc(db, "purchase_orders/draft"), { workspaceId: "coala", supplierId: "supplier", status: "created", createdAt: "now" });
      await setDoc(doc(db, "purchase_orders/draft/items/one"), { totalOrdered: 100 });
      await setDoc(doc(db, "purchase_orders/confirmed"), { workspaceId: "coala", supplierId: "supplier", status: "confirmed", createdAt: "now", invoiceAccessKey: "key" });
    });
    const db = env.authenticatedContext("buyer", { isDefaultAdmin: true }).firestore();
    await assertSucceeds(updateDoc(doc(db, "purchase_orders/draft"), { notes: "revisão" }));
    await assertSucceeds(updateDoc(doc(db, "purchase_orders/confirmed"), { notes: "documento recebido" }));
    await assertFails(updateDoc(doc(db, "purchase_orders/draft/items/one"), { totalOrdered: 200 }));
    await assertFails(setDoc(doc(db, "purchase_orders/draft/items/two"), { totalOrdered: 200 }));
    await assertFails(updateDoc(doc(db, "purchase_orders/draft"), { status: "confirmed" }));
    await assertFails(setDoc(doc(db, "purchase_orders/forged"), { workspaceId: "coala", supplierId: "supplier",
      status: "created", createdAt: "now", linkedExpenseId: "someone-elses-expense" }));
    await assertFails(setDoc(doc(db, "purchase_orders/forged-freight"), { workspaceId: "coala", supplierId: "supplier",
      status: "created", createdAt: "now", linkedFreightExpenseId: "someone-elses-freight" }));
    await assertFails(updateDoc(doc(db, "purchase_orders/draft"), { linkedServiceFeeExpenseId: "forged" }));
    await assertFails(updateDoc(doc(db, "purchase_orders/confirmed"), { invoiceAccessKey: "other" }));
    await assertFails(updateDoc(doc(db, "purchase_orders/confirmed"), { linkedExpenseId: "forged" }));
  } finally { await env.cleanup(); }
});
