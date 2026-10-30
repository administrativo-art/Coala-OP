import { NextRequest, NextResponse } from "next/server";

import { purchaseAcquisitionRelationError } from "@/features/assets/purchase-acquisition";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

type RouteContext = { params: Promise<{ assetId: string }> };
type Resource = { id: string; workspaceId: string; data: Record<string, any> };

const contract = defineSecurityContract({
  schemaVersion: 1, id: "assets.acquisition.get", version: 1,
  surface: { method: "GET", path: "/api/assets/[assetId]/acquisition" },
  exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "assets.view+stock.purchasing.view" }, resourceScope: { kind: "workspace" },
  input: { kind: "none" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized",
});

const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, undefined, Resource>(contract, {
  authenticate: ({ request }) => requireUser(request),
  async loadResource({ routeContext }) {
    const id = (await routeContext.params).assetId;
    const snapshot = await dbAdmin.collection("assets").doc(id).get();
    if (!snapshot.exists) throw new AppError({ code: "ASSET_NOT_FOUND", kind: "NOT_FOUND" });
    return { id, workspaceId: String(snapshot.get("workspaceId")), data: snapshot.data() ?? {} };
  },
  authorize: ({ actor }) => {
    if (!actor.permissions.assets?.view || !actor.permissions.stock?.purchasing?.view) throw new AppError({ code: "ASSET_ACQUISITION_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para consultar os dados comerciais da aquisição." });
  },
  assertScope: ({ actor, resource }) => {
    if (actor.workspace_id !== resource.workspaceId) throw new AppError({ code: "ASSET_SCOPE_FORBIDDEN", kind: "AUTHORIZATION" });
  },
});

const pick = (value: Record<string, any> | undefined, keys: string[]) => Object.fromEntries(keys.map((key) => [key, value?.[key] ?? null]));

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const asset = security.resource.data;
  if (asset.sourceType !== "purchase_receipt") {
    return NextResponse.json({ readOnly: true, sourceType: asset.sourceType ?? null, order: null, receipt: null, item: null });
  }
  const purchaseOrderId = String(asset.purchaseOrderId ?? "");
  const purchaseReceiptId = String(asset.purchaseReceiptId ?? "");
  const purchaseReceiptItemId = String(asset.purchaseReceiptItemId ?? "");
  if (!purchaseOrderId || !purchaseReceiptId || !purchaseReceiptItemId) {
    throw new AppError({ code: "PURCHASE_ACQUISITION_RELATION", kind: "VALIDATION", safeMessage: "O vínculo de aquisição do patrimônio está incompleto." });
  }
  const orderReference = dbAdmin.collection("purchase_orders").doc(purchaseOrderId);
  const receiptReference = dbAdmin.collection("purchase_receipts").doc(purchaseReceiptId);
  const receiptItemReference = receiptReference.collection("items").doc(purchaseReceiptItemId);
  const [orderSnapshot, receiptSnapshot, itemSnapshot] = await Promise.all([
    orderReference.get(), receiptReference.get(), receiptItemReference.get(),
  ]);
  const orderItemId = String(itemSnapshot.get("purchaseOrderItemId") ?? "");
  const orderItemSnapshot = orderItemId ? await orderReference.collection("items").doc(orderItemId).get() : null;
  const relationError = purchaseAcquisitionRelationError({
    workspaceId: security.actor.workspace_id, purchaseOrderId, purchaseReceiptId, purchaseReceiptItemId,
  }, {
    orderExists: orderSnapshot.exists,
    orderWorkspaceId: orderSnapshot.get("workspaceId"),
    receiptExists: receiptSnapshot.exists,
    receiptWorkspaceId: receiptSnapshot.get("workspaceId"),
    receiptPurchaseOrderId: receiptSnapshot.get("purchaseOrderId"),
    receiptItemExists: itemSnapshot.exists,
    receiptItemPurchaseReceiptId: itemSnapshot.get("purchaseReceiptId"),
    receiptItemPurchaseOrderItemId: itemSnapshot.get("purchaseOrderItemId"),
    orderItemExists: orderItemSnapshot?.exists ?? false,
    orderItemId,
  });
  if (relationError) throw new AppError({
    code: relationError,
    kind: relationError === "PURCHASE_ACQUISITION_SCOPE" ? "AUTHORIZATION" : relationError === "PURCHASE_ACQUISITION_NOT_FOUND" ? "NOT_FOUND" : "VALIDATION",
    safeMessage: "O vínculo entre pedido, recebimento e item da compra é inválido.",
  });
  return NextResponse.json({
    readOnly: true,
    sourceType: "purchase_receipt",
    order: { id: orderSnapshot.id, ...pick(orderSnapshot.data(), ["number", "supplierName", "status", "total", "currency", "createdAt", "approvedAt"]) },
    receipt: { id: receiptSnapshot.id, ...pick(receiptSnapshot.data(), ["number", "status", "receivedAt", "receivedByName", "invoiceNumber", "invoiceDate"]) },
    item: { id: itemSnapshot.id, ...pick(itemSnapshot.data(), ["itemName", "description", "quantityOrdered", "quantityReceived", "unitPriceOrdered", "unitPriceConfirmed", "totalConfirmed", "brand", "model", "warrantyEndsAt"]) },
  }, { headers: { "Cache-Control": "private, no-store" } });
});
