import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { companyCustody, companyOwner, normalizedAssetLifecycle, unitLocation } from "@/features/assets/lifecycle";
import { purchaseAcquisitionRelationError } from "@/features/assets/purchase-acquisition";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { WORKSPACE_ID } from "@/lib/workspace";
import type { Asset, AssetStatus } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type StaticRouteContext = { params: Promise<Record<string, never>> };
type WorkspaceResource = { workspaceId: string };

const optionalText = z.string().trim().max(4000).optional();
const createInputSchema = z.object({
  code: z.string().trim().max(40).optional(), name: z.string().trim().min(1).max(240),
  currentKioskId: z.string().trim().min(1).max(160), currentKioskName: z.string().trim().max(240).optional(),
  category: optionalText, subcategory: optionalText, brand: optionalText, model: optionalText, serialNumber: optionalText,
  assetTag: optionalText, description: optionalText, department: optionalText, exactLocation: optionalText,
  inUse: z.boolean().optional(), possessionStatus: optionalText,
  status: z.enum(["ativo", "em_manutencao", "fora_de_uso", "extraviado", "vendido", "descartado", "baixado"]).optional(),
  purchaseDate: optionalText, purchaseValue: z.coerce.number().finite().nonnegative().optional(), supplierId: optionalText,
  supplierName: optionalText, invoiceNumber: optionalText, paymentMethod: optionalText, costCenter: optionalText,
  accountingAccount: optionalText, documentUrl: optionalText, usefulLifeYears: z.coerce.number().finite().nonnegative().optional(),
  residualValue: z.coerce.number().finite().optional(), depreciationMethod: optionalText,
  accumulatedDepreciation: z.coerce.number().finite().optional(), bookValue: z.coerce.number().finite().optional(),
  marketValue: z.coerce.number().finite().optional(), conservationState: optionalText, operationalCondition: optionalText,
  conditionNotes: optionalText, lastInspectionDate: optionalText, inspectedBy: optionalText, nextInspectionDate: optionalText,
  hasWarranty: z.boolean().optional(), warrantyEndsAt: optionalText, serviceCompany: optionalText, serviceContact: optionalText,
  maintenanceFrequency: optionalText, lastMaintenanceDate: optionalText, nextMaintenanceDate: optionalText,
  maintenanceCostTotal: z.coerce.number().finite().optional(), imageUrl: optionalText, notes: optionalText,
  sourceType: z.enum(["manual", "purchase_receipt"]).optional(), purchaseOrderId: optionalText,
  purchaseReceiptId: optionalText, purchaseReceiptItemId: optionalText,
}).strict().superRefine((input, context) => {
  if (input.sourceType === "purchase_receipt") {
    for (const field of ["purchaseOrderId", "purchaseReceiptId", "purchaseReceiptItemId"] as const) {
      if (!input[field]) context.addIssue({ code: "custom", path: [field], message: "Pedido, recebimento e item são obrigatórios para patrimônio vinculado." });
    }
  } else if (input.purchaseOrderId || input.purchaseReceiptId || input.purchaseReceiptItemId) {
    context.addIssue({ code: "custom", path: ["sourceType"], message: "Referências de compra só são aceitas quando a origem é um recebimento." });
  }
});

function normalizeAssetCodeInput(value: unknown) {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.startsWith("PEND-")) return raw;
  const patMatch = raw.match(/^PAT[-_]?(\d+)$/);
  if (patMatch) return `PAT-${String(Number(patMatch[1])).padStart(6, "0")}`;
  const digits = raw.replace(/\D/g, "");
  return digits ? `PAT-${String(Number(digits)).padStart(6, "0")}` : raw;
}

async function assertGeneratedAssetCode(code: string) {
  const match = code.match(/^PAT-(\d+)$/);
  if (!match || Number(match[1]) < 1) throw new AppError({ code: "ASSET_CODE_INVALID", kind: "VALIDATION", safeMessage: "Código patrimonial inválido. Use o formato PAT-000001." });
  const settingsSnapshot = await dbAdmin.collection("assetSettings").doc("barcode-labels").get();
  const settings = settingsSnapshot.data() ?? {};
  const generatedUntil = Math.max(1000, settings.workspaceId === WORKSPACE_ID ? Number(settings.generatedUntil ?? 0) || 0 : 0);
  if (Number(match[1]) > generatedUntil) throw new AppError({ code: "ASSET_CODE_NOT_GENERATED", kind: "VALIDATION", safeMessage: `A etiqueta ${code} ainda não foi gerada.` });
}

const getContract = defineSecurityContract({ schemaVersion: 1, id: "assets.list", version: 1, surface: { method: "GET", path: "/api/assets" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "assets.view" }, resourceScope: { kind: "workspace" }, input: { kind: "none" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const postContract = defineSecurityContract({ schemaVersion: 1, id: "assets.create", version: 1, surface: { method: "POST", path: "/api/assets" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "assets.create" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "assets.create-input", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });

const getEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, undefined, WorkspaceResource>(getContract, {
  authenticate: ({ request }) => requireUser(request), loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id }),
  authorize: ({ actor }) => { if (!actor.permissions.assets?.view) throw new AppError({ code: "ASSET_VIEW_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para visualizar patrimônio." }); },
  assertScope: ({ actor, resource }) => { if (resource.workspaceId !== actor.workspace_id) throw new AppError({ code: "ASSET_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" }); },
});
const postEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, z.infer<typeof createInputSchema>, WorkspaceResource>(postContract, {
  authenticate: ({ request }) => requireUser(request),
  async parseInput({ request }) { const parsed = createInputSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) throw new AppError({ code: "ASSET_CREATE_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message || "Cadastro de patrimônio inválido." }); return parsed.data; },
  loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id }),
  authorize: ({ actor }) => { if (!actor.permissions.assets?.create) throw new AppError({ code: "ASSET_CREATE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para criar patrimônio." }); },
  assertScope: ({ actor, resource }) => { if (resource.workspaceId !== actor.workspace_id) throw new AppError({ code: "ASSET_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" }); },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => {
  const snapshot = await dbAdmin.collection("assets").where("workspaceId", "==", security.resource.workspaceId).limit(500).get();
  return NextResponse.json(snapshot.docs.map((document) => {
    const raw = { id: document.id, ...document.data() } as Asset;
    return { ...raw, ...normalizedAssetLifecycle(raw) };
  }));
});

export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) => {
  const { actor, input } = security;
  const now = new Date().toISOString();
  const sourceType = input.sourceType ?? "manual";
  const requestedCode = normalizeAssetCodeInput(input.code);
  if (sourceType === "manual" && !requestedCode) throw new AppError({ code: "ASSET_CODE_REQUIRED", kind: "VALIDATION", safeMessage: "Informe ou escaneie o código da placa patrimonial antes de cadastrar." });
  if (requestedCode) await assertGeneratedAssetCode(requestedCode);
  const assetReference = dbAdmin.collection("assets").doc();
  const movementReference = dbAdmin.collection("assetMovements").doc();
  const code = requestedCode || `PEND-${assetReference.id.slice(0, 8).toUpperCase()}`;
  const plateStatus = requestedCode ? "vinculada" : "pendente";
  const owner = companyOwner();
  const custody = companyCustody(now, movementReference.id);
  const currentLocation = unitLocation({ unitId: input.currentKioskId, unitName: input.currentKioskName, details: input.exactLocation, at: now, sourceEventId: movementReference.id });
  const asset: Asset & { workspaceId: string } = {
    id: assetReference.id, workspaceId: actor.workspace_id, code, name: input.name,
    category: input.category, subcategory: input.subcategory, brand: input.brand, model: input.model,
    serialNumber: input.serialNumber, assetTag: input.assetTag, description: input.description,
    currentKioskId: input.currentKioskId, currentKioskName: input.currentKioskName, department: input.department,
    exactLocation: input.exactLocation, inUse: input.inUse ?? true, possessionStatus: input.possessionStatus,
    owner, ownershipRegime: "owned", custody, currentLocation, lifecycleVersion: 1,
    status: (input.status as AssetStatus) ?? "ativo", purchaseDate: input.purchaseDate, purchaseValue: input.purchaseValue,
    supplierId: input.supplierId, supplierName: input.supplierName, invoiceNumber: input.invoiceNumber,
    paymentMethod: input.paymentMethod, costCenter: input.costCenter, accountingAccount: input.accountingAccount,
    documentUrl: input.documentUrl, usefulLifeYears: input.usefulLifeYears, residualValue: input.residualValue,
    depreciationMethod: input.depreciationMethod, accumulatedDepreciation: input.accumulatedDepreciation,
    bookValue: input.bookValue, marketValue: input.marketValue, conservationState: input.conservationState,
    operationalCondition: input.operationalCondition, conditionNotes: input.conditionNotes,
    lastInspectionDate: input.lastInspectionDate, inspectedBy: input.inspectedBy, nextInspectionDate: input.nextInspectionDate,
    hasWarranty: input.hasWarranty ?? false, warrantyEndsAt: input.warrantyEndsAt, serviceCompany: input.serviceCompany,
    serviceContact: input.serviceContact, maintenanceFrequency: input.maintenanceFrequency,
    lastMaintenanceDate: input.lastMaintenanceDate, nextMaintenanceDate: input.nextMaintenanceDate,
    maintenanceCostTotal: input.maintenanceCostTotal, imageUrl: input.imageUrl, notes: input.notes, sourceType,
    plateStatus, plateLinkedAt: plateStatus === "vinculada" ? now : undefined,
    plateLinkedBy: plateStatus === "vinculada" ? actor.userDoc.id : undefined,
    purchaseOrderId: input.purchaseOrderId, purchaseReceiptId: input.purchaseReceiptId,
    purchaseReceiptItemId: input.purchaseReceiptItemId, createdAt: now, updatedAt: now, createdBy: actor.userDoc.id,
  };
  await dbAdmin.runTransaction(async (transaction) => {
    if (sourceType === "purchase_receipt") {
      const purchaseOrderId = input.purchaseOrderId!;
      const purchaseReceiptId = input.purchaseReceiptId!;
      const purchaseReceiptItemId = input.purchaseReceiptItemId!;
      const orderReference = dbAdmin.collection("purchase_orders").doc(purchaseOrderId);
      const receiptReference = dbAdmin.collection("purchase_receipts").doc(purchaseReceiptId);
      const receiptItemReference = receiptReference.collection("items").doc(purchaseReceiptItemId);
      const [orderSnapshot, receiptSnapshot, receiptItemSnapshot] = await Promise.all([
        transaction.get(orderReference), transaction.get(receiptReference), transaction.get(receiptItemReference),
      ]);
      const orderItemId = String(receiptItemSnapshot.get("purchaseOrderItemId") ?? "");
      const orderItemSnapshot = orderItemId
        ? await transaction.get(orderReference.collection("items").doc(orderItemId))
        : null;
      const relationError = purchaseAcquisitionRelationError({
        workspaceId: actor.workspace_id, purchaseOrderId, purchaseReceiptId, purchaseReceiptItemId,
      }, {
        orderExists: orderSnapshot.exists,
        orderWorkspaceId: orderSnapshot.get("workspaceId"),
        receiptExists: receiptSnapshot.exists,
        receiptWorkspaceId: receiptSnapshot.get("workspaceId"),
        receiptPurchaseOrderId: receiptSnapshot.get("purchaseOrderId"),
        receiptItemExists: receiptItemSnapshot.exists,
        receiptItemPurchaseReceiptId: receiptItemSnapshot.get("purchaseReceiptId"),
        receiptItemPurchaseOrderItemId: receiptItemSnapshot.get("purchaseOrderItemId"),
        orderItemExists: orderItemSnapshot?.exists ?? false,
        orderItemId,
      });
      if (relationError) throw new AppError({
        code: relationError,
        kind: relationError === "PURCHASE_ACQUISITION_SCOPE" ? "AUTHORIZATION" : relationError === "PURCHASE_ACQUISITION_NOT_FOUND" ? "NOT_FOUND" : "VALIDATION",
        safeMessage: "O vínculo entre pedido, recebimento e item da compra é inválido.",
      });
    }
    if (requestedCode) {
      const existing = await transaction.get(dbAdmin.collection("assets").where("workspaceId", "==", actor.workspace_id).where("code", "==", code).limit(1));
      if (!existing.empty) throw new AppError({ code: "ASSET_CODE_IN_USE", kind: "CONFLICT", safeMessage: `A etiqueta ${code} já está vinculada a outro patrimônio.` });
    }
    transaction.set(assetReference, asset);
    transaction.set(movementReference, { workspaceId: actor.workspace_id, assetId: assetReference.id, assetCode: code, assetName: input.name, type: "CRIACAO", actor: { userId: actor.userDoc.id, nameSnapshot: actor.userDoc.username }, custodyTo: custody, locationTo: currentLocation, toKioskId: input.currentKioskId, toKioskName: input.currentKioskName ?? null, toStatus: asset.status, userId: actor.userDoc.id, username: actor.userDoc.username, occurredAt: now, notes: input.notes || "Cadastro de patrimônio.", sourceType, sourceId: input.purchaseReceiptId ?? null, source: { type: sourceType === "purchase_receipt" ? "purchase" : "system", id: input.purchaseReceiptId ?? assetReference.id }, lifecycleVersion: 1 });
  });
  return NextResponse.json({ id: assetReference.id, code, lifecycleVersion: 1 }, { status: 201 });
});
