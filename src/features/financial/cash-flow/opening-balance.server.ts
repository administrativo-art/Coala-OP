import "server-only";

import { randomUUID } from "node:crypto";
import { FieldPath, Timestamp } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { serializeFinancialValue } from "@/features/financial/lib/server-access";
import type { ConfirmedBankBalanceInput } from "./opening-balance";

export class ConfirmedBankBalanceError extends Error {
  constructor(readonly code: "NOT_FOUND" | "WORKSPACE_MISMATCH" | "INACTIVE_ACCOUNT" | "LIMIT") {
    super(code === "NOT_FOUND"
      ? "A conta bancária não foi encontrada."
      : code === "INACTIVE_ACCOUNT" ? "Não é possível confirmar saldo de uma conta inativa."
        : code === "LIMIT" ? "O workspace ultrapassou o limite de 50 saldos de conta."
          : "A conta não pertence ao workspace atual.");
    this.name = "ConfirmedBankBalanceError";
  }
}

export async function confirmBankAccountBalance(input: {
  workspaceId: string;
  accountId: string;
  balance: ConfirmedBankBalanceInput;
  actor: { id: string; name: string | null; email: string | null };
}) {
  const accountRef = financialDbAdmin.collection("bankAccounts").doc(input.accountId);
  const balanceRef = financialDbAdmin.collection("bankAccountBalances").doc(input.accountId);
  return serializeFinancialValue(await financialDbAdmin.runTransaction(async (transaction) => {
    const [accountSnapshot, balanceSnapshot] = await Promise.all([
      transaction.get(accountRef),
      transaction.get(balanceRef),
    ]);
    if (!accountSnapshot.exists) throw new ConfirmedBankBalanceError("NOT_FOUND");
    const account = accountSnapshot.data() ?? {};
    if (account.workspaceId !== undefined && account.workspaceId !== input.workspaceId) {
      throw new ConfirmedBankBalanceError("WORKSPACE_MISMATCH");
    }
    if (account.active === false) throw new ConfirmedBankBalanceError("INACTIVE_ACCOUNT");
    if (balanceSnapshot.exists && balanceSnapshot.data()?.workspaceId !== input.workspaceId) {
      throw new ConfirmedBankBalanceError("WORKSPACE_MISMATCH");
    }
    const now = Timestamp.now();
    const confirmation = {
      balanceCents: input.balance.balanceCents,
      confirmedAt: Timestamp.fromDate(new Date(input.balance.confirmedAt)),
      source: input.balance.source,
      reason: input.balance.reason,
      actor: input.actor,
      recordedAt: now,
    };
    transaction.set(balanceRef, {
      accountId: input.accountId,
      accountName: String(account.name || input.accountId),
      workspaceId: input.workspaceId,
      confirmedBalanceCents: confirmation.balanceCents,
      balanceConfirmedAt: confirmation.confirmedAt,
      balanceSource: confirmation.source,
      balanceConfirmationReason: confirmation.reason,
      balanceConfirmedBy: input.actor,
      balanceConfirmationRecordedAt: now,
      createdAt: balanceSnapshot.data()?.createdAt ?? now,
      updatedAt: now,
    });
    transaction.set(balanceRef.collection("events").doc(randomUUID()), confirmation);
    return { accountId: input.accountId, ...confirmation };
  }));
}

export async function listConfirmedBankBalances(workspaceId: string) {
  const snapshot = await financialDbAdmin.collection("bankAccountBalances")
    .where("workspaceId", "==", workspaceId)
    .orderBy(FieldPath.documentId())
    .limit(51)
    .get();
  if (snapshot.size > 50) throw new ConfirmedBankBalanceError("LIMIT");
  return serializeFinancialValue({
    balances: snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
    stats: { balanceDocuments: snapshot.size },
  });
}
