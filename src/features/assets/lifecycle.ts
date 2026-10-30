import { z } from "zod";

import type {
  Asset,
  AssetCustody,
  AssetLocation,
  AssetOwner,
  AssetOwnershipRegime,
} from "@/types";

export const COMPANY_HOLDER_NAME = "Empresa";

export const assetHolderSchema = z.object({
  holderType: z.enum(["company", "employee", "third_party"]),
  holderId: z.string().trim().min(1).max(160).optional(),
  holderNameSnapshot: z.string().trim().min(1).max(200),
}).strict().superRefine((holder, context) => {
  if (holder.holderType === "employee" && !holder.holderId) {
    context.addIssue({ code: "custom", path: ["holderId"], message: "Colaborador de destino obrigatório." });
  }
});

export const assetLocationSchema = z.object({
  type: z.enum(["unit", "company_site", "external", "in_transit", "maintenance"]),
  refId: z.string().trim().min(1).max(160).optional(),
  nameSnapshot: z.string().trim().min(1).max(240),
  details: z.string().trim().max(1000).optional(),
}).strict().superRefine((location, context) => {
  if (location.type === "unit" && !location.refId) {
    context.addIssue({ code: "custom", path: ["refId"], message: "Unidade de destino obrigatória." });
  }
});

export const assetPerformedBySchema = z.object({
  type: z.enum(["user", "employee", "third_party"]),
  id: z.string().trim().min(1).max(160).optional(),
  nameSnapshot: z.string().trim().min(1).max(200),
}).strict().superRefine((person, context) => {
  if (person.type !== "third_party" && !person.id) {
    context.addIssue({ code: "custom", path: ["id"], message: "Pessoa cadastrada obrigatória." });
  }
});

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function ownershipRegimeFromLegacy(value: unknown): AssetOwnershipRegime {
  const normalized = text(value)?.toLocaleLowerCase("pt-BR");
  if (normalized === "próprio" || normalized === "proprio") return "owned";
  if (normalized === "alugado") return "leased";
  if (normalized === "comodato" || normalized === "emprestado") return "loaned";
  if (normalized === "consignado") return "third_party";
  return "unknown";
}

export function companyOwner(): AssetOwner {
  return { type: "company", nameSnapshot: COMPANY_HOLDER_NAME };
}

export function companyCustody(at: string, sourceEventId: string): AssetCustody {
  return {
    holderType: "company",
    holderNameSnapshot: COMPANY_HOLDER_NAME,
    since: at,
    sourceEventId,
  };
}

export function unitLocation(input: {
  unitId: string;
  unitName?: string;
  details?: string;
  at: string;
  sourceEventId: string;
}): AssetLocation {
  return {
    type: "unit",
    refId: input.unitId,
    nameSnapshot: input.unitName || input.unitId,
    details: input.details,
    since: input.at,
    sourceEventId: input.sourceEventId,
  };
}

export function normalizedAssetLifecycle(asset: Partial<Asset>, fallbackAt = new Date(0).toISOString()) {
  const createdAt = text(asset.createdAt) ?? fallbackAt;
  const sourceEventId = text(asset.custody?.sourceEventId) ?? `legacy:${text(asset.id) ?? "asset"}`;
  const owner = asset.owner ?? companyOwner();
  const ownershipRegime = asset.ownershipRegime ?? ownershipRegimeFromLegacy(asset.possessionStatus);
  const custody: AssetCustody = asset.custody ?? (text(asset.responsibleUserId)
    ? {
        holderType: "employee",
        holderId: text(asset.responsibleUserId),
        holderNameSnapshot: text(asset.responsibleName) ?? "Colaborador não identificado",
        since: createdAt,
        sourceEventId,
        legacyImported: true,
      }
    : companyCustody(createdAt, sourceEventId));
  const legacyUnitId = text(asset.currentKioskId);
  const currentLocation: AssetLocation = asset.currentLocation ?? (legacyUnitId
    ? unitLocation({
        unitId: legacyUnitId,
        unitName: text(asset.currentKioskName) ?? text(asset.exactLocation),
        details: text(asset.exactLocation),
        at: createdAt,
        sourceEventId,
      })
    : {
        type: "external",
        nameSnapshot: text(asset.exactLocation) ?? "Local não identificado",
        details: text(asset.exactLocation),
        since: createdAt,
        sourceEventId,
      });
  return {
    owner,
    ownershipRegime,
    custody,
    currentLocation,
    lifecycleVersion: Number.isInteger(asset.lifecycleVersion) && Number(asset.lifecycleVersion) > 0
      ? Number(asset.lifecycleVersion)
      : 1,
    lifecycleImportedFromLegacy: !asset.owner || !asset.custody || !asset.currentLocation,
  };
}

export const PURCHASE_LINKED_FIELDS = [
  "purchaseDate",
  "purchaseValue",
  "supplierId",
  "supplierName",
  "invoiceNumber",
  "paymentMethod",
  "costCenter",
  "accountingAccount",
  "documentUrl",
  "purchaseOrderId",
  "purchaseReceiptId",
  "purchaseReceiptItemId",
] as const;

function comparable(value: unknown) {
  return value === undefined ? undefined : JSON.stringify(value ?? null);
}

export function changedPurchaseLinkedFields(current: Record<string, unknown>, input: Record<string, unknown>) {
  return PURCHASE_LINKED_FIELDS.filter((field) => (
    Object.prototype.hasOwnProperty.call(input, field)
    && comparable(input[field]) !== comparable(current[field])
  ));
}

export function legacyResponsiblePatch(holder: z.infer<typeof assetHolderSchema>) {
  if (holder.holderType === "employee") {
    return {
      responsibleUserId: holder.holderId ?? null,
      responsibleName: holder.holderNameSnapshot,
      responsibilityStatus: "assigned" as const,
    };
  }
  return {
    responsibleUserId: null,
    responsibleName: holder.holderType === "third_party" ? holder.holderNameSnapshot : null,
    responsibilityStatus: null,
  };
}
