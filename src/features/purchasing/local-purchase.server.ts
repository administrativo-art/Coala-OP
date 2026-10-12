import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { canAccessUnit } from "@/lib/unit-access";
import { financialExpenseAccountingFields } from "@/features/financial/lib/expense-accounting-contract";
import { mobileInboxDocumentId } from "@/features/financial/inbox/mobile-upload";
import { cashClosureId } from "@/features/financial/cash-closures/persistence";
import { autoLinkAppPreLinks, LOCAL_PURCHASE_WITHDRAWAL_LINKS, readClassificationCatalog } from "@/features/financial/cash-closures/withdrawal-classification.server";
import { FINANCIAL_COLLECTIONS } from "@/features/financial/lib/constants";
import type { BaseProduct, Product } from "@/types";
import { buildLocalPurchaseStockLine, type LocalPurchaseStockLine } from "./local-purchase-stock";
import { applyLocalPurchaseStockEntry, rememberLocalPurchaseItemLinks } from "./local-purchase-stock.server";
import { resolveLocalPurchaseWithdrawal } from "./local-purchase-withdrawals.server";
import { confirmLocalPurchaseSchema, linkLocalPurchaseWithdrawalSchema, localPurchaseExpenseId } from "./local-purchase";

function failure(code: string, safeMessage: string, kind: "VALIDATION" | "AUTHORIZATION" | "NOT_FOUND" | "CONFLICT" = "VALIDATION"): never {
  throw new AppError({ code: `LOCAL_PURCHASE_${code}`, kind, safeMessage });
}

/**
 * Tenta conciliar na hora: se o caixa daquele dia já foi sincronizado, a sangria vira o pagamento
 * da compra agora; senão fica pré-vinculada e é conciliada quando o dia for sincronizado.
 */
async function reconcileNow(purchaseId: string, unitId: string, withdrawalDate: string, actor: ServerUserContext) {
  await autoLinkAppPreLinks(cashClosureId(unitId, withdrawalDate), actor).catch(() => undefined);
  const refreshed = await financialDbAdmin.collection("localPurchases").doc(purchaseId).get();
  return String(refreshed.get("status"));
}

/** Liga a uma sangria do PDV uma compra em dinheiro que foi registrada antes de a sangria aparecer. */
export async function linkLocalPurchaseToWithdrawal(raw: unknown, actor: ServerUserContext) {
  const parsed = linkLocalPurchaseWithdrawalSchema.safeParse(raw);
  if (!parsed.success) failure("INPUT_INVALID", parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const input = parsed.data;
  if (!actor.isDefaultAdmin && actor.permissions.app?.localPurchase?.register !== true) {
    failure("FORBIDDEN", "Sua conta não possui permissão para registrar compras locais.", "AUTHORIZATION");
  }
  const purchaseRef = financialDbAdmin.collection("localPurchases").doc(input.purchaseId);
  const purchase = await purchaseRef.get();
  const unitId = String(purchase.get("unitId") ?? "");
  if (!purchase.exists || purchase.get("workspaceId") !== actor.workspace_id
    || !canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
    failure("NOT_FOUND", "Compra não encontrada.", "NOT_FOUND");
  }
  const withdrawal = await resolveLocalPurchaseWithdrawal({ workspaceId: actor.workspace_id, unitId, ...input.withdrawal });
  const linkRef = financialDbAdmin.collection(LOCAL_PURCHASE_WITHDRAWAL_LINKS).doc(withdrawal.sourceId);
  const expenseRef = financialDbAdmin.collection("expenses").doc(input.purchaseId);
  const now = new Date().toISOString();
  await financialDbAdmin.runTransaction(async (transaction) => {
    const [current, link, claim, expense] = await Promise.all([
      transaction.get(purchaseRef), transaction.get(linkRef),
      transaction.get(financialDbAdmin.collection(FINANCIAL_COLLECTIONS.sourceSettlements).doc(withdrawal.sourceId)),
      transaction.get(expenseRef),
    ]);
    if (current.get("withdrawalPreLink.sourceId") === withdrawal.sourceId) return;
    if (current.get("status") !== "awaiting_cash_withdrawal" || current.get("fundingSource") !== "cash_withdrawal" || current.get("withdrawalPreLink")
      || !expense.exists || expense.get("status") !== "pending") {
      failure("LINK_UNAVAILABLE", "Esta compra não está mais aguardando sangria.", "CONFLICT");
    }
    if (link.exists || claim.get("active") === true) {
      failure("WITHDRAWAL_ALREADY_LINKED", "Esta sangria já recebeu uma nota ou foi classificada no fechamento. Atualize a lista.", "CONFLICT");
    }
    const totalCents = Number(current.get("totalCents"));
    if (totalCents > withdrawal.amountCents) failure("WITHDRAWAL_AMOUNT_EXCEEDED", "O total da nota é maior que o valor da sangria escolhida.", "CONFLICT");
    transaction.update(purchaseRef, {
      withdrawalPreLink: { ...withdrawal, changeCents: withdrawal.amountCents - totalCents, linkedAt: now, linkedBy: actor.userDoc.id },
      updatedAt: now,
    });
    transaction.update(expenseRef, { localPurchaseWithdrawalSourceId: withdrawal.sourceId, updatedAt: Timestamp.now() });
    transaction.create(linkRef, {
      sourceId: withdrawal.sourceId, workspaceId: actor.workspace_id, unitId, purchaseId: input.purchaseId,
      supplierName: String(current.get("supplierName") ?? ""), resultCenterId: String(current.get("resultCenterId") ?? ""),
      totalCents, withdrawalAmountCents: withdrawal.amountCents, withdrawalDate: withdrawal.date,
      createdBy: actor.userDoc.id, createdAt: now,
    });
    transaction.create(purchaseRef.collection("events").doc(), {
      type: "LOCAL_PURCHASE_WITHDRAWAL_LINKED", at: now, actorId: actor.userDoc.id, withdrawalSourceId: withdrawal.sourceId,
    });
  });
  const status = await reconcileNow(input.purchaseId, unitId, withdrawal.date, actor);
  return { id: input.purchaseId, status, changeCents: withdrawal.amountCents - Number(purchase.get("totalCents")) };
}

export async function confirmLocalPurchase(raw: unknown, actor: ServerUserContext) {
  const parsed = confirmLocalPurchaseSchema.safeParse(raw);
  if (!parsed.success) failure("INPUT_INVALID", parsed.error.issues[0]?.message ?? "Dados da compra inválidos.");
  const input = parsed.data;
  if (!actor.isDefaultAdmin && actor.permissions.app?.localPurchase?.register !== true) {
    failure("FORBIDDEN", "Sua conta não possui permissão para registrar compras locais.", "AUTHORIZATION");
  }
  if (!canAccessUnit(actor.userDoc, input.unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
    failure("UNIT_FORBIDDEN", "A unidade não está no escopo da sua conta.", "AUTHORIZATION");
  }
  const [unit, sourceMessage] = await Promise.all([
    dbAdmin.collection("kiosks").doc(input.unitId).get(),
    financialDbAdmin.collection("financialInboxMessages").doc(mobileInboxDocumentId(actor.workspace_id, input.submissionId)).get(),
  ]);
  if (!unit.exists) failure("UNIT_NOT_FOUND", "Unidade não encontrada.", "NOT_FOUND");
  if (!sourceMessage.exists || sourceMessage.get("workspaceId") !== actor.workspace_id || sourceMessage.get("provider") !== "mobile") {
    failure("DOCUMENT_NOT_FOUND", "Envio da nota não encontrado.", "NOT_FOUND");
  }
  if (!actor.isDefaultAdmin && sourceMessage.get("submittedBy.userId") !== actor.userDoc.id) {
    failure("DOCUMENT_FORBIDDEN", "O envio pertence a outro usuário.", "AUTHORIZATION");
  }
  const uploadedFundingSource = sourceMessage.get("mobilePurchaseFundingSource");
  if (uploadedFundingSource !== input.fundingSource) {
    failure("FUNDING_SOURCE_MISMATCH", "A origem do pagamento não corresponde aos documentos enviados.", "CONFLICT");
  }
  const uploadedAttachments = sourceMessage.get("attachments");
  const hasPaymentProof = Array.isArray(uploadedAttachments)
    && uploadedAttachments.some((attachment) => String(attachment?.filename ?? "").startsWith("payment-proof-"));
  if (input.fundingSource === "company_payment" && !hasPaymentProof) {
    failure("PAYMENT_PROOF_REQUIRED", "A compra normal exige comprovante de pagamento.", "CONFLICT");
  }
  if (input.fundingSource === "cash_withdrawal" && hasPaymentProof) {
    failure("PAYMENT_PROOF_UNEXPECTED", "Compra por sangria não aceita comprovante de pagamento.", "CONFLICT");
  }

  const purchaseId = localPurchaseExpenseId(actor.workspace_id, input.submissionId);
  const unitName = String(unit.get("name") || unit.get("displayName") || input.unitId);
  const actorName = String(actor.userDoc.username || actor.decoded.email || "Coala Notas");
  // The product registration decides what enters stock; every line is priced and converted before anything is written.
  const stockLines: LocalPurchaseStockLine[] = [];
  if (input.items.some((item) => item.stock) && !actor.isDefaultAdmin && actor.permissions.app?.localPurchase?.stockEntry !== true) {
    failure("STOCK_FORBIDDEN", "Sua conta não possui permissão para dar entrada em estoque pelo aplicativo.", "AUTHORIZATION");
  }
  for (const [itemIndex, item] of input.items.entries()) {
    if (!item.stock) continue;
    const productSnapshot = await dbAdmin.collection("products").doc(item.stock.productId).get();
    const product = productSnapshot.data() as Product | undefined;
    const baseSnapshot = product?.baseProductId ? await dbAdmin.collection("baseProducts").doc(product.baseProductId).get() : null;
    if (!product || !baseSnapshot?.exists) failure("STOCK_PRODUCT_INVALID", `Produto de estoque não encontrado para "${item.description}".`);
    const built = buildLocalPurchaseStockLine({
      itemIndex, productId: productSnapshot.id, product: product!, baseProduct: baseSnapshot!.data() as BaseProduct,
      quantity: item.stock.quantity, totalCents: item.totalCents, expiryDate: item.stock.expiryDate, purchaseDate: input.purchaseDate,
    });
    if (!built.ok) failure("STOCK_LINE_INVALID", `${item.description}: ${built.error}`);
    else stockLines.push(built.line);
  }
  const applyStockEntry = (lines: LocalPurchaseStockLine[]) => applyLocalPurchaseStockEntry({
    purchaseId, unitId: input.unitId, unitName, supplierName: input.supplierName, lines, actorId: actor.userDoc.id, actorName,
  }).then(() => financialDbAdmin.collection("localPurchases").doc(purchaseId).set({ stockEntryStatus: "done", updatedAt: new Date().toISOString() }, { merge: true }));
  // Pré-vínculo: o operador aponta a sangria; a baixa financeira continua exclusiva do fechamento de caixa.
  const withdrawal = input.withdrawal
    ? await resolveLocalPurchaseWithdrawal({ workspaceId: actor.workspace_id, unitId: input.unitId, ...input.withdrawal })
    : null;
  if (withdrawal && input.totalCents > withdrawal.amountCents) {
    failure("WITHDRAWAL_AMOUNT_EXCEEDED", "O total da nota é maior que o valor da sangria escolhida.", "CONFLICT");
  }
  const withdrawalLinkRef = withdrawal ? financialDbAdmin.collection(LOCAL_PURCHASE_WITHDRAWAL_LINKS).doc(withdrawal.sourceId) : null;
  const purchaseRef = financialDbAdmin.collection("localPurchases").doc(purchaseId);
  const expenseRef = financialDbAdmin.collection("expenses").doc(purchaseId);
  const messageRef = sourceMessage.ref;
  const now = new Date().toISOString();
  const date = Timestamp.fromDate(new Date(`${input.purchaseDate}T12:00:00.000Z`));

  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const existing = await transaction.get(purchaseRef);
    if (existing.exists) {
      if (existing.get("submissionId") !== input.submissionId) failure("ID_COLLISION", "Identificador de compra em conflito.", "CONFLICT");
      // A retry finishes the stock entry of the purchase as it was confirmed, never of the new payload.
      const pending = existing.get("stockEntryStatus") === "pending" ? existing.get("stockLines") as LocalPurchaseStockLine[] : [];
      return { id: purchaseId, status: String(existing.get("status")), duplicate: true, pendingStockLines: pending,
        storedStockEntry: existing.get("stockEntryStatus") === "done" ? "done" as const : "not_needed" as const };
    }

    if (withdrawal && withdrawalLinkRef) {
      const [link, claim] = await Promise.all([
        transaction.get(withdrawalLinkRef),
        transaction.get(financialDbAdmin.collection(FINANCIAL_COLLECTIONS.sourceSettlements).doc(withdrawal.sourceId)),
      ]);
      if (link.exists || claim.get("active") === true) {
        failure("WITHDRAWAL_ALREADY_LINKED", "Esta sangria já recebeu uma nota ou foi classificada no fechamento. Atualize a lista.", "CONFLICT");
      }
    }

    const catalog = await readClassificationCatalog(transaction, {
      workspaceId: actor.workspace_id,
      unitId: input.unitId,
    }, input.accountPlanId, input.resultCenterId);

    const status = input.fundingSource === "cash_withdrawal"
      ? "awaiting_cash_withdrawal"
      : "awaiting_company_payment";
    transaction.create(purchaseRef, {
      id: purchaseId,
      workspaceId: actor.workspace_id,
      submissionId: input.submissionId,
      sourceMessageId: messageRef.id,
      unitId: input.unitId,
      unitName,
      supplierName: input.supplierName,
      stockLines,
      stockEntryStatus: stockLines.length ? "pending" : "not_needed",
      supplierTaxId: input.supplierTaxId ?? null,
      purchaseDate: input.purchaseDate,
      competenceMonth: input.purchaseDate.slice(0, 7),
      totalCents: input.totalCents,
      fundingSource: input.fundingSource,
      companyPaymentMethod: input.companyPaymentMethod,
      accountPlanId: catalog.accountPlanId,
      accountPlanName: catalog.accountPlanName,
      resultCenterId: catalog.resultCenterId,
      resultCenterName: catalog.resultCenterName,
      items: input.items,
      note: input.note ?? "",
      ...(withdrawal ? { withdrawalPreLink: {
        ...withdrawal,
        // Troco que precisa voltar ao caixa; a forma de registrar essa devolução ainda será definida.
        changeCents: withdrawal.amountCents - input.totalCents,
        linkedAt: now,
        linkedBy: actor.userDoc.id,
      } } : {}),
      status,
      createdBy: actor.userDoc.id,
      createdAt: now,
      updatedAt: now,
    });
    transaction.create(expenseRef, {
        workspaceId: actor.workspace_id,
        kioskId: input.unitId,
        unitId: input.unitId,
        description: `Compra local · ${input.supplierName}`,
        supplier: input.supplierName,
        totalValue: input.totalCents / 100,
        competenceDate: date,
        dueDate: date,
        ...financialExpenseAccountingFields({ competenceMonth: input.purchaseDate.slice(0, 7) }),
        accountPlan: catalog.accountPlanId,
        accountId: catalog.accountPlanId,
        accountPlanName: catalog.accountPlanName,
        resultCenter: catalog.resultCenterName,
        resultCenterId: catalog.resultCenterId,
        resultCenterName: catalog.resultCenterName,
        referenceResultCenterId: catalog.resultCenterId,
        referenceResultCenterName: catalog.resultCenterName,
        status: "pending",
        paymentState: "open",
        paymentMethod: "single",
        plannedPaymentMethodType: input.fundingSource === "cash_withdrawal" ? "cash" : input.companyPaymentMethod,
        plannedPaymentMethodLabel: input.fundingSource === "cash_withdrawal"
          ? "Dinheiro — aguardando sangria do PDV"
          : `Compra normal — ${input.companyPaymentMethod}`,
        isApportioned: false,
        hasAccountAllocations: false,
        hasPersonAllocations: false,
        originModule: "local_purchase",
        originStatus: status,
        localPurchaseId: purchaseId,
        localPurchaseDate: input.purchaseDate,
        localPurchaseFundingSource: input.fundingSource,
        ...(withdrawal ? { localPurchaseWithdrawalSourceId: withdrawal.sourceId } : {}),
        hiddenFromExpensePanel: input.fundingSource === "cash_withdrawal",
        createdBy: actor.userDoc.id,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    if (withdrawal && withdrawalLinkRef) {
      // One purchase per sangria: `create` fails if another phone confirmed first.
      transaction.create(withdrawalLinkRef, {
        sourceId: withdrawal.sourceId,
        workspaceId: actor.workspace_id,
        unitId: input.unitId,
        purchaseId,
        supplierName: input.supplierName,
        resultCenterId: catalog.resultCenterId,
        totalCents: input.totalCents,
        withdrawalAmountCents: withdrawal.amountCents,
        withdrawalDate: withdrawal.date,
        createdBy: actor.userDoc.id,
        createdAt: now,
      });
    }
    transaction.set(messageRef, {
      localPurchaseId: purchaseId,
      localPurchaseStatus: status,
      updatedAt: now,
    }, { merge: true });
    transaction.create(purchaseRef.collection("events").doc(), {
      type: "LOCAL_PURCHASE_CONFIRMED",
      at: now,
      actorId: actor.userDoc.id,
      fundingSource: input.fundingSource,
      withdrawalSourceId: withdrawal?.sourceId ?? null,
    });
    return { id: purchaseId, status, duplicate: false, pendingStockLines: stockLines, storedStockEntry: "not_needed" as const };
  });

  const { pendingStockLines, storedStockEntry, ...purchase } = result;
  // Stock is in another database: a failure here leaves the purchase `pending` and the next retry completes it.
  const stockEntry = !pendingStockLines.length ? storedStockEntry
    : await applyStockEntry(pendingStockLines).then(() => "done" as const).catch(() => "pending" as const);
  if (!result.duplicate) {
    await rememberLocalPurchaseItemLinks(
      { workspaceId: actor.workspace_id, supplierTaxId: input.supplierTaxId, supplierName: input.supplierName },
      input.items.flatMap((item) => item.stock ? [{ description: item.description, productId: item.stock.productId }] : []),
      actor.userDoc.id,
    ).catch(() => undefined);
  }
  const status = withdrawal && purchase.status === "awaiting_cash_withdrawal"
    ? await reconcileNow(purchaseId, input.unitId, withdrawal.date, actor)
    : purchase.status;
  return { ...purchase, status, stockEntry, stockItemCount: pendingStockLines.length };
}
