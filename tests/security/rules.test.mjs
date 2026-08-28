import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import {
  getDownloadURL,
  listAll,
  ref,
  uploadBytes,
} from "firebase/storage";

const root = new URL("../../", import.meta.url);
const rules = {
  main: await readFile(new URL("firestore.rules", root), "utf8"),
  financial: await readFile(new URL("firestore.financial.rules", root), "utf8"),
  rh: await readFile(new URL("firestore.rh.rules", root), "utf8"),
  storage: await readFile(new URL("storage.rules", root), "utf8"),
};

const basePermissions = {
  settings: {
    manageProfiles: false,
    manageUsers: false,
    manageKiosks: false,
  },
  dp: {
    collaborators: {
      view: false,
      edit: false,
      terminate: false,
    },
  },
  stock: {
    inventoryControl: {
      view: false,
      addLot: false,
      editLot: false,
      writeDown: false,
      transfer: false,
      viewHistory: false,
    },
    stockCount: {
      perform: false,
      approve: false,
    },
    purchasing: {
      view: false,
      approve: false,
    },
  },
  purchasing: {
    view: false,
    receivePurchase: false,
  },
  assets: {
    view: false,
    viewHistory: false,
  },
};

function profile(overrides = {}) {
  return {
    name: "Perfil",
    isDefaultAdmin: false,
    permissions: {
      ...basePermissions,
      ...overrides,
      settings: {
        ...basePermissions.settings,
        ...(overrides.settings ?? {}),
      },
      dp: {
        ...basePermissions.dp,
        ...(overrides.dp ?? {}),
        collaborators: {
          ...basePermissions.dp.collaborators,
          ...(overrides.dp?.collaborators ?? {}),
        },
      },
      stock: {
        ...basePermissions.stock,
        ...(overrides.stock ?? {}),
        inventoryControl: {
          ...basePermissions.stock.inventoryControl,
          ...(overrides.stock?.inventoryControl ?? {}),
        },
        stockCount: {
          ...basePermissions.stock.stockCount,
          ...(overrides.stock?.stockCount ?? {}),
        },
        purchasing: {
          ...basePermissions.stock.purchasing,
          ...(overrides.stock?.purchasing ?? {}),
        },
      },
      purchasing: {
        ...basePermissions.purchasing,
        ...(overrides.purchasing ?? {}),
      },
      assets: {
        ...basePermissions.assets,
        ...(overrides.assets ?? {}),
      },
    },
  };
}

function compliantUser(profileId) {
  return {
    profileId,
    profileCompliance: {
      status: "complete",
      policyVersion: 1,
      lastConfirmedAt: new Date(),
      nextReviewAt: new Date("2000-01-01T03:00:00.000Z"),
    },
  };
}

test("Firestore principal bloqueia escalação e preserva operações autorizadas", async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-security-main",
    firestore: { rules: rules.main },
    storage: { rules: rules.storage },
  });

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const {
        isDefaultAdmin: _legacyAdminFlag,
        ...legacyStockProfile
      } = profile({
        stock: { inventoryControl: { view: true, writeDown: true } },
      });
      await Promise.all([
        setDoc(doc(db, "profiles/basic"), profile()),
        setDoc(doc(db, "profiles/profile-manager"), profile({
          settings: { manageProfiles: true },
        })),
        setDoc(doc(db, "profiles/stock-operator"), legacyStockProfile),
        setDoc(doc(db, "profiles/asset-viewer"), profile({
          assets: { view: true, viewHistory: true },
        })),
        setDoc(doc(db, "users/basic-user"), compliantUser("basic")),
        setDoc(doc(db, "users/profile-manager"), compliantUser("profile-manager")),
        setDoc(doc(db, "users/stock-operator"), compliantUser("stock-operator")),
        setDoc(doc(db, "users/asset-viewer"), compliantUser("asset-viewer")),
        setDoc(doc(db, "users/other-user"), compliantUser("basic")),
        setDoc(doc(db, "users/admin-user"), compliantUser("basic")),
        setDoc(doc(db, "users/pending-user"), {
          profileId: "stock-operator",
          profileCompliance: {
            status: "pending",
            policyVersion: 1,
            nextReviewAt: new Date("2099-01-01T03:00:00.000Z"),
          },
        }),
        setDoc(doc(db, "assets/asset-1"), { name: "Notebook" }),
        setDoc(doc(db, "lots/lot-1"), {
          kioskId: "kiosk-1",
          productId: "product-1",
          quantity: 10,
        }),
        setDoc(doc(db, "lots/uniform-lot"), {
          kioskId: "__uniform_stock__",
          productId: "uniform-product",
          quantity: 5,
          condition: "novo",
        }),
      ]);

      const storage = context.storage();
      await uploadBytes(
        ref(storage, "hr/resumes/internal/private.pdf"),
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        { contentType: "application/pdf" },
      );
    });

    const basic = env.authenticatedContext("basic-user");
    const manager = env.authenticatedContext("profile-manager");
    const stockOperator = env.authenticatedContext("stock-operator");
    const assetViewer = env.authenticatedContext("asset-viewer");
    const pending = env.authenticatedContext("pending-user");
    const admin = env.authenticatedContext("admin-user", { isDefaultAdmin: true });

    await assertFails(getDoc(doc(basic.firestore(), "users/other-user")));
    await assertSucceeds(getDoc(doc(pending.firestore(), "users/pending-user")));
    await assertSucceeds(getDoc(doc(pending.firestore(), "profiles/stock-operator")));
    await assertFails(getDoc(doc(pending.firestore(), "lots/lot-1")));
    await assertFails(setDoc(doc(basic.firestore(), "users/basic-user"), { profileId: "profile-manager" }, { merge: true }));
    await assertSucceeds(getDoc(doc(stockOperator.firestore(), "lots/lot-1")));
    await assertFails(updateDoc(doc(stockOperator.firestore(), "lots/uniform-lot"), {
      quantity: 4,
    }));
    await assertFails(setDoc(doc(stockOperator.firestore(), "uniformAssignments/forged"), {
      collaboratorUserId: "other-user",
      quantityInPossession: 1,
    }));

    await assertFails(updateDoc(doc(manager.firestore(), "profiles/profile-manager"), {
      isDefaultAdmin: true,
    }));
    await assertFails(setDoc(doc(manager.firestore(), "profiles/elevated"), profile({
      settings: { manageUsers: true },
    })));
    await assertSucceeds(updateDoc(doc(manager.firestore(), "profiles/basic"), {
      name: "Perfil operacional",
    }));
    await assertSucceeds(updateDoc(doc(admin.firestore(), "profiles/profile-manager"), {
      isDefaultAdmin: true,
    }));

    await assertFails(setDoc(doc(basic.firestore(), "movementHistory/spoofed"), {
      type: "SAIDA",
      userId: "admin-user",
      timestamp: new Date().toISOString(),
    }));
    await assertSucceeds(setDoc(doc(stockOperator.firestore(), "movementHistory/valid"), {
      type: "SAIDA",
      userId: "stock-operator",
      timestamp: new Date().toISOString(),
    }));
    await assertFails(setDoc(doc(stockOperator.firestore(), "movementHistory/other-user"), {
      type: "SAIDA",
      userId: "other-user",
      timestamp: new Date().toISOString(),
    }));

    const batch = writeBatch(stockOperator.firestore());
    batch.set(doc(stockOperator.firestore(), "movementHistory/uniform-movement"), {
      type: "SAIDA_ENTREGA_UNIFORME",
      userId: "stock-operator",
      timestamp: new Date().toISOString(),
    });
    batch.set(doc(stockOperator.firestore(), "uniformEvents/uniform-event"), {
      movementId: "uniform-movement",
      registeredByUserId: "stock-operator",
      collaboratorUserId: "other-user",
    });
    await assertFails(batch.commit());

    await assertFails(getDoc(doc(basic.firestore(), "assets/asset-1")));
    await assertSucceeds(getDoc(doc(assetViewer.firestore(), "assets/asset-1")));

    await assertFails(getDownloadURL(ref(basic.storage(), "hr/resumes/internal/private.pdf")));
    await assertFails(listAll(ref(basic.storage(), "hr/resumes/internal")));
    await assertFails(uploadBytes(
      ref(basic.storage(), "assets/asset-1/forged.jpg"),
      new Uint8Array([1, 2, 3]),
      { contentType: "image/jpeg" },
    ));
    await assertSucceeds(uploadBytes(
      ref(basic.storage(), "avatars/basic-user"),
      new Uint8Array([1, 2, 3]),
      { contentType: "image/png" },
    ));
    await assertFails(uploadBytes(
      ref(basic.storage(), "avatars/other-user"),
      new Uint8Array([1, 2, 3]),
      { contentType: "image/png" },
    ));
  } finally {
    await env.cleanup();
  }
});

test("Financeiro separa edição de despesa do registro de pagamento", async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-security-financial",
    firestore: { rules: rules.financial },
  });

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const permissions = {
        view: true,
        dashboard: false,
        financialFlow: false,
        dre: false,
        cashFlow: { view: false, create: false },
        expenses: {
          view: true,
          create: false,
          edit: false,
          pay: true,
          import: false,
          delete: false,
        },
        audits: { view: false, import: false, edit: false, ignore: false, effectuate: false, manage: false },
        cardStatements: { view: true, import: false, audit: false, close: false, reconcile: true },
        personnelCosts: { view: false, edit: false, export: false },
        settings: {
          view: false,
          manageAccountPlans: false,
          manageResultCenters: false,
          manageBankAccounts: false,
          manageImportAliases: false,
          manageExpenseDescriptions: false,
        },
      };
      await Promise.all([
        setDoc(doc(db, "users/payer"), { active: true, isDefaultAdmin: false, permissions }),
        setDoc(doc(db, "users/editor"), {
          active: true,
          isDefaultAdmin: false,
          permissions: {
            ...permissions,
            expenses: { ...permissions.expenses, edit: true, pay: false },
          },
        }),
        setDoc(doc(db, "users/creator"), {
          active: true,
          isDefaultAdmin: false,
          permissions: {
            ...permissions,
            expenses: { ...permissions.expenses, create: true, pay: false },
          },
        }),
        setDoc(doc(db, "users/card-importer"), {
          active: true,
          isDefaultAdmin: false,
          permissions: {
            ...permissions,
            expenses: { ...permissions.expenses, pay: false },
            cardStatements: { ...permissions.cardStatements, import: true, reconcile: false },
          },
        }),
        setDoc(doc(db, "users/card-closer"), {
          active: true,
          isDefaultAdmin: false,
          permissions: {
            ...permissions,
            expenses: { ...permissions.expenses, pay: false },
            cardStatements: { ...permissions.cardStatements, close: true, reconcile: false },
          },
        }),
        setDoc(doc(db, "users/personnel-editor"), {
          active: true,
          isDefaultAdmin: false,
          permissions: {
            ...permissions,
            expenses: { ...permissions.expenses, edit: true, pay: false },
            personnelCosts: { view: true, edit: true, export: false },
          },
        }),
        setDoc(doc(db, "accounts/active-leaf"), {
          name: "Conta ativa",
          active: true,
          isGroup: false,
        }),
        setDoc(doc(db, "accounts/inactive-leaf"), {
          name: "Conta inativa",
          active: false,
          isGroup: false,
        }),
        setDoc(doc(db, "accounts/group-account"), {
          name: "Grupo",
          active: true,
          isGroup: true,
        }),
        setDoc(doc(db, "accounts/group-child-a"), {
          name: "Subconta A",
          active: true,
          isGroup: false,
          parentId: "group-account",
        }),
        setDoc(doc(db, "accounts/group-child-b"), {
          name: "Subconta B",
          active: true,
          isGroup: false,
          parentId: "group-account",
        }),
        setDoc(doc(db, "expenses/expense-1"), {
          description: "Despesa",
          totalValue: 1000,
          status: "pending",
        }),
        setDoc(doc(db, "financialInboxMessages/message-1"), {
          workspaceId: "coala-shakes",
          status: "pending_review",
        }),
        setDoc(doc(db, "bankPaymentRequests/request-1"), {
          status: "awaiting_financial_authorization",
          amount: 1000,
        }),
        setDoc(doc(db, "expectedBankDebits/debit-1"), {
          status: "active",
          amountCents: 100000,
        }),
      ]);
    });

    const payer = env.authenticatedContext("payer");
    const editor = env.authenticatedContext("editor");
    const creator = env.authenticatedContext("creator");
    const cardImporter = env.authenticatedContext("card-importer");
    const cardCloser = env.authenticatedContext("card-closer");
    const personnelEditor = env.authenticatedContext("personnel-editor");
    const cardImportDraft = {
      description: "Compra no cartão",
      totalValue: 39.9,
      competenceDate: new Date("2026-08-17T15:00:00.000Z"),
      dueDate: new Date("2026-09-12T15:00:00.000Z"),
      paymentMethod: "single",
      plannedPaymentMethodType: "credit_card",
      accountPlan: "",
      accountId: "",
      accountPlanId: "",
      hasAccountAllocations: false,
      accountAllocations: [],
      hasPersonAllocations: false,
      personAllocations: [],
      status: "pending",
      cardReconciliationStatus: "pending",
      cardStatementKey: "inter:card-1127:2026-08",
      cardStatementImportFingerprint: "card-line-1",
      importedFrom: "card_statement",
      sourceType: "card_statement_import",
      createdAt: new Date(),
      createdBy: "card-importer",
      updatedAt: new Date(),
      updatedBy: "card-importer",
    };
    // O botão Registrar pagamento usa uma API autenticada. O cliente não pode
    // marcar a despesa como paga sem criar obrigação, vínculo e histórico.
    await assertFails(getDoc(doc(payer.firestore(), "financialInboxMessages/message-1")));
    await assertFails(getDoc(doc(payer.firestore(), "bankPaymentRequests/request-1")));
    await assertFails(getDoc(doc(payer.firestore(), "expectedBankDebits/debit-1")));
    await assertFails(setDoc(doc(payer.firestore(), "expectedBankDebits/forged"), {
      status: "matched",
      statementTransactionId: "forged-transaction",
    }));
    await assertFails(updateDoc(doc(payer.firestore(), "expenses/expense-1"), {
      status: "paid",
      paidAt: new Date(),
    }));
    await assertSucceeds(setDoc(doc(cardImporter.firestore(), "cardStatements/inter__card__2026-08"), {
      key: "inter:card:2026-08",
      accountId: "inter",
      paymentMethodId: "card",
      status: "open",
    }));
    await assertFails(updateDoc(doc(cardImporter.firestore(), "cardStatements/inter__card__2026-08"), {
      status: "closed",
      officialTotal: 1000,
      allocations: [],
    }));
    await assertSucceeds(updateDoc(doc(cardCloser.firestore(), "cardStatements/inter__card__2026-08"), {
      status: "closed",
      officialTotal: 1000,
      allocations: [],
    }));
    // A reconciliação da fatura também é atômica e exclusiva da API do servidor.
    await assertFails(updateDoc(doc(payer.firestore(), "cardStatements/inter__card__2026-08"), {
      status: "paid",
      linkedBankTransactionId: "transaction-1",
      linkedBankTransactionIds: ["transaction-1"],
      settlements: [{ transactionId: "transaction-1", amount: 1000, paidAt: "2026-08-12" }],
      allocations: [],
      paidAt: new Date(),
      paidBy: "payer",
      updatedAt: new Date(),
    }));
    await assertFails(updateDoc(doc(payer.firestore(), "expenses/expense-1"), {
      installments: [{ number: 1, value: 1000, status: "paid" }],
      paidByCardStatement: true,
      cardStatementKey: "inter:card:2026-08",
      cardStatementId: "inter__card__2026-08",
      linkedBankTransactionId: "transaction-1",
      updatedAt: new Date(),
    }));
    await assertFails(setDoc(doc(payer.firestore(), "payments/manual-forged"), {
      expenseId: "expense-1",
      status: "REPORTED",
      totalPaid: 1000,
    }));
    await assertFails(setDoc(doc(payer.firestore(), "financialObligations/obligation-forged"), {
      sourceId: "expense-1",
      status: "PAID",
    }));
    await assertFails(setDoc(doc(payer.firestore(), "obligationPaymentLinks/link-forged"), {
      obligationId: "obligation-forged",
      expenseId: "expense-1",
      status: "MATCHED",
    }));
    await assertFails(setDoc(doc(payer.firestore(), "paymentAdjustments/adjustment-forged"), {
      obligationId: "obligation-forged",
      type: "INTEREST",
      amount: 10,
    }));
    await assertFails(updateDoc(doc(payer.firestore(), "expenses/expense-1"), {
      status: "pending",
      paidAt: new Date(),
      paidByCardStatement: true,
      cardStatementKey: "inter:card:2026-08",
      cardStatementId: "inter__card__2026-08",
      linkedBankTransactionId: "transaction-1",
      updatedAt: new Date(),
    }));
    await assertFails(updateDoc(doc(payer.firestore(), "expenses/expense-1"), {
      totalValue: 1,
    }));
    await assertSucceeds(updateDoc(doc(editor.firestore(), "expenses/expense-1"), {
      totalValue: 900,
    }));
    await assertFails(updateDoc(doc(editor.firestore(), "expenses/expense-1"), {
      hasPersonAllocations: true,
      personAllocations: [{ employeeId: "employee-1", employeeName: "Colaborador", amount: 900 }],
    }));
    await assertSucceeds(updateDoc(doc(personnelEditor.firestore(), "expenses/expense-1"), {
      hasPersonAllocations: true,
      personAllocations: [{ employeeId: "employee-1", employeeName: "Colaborador", amount: 900 }],
    }));
    await assertSucceeds(setDoc(doc(creator.firestore(), "expenses/valid-account"), {
      description: "Despesa com conta ativa",
      totalValue: 100,
      status: "pending",
      accountPlan: "active-leaf",
      accountId: "active-leaf",
    }));
    await assertSucceeds(setDoc(doc(cardImporter.firestore(), "expenses/card-import-pending"), cardImportDraft));
    await assertFails(setDoc(doc(cardImporter.firestore(), "expenses/card-import-paid"), {
      ...cardImportDraft,
      status: "paid",
    }));
    await assertFails(setDoc(doc(cardImporter.firestore(), "expenses/card-import-forged-owner"), {
      ...cardImportDraft,
      createdBy: "creator",
    }));
    await assertFails(setDoc(doc(creator.firestore(), "expenses/unclassified-manual"), {
      ...cardImportDraft,
      importedFrom: "manual",
      sourceType: "manual",
      createdBy: "creator",
      updatedBy: "creator",
    }));
    await assertFails(setDoc(doc(creator.firestore(), "expenses/inactive-account"), {
      description: "Despesa com conta inativa",
      totalValue: 100,
      status: "pending",
      accountPlan: "inactive-leaf",
      accountId: "inactive-leaf",
    }));
    await assertFails(setDoc(doc(creator.firestore(), "expenses/group-account"), {
      description: "Despesa com grupo",
      totalValue: 100,
      status: "pending",
      accountPlan: "group-account",
      accountId: "group-account",
    }));
    await assertFails(setDoc(doc(creator.firestore(), "expenses/group-account-one-allocation"), {
      description: "Despesa com grupo e apropriação incompleta",
      totalValue: 100,
      status: "pending",
      accountPlan: "group-account",
      accountId: "group-account",
      hasAccountAllocations: true,
      accountAllocations: [{ accountPlanId: "group-child-a", amount: 100 }],
    }));
    await assertSucceeds(setDoc(doc(creator.firestore(), "expenses/group-account-allocated"), {
      description: "Despesa com grupo apropriadamente desmembrada",
      totalValue: 100,
      status: "pending",
      accountPlan: "group-account",
      accountId: "group-account",
      hasAccountAllocations: true,
      accountAllocations: [
        { accountPlanId: "group-child-a", accountPlanName: "Subconta A", amount: 40 },
        { accountPlanId: "group-child-b", accountPlanName: "Subconta B", amount: 60 },
      ],
    }));
    await assertFails(setDoc(doc(creator.firestore(), "expenses/mismatched-account"), {
      description: "Despesa com conta divergente",
      totalValue: 100,
      status: "pending",
      accountPlan: "active-leaf",
      accountId: "inactive-leaf",
    }));
    await assertFails(updateDoc(doc(editor.firestore(), "expenses/expense-1"), {
      accountPlan: "group-account",
      accountId: "group-account",
    }));
    await assertFails(updateDoc(doc(editor.firestore(), "expenses/expense-1"), {
      accountPlan: "inactive-leaf",
      accountId: "inactive-leaf",
    }));
    await assertSucceeds(updateDoc(doc(editor.firestore(), "expenses/expense-1"), {
      accountPlan: "active-leaf",
      accountId: "active-leaf",
    }));
  } finally {
    await env.cleanup();
  }
});

test("Financeiro permite auditar sincronização do Inter sem alterar a identidade bancária", async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-security-inter-statement",
    firestore: { rules: rules.financial },
  });

  try {
    const transactionDate = new Date("2026-08-15T15:00:00.000Z");
    const createdAt = new Date("2026-08-15T15:01:00.000Z");
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const permissions = {
        view: true,
        dashboard: false,
        financialFlow: false,
        dre: false,
        cashFlow: { view: true, create: false },
        expenses: {
          view: true,
          create: false,
          edit: false,
          pay: false,
          import: true,
          delete: false,
        },
        audits: { view: true, import: true, edit: true, ignore: false, effectuate: false, manage: false },
        cardStatements: { view: false, import: false, audit: false, close: false, reconcile: false },
        personnelCosts: { view: false, edit: false, export: false },
        settings: { view: false },
      };
      await Promise.all([
        setDoc(doc(db, "users/importer"), { active: true, isDefaultAdmin: false, permissions }),
        setDoc(doc(db, "users/viewer"), {
          active: true,
          isDefaultAdmin: false,
          permissions: { ...permissions, audits: { ...permissions.audits, import: false, edit: false } },
        }),
        setDoc(doc(db, "transactions/inter-event"), {
          importedFrom: "bank_statement",
          importSource: "inter_api",
          externalTransactionId: "event-1",
          amount: 1200,
          date: transactionDate,
          description: "Pix enviado",
          auditStatus: "pending",
          createdBy: "system:inter-statement",
          createdAt,
        }),
        setDoc(doc(db, "importDrafts/inter-2026-08"), {
          status: "open",
          syncSource: "inter_api",
          syncKey: "account:2026-08",
          createdBy: "system:inter-statement",
          items: [],
        }),
      ]);
    });

    const importer = env.authenticatedContext("importer");
    const viewer = env.authenticatedContext("viewer");
    await assertSucceeds(updateDoc(doc(importer.firestore(), "transactions/inter-event"), {
      description: "Honorários advocatícios",
      auditStatus: "resolved",
      linkedExpenseId: "expense-1",
    }));
    await assertFails(updateDoc(doc(importer.firestore(), "transactions/inter-event"), {
      amount: 1,
    }));
    await assertFails(updateDoc(doc(viewer.firestore(), "transactions/inter-event"), {
      auditStatus: "resolved",
    }));
    await assertSucceeds(getDoc(doc(importer.firestore(), "importDrafts/inter-2026-08")));
    await assertFails(updateDoc(doc(importer.firestore(), "importDrafts/inter-2026-08"), {
      items: [{ id: "event-1", status: "completed" }],
    }));
    await assertFails(updateDoc(doc(importer.firestore(), "importDrafts/inter-2026-08"), {
      syncKey: "forged",
    }));
  } finally {
    await env.cleanup();
  }
});

test("Fechamento restringe unidade, esperado, aprovação e depósitos ao backend", async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-security-cash-closures",
    firestore: { rules: rules.financial },
  });

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const financialPermissions = {
        view: true,
        cashClosures: { view: true, edit: true, approve: false, adjustExpected: false, reopen: false, resync: false },
        cashDeposits: { view: true, issue: false, cancel: false, adjust: false },
      };
      await Promise.all([
        setDoc(doc(db, "users/cash-operator"), {
          active: true,
          isDefaultAdmin: false,
          permissions: financialPermissions,
          unitAccessScope: "linked",
          unitIds: ["tirirical"],
          assignedKioskIds: [],
          unitAccessUnitIds: [],
        }),
        setDoc(doc(db, "users/other-unit"), {
          active: true,
          isDefaultAdmin: false,
          permissions: financialPermissions,
          unitAccessScope: "linked",
          unitIds: ["joao-paulo"],
          assignedKioskIds: [],
          unitAccessUnitIds: [],
        }),
        setDoc(doc(db, "cashClosures/tirirical_2026-07-07"), {
          kioskId: "tirirical",
          status: "draft",
          expectedTotalCents: 10000,
        }),
        setDoc(doc(db, "cashClosures/tirirical_2026-07-07/lines/10_cash"), {
          kioskId: "tirirical",
          expectedCents: 10000,
          countedCents: null,
          note: null,
          status: "pending",
          differenceCents: null,
        }),
        setDoc(doc(db, "cashClosures/tirirical_2026-07-06"), {
          kioskId: "tirirical",
          status: "approved",
          expectedTotalCents: 10000,
        }),
        setDoc(doc(db, "cashClosures/tirirical_2026-07-06/lines/10_cash"), {
          kioskId: "tirirical",
          expectedCents: 10000,
          countedCents: 10000,
          note: null,
          status: "matched",
          differenceCents: 0,
        }),
        setDoc(doc(db, "cashDepositBatches/batch-1"), {
          kioskId: "tirirical",
          status: "open",
          totalCents: 10000,
        }),
      ]);
    });

    const operator = env.authenticatedContext("cash-operator");
    const outsider = env.authenticatedContext("other-unit");
    await assertSucceeds(getDoc(doc(operator.firestore(), "cashClosures/tirirical_2026-07-07")));
    await assertFails(getDoc(doc(outsider.firestore(), "cashClosures/tirirical_2026-07-07")));
    await assertFails(updateDoc(doc(operator.firestore(), "cashClosures/tirirical_2026-07-07/lines/10_cash"), {
      countedCents: 9900,
      note: "Falta conferida",
    }));
    await assertFails(updateDoc(doc(operator.firestore(), "cashClosures/tirirical_2026-07-07/lines/10_cash"), {
      expectedCents: 1,
    }));
    await assertFails(updateDoc(doc(operator.firestore(), "cashClosures/tirirical_2026-07-07"), {
      status: "approved",
    }));
    await assertFails(updateDoc(doc(operator.firestore(), "cashClosures/tirirical_2026-07-06/lines/10_cash"), {
      countedCents: 1,
    }));
    await assertSucceeds(getDoc(doc(operator.firestore(), "cashDepositBatches/batch-1")));
    await assertFails(updateDoc(doc(operator.firestore(), "cashDepositBatches/batch-1"), {
      status: "paid",
    }));
    await assertFails(setDoc(doc(operator.firestore(), "interCobrancas/forged"), {
      statusInterno: "paid",
    }));
    await assertFails(setDoc(doc(operator.firestore(), "interCobrancaEvents/forged"), {
      kind: "webhook",
    }));
    await assertFails(setDoc(doc(operator.firestore(), "interWebhookRawEvents/forged"), {
      rawBody: "[]",
    }));
    await assertFails(setDoc(doc(operator.firestore(), "cashDepositReconciliationRuns/forged"), {
      status: "success",
    }));
    await assertFails(setDoc(doc(operator.firestore(), "cashCoinBalances/forged"), {
      kioskId: "tirirical",
      pendingExchangeCents: 100,
    }));
    await assertFails(setDoc(doc(operator.firestore(), "cashCoinEvents/forged"), {
      kioskId: "tirirical",
      amountCents: 100,
    }));
  } finally {
    await env.cleanup();
  }
});

test("RH isola unidades, auditoria e recrutamento direto", async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-security-rh",
    firestore: { rules: rules.rh },
  });

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, "rh_access_cache/manager"), {
          rh_role: "manager",
          unit_id: "unit-a",
          bizneo_employee_id: "employee-a",
          profile_compliance_status: "complete",
          profile_compliance_policy_version: 1,
          profile_compliance_next_review_at: new Date("2000-01-01T00:00:00.000Z"),
        }),
        setDoc(doc(db, "rh_access_cache/pending-manager"), {
          rh_role: "manager",
          unit_id: "unit-a",
          bizneo_employee_id: "employee-a",
          profile_compliance_status: "pending",
          profile_compliance_policy_version: 1,
          profile_compliance_next_review_at: new Date("2099-01-01T00:00:00.000Z"),
        }),
        setDoc(doc(db, "employees/employee-a"), { unit_id: "unit-a" }),
        setDoc(doc(db, "employees/employee-b"), { unit_id: "unit-b" }),
        setDoc(doc(db, "audit_log/a"), { employee_id: "employee-a" }),
        setDoc(doc(db, "audit_log/b"), { employee_id: "employee-b" }),
        setDoc(doc(db, "candidates/candidate-1"), { email: "candidate@example.com" }),
        setDoc(doc(db, "jobOpenings/paused"), { status: "paused" }),
      ]);
    });

    const manager = env.authenticatedContext("manager");
    const pendingManager = env.authenticatedContext("pending-manager");
    const anonymous = env.unauthenticatedContext();
    await assertSucceeds(getDoc(doc(manager.firestore(), "employees/employee-a")));
    await assertFails(getDoc(doc(manager.firestore(), "employees/employee-b")));
    await assertSucceeds(getDoc(doc(manager.firestore(), "audit_log/a")));
    await assertFails(getDoc(doc(manager.firestore(), "audit_log/b")));
    await assertFails(getDoc(doc(pendingManager.firestore(), "employees/employee-a")));
    await assertFails(getDoc(doc(pendingManager.firestore(), "audit_log/a")));
    await assertFails(getDoc(doc(manager.firestore(), "candidates/candidate-1")));
    await assertFails(getDoc(doc(anonymous.firestore(), "jobOpenings/paused")));
  } finally {
    await env.cleanup();
  }
});
