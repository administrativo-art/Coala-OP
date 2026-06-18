import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { getMovementQuantityInBaseUnit } from "@/lib/movement-quantity";
import type { BaseProduct, MovementRecord, Product } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTRY_TYPES = new Set(["ENTRADA", "ENTRADA_CORRECAO", "SAIDA_ESTORNO"]);
const TRANSFER_TYPES = new Set(["TRANSFERENCIA_ENTRADA", "TRANSFERENCIA_SAIDA"]);
const ALLOWED_SORT_KEYS = new Set([
  "timestamp",
  "productName",
  "type",
  "quantityChange",
  "fromKioskId",
  "username",
  "notes",
]);

function canReadHistory(context: Awaited<ReturnType<typeof requireUser>>) {
  return (
    context.isDefaultAdmin ||
    !!context.permissions?.stock?.inventoryControl?.viewHistory ||
    !!context.permissions?.stock?.analysis?.valuation ||
    !!context.permissions?.purchasing?.view
  );
}

function classifyType(type = ""): "in" | "out" | "transfer" {
  if (TRANSFER_TYPES.has(type)) return "transfer";
  if (ENTRY_TYPES.has(type)) return "in";
  return "out";
}

function matchesType(record: MovementRecord, typeFilter: string, kioskId: string) {
  if (typeFilter === "all") return true;
  const isTransfer = record.type?.includes("TRANSFERENCIA");
  if (typeFilter === "ENTRADA") {
    if (record.type === "ENTRADA") return true;
    return isTransfer
      ? kioskId !== "all"
        ? record.toKioskId === kioskId
        : record.type === "TRANSFERENCIA_ENTRADA"
      : false;
  }
  if (typeFilter === "SAIDA") {
    const isExit = record.type?.startsWith("SAIDA_") || record.type === "ENTRADA_ESTORNO";
    if (isExit) return true;
    return isTransfer
      ? kioskId !== "all"
        ? record.fromKioskId === kioskId
        : record.type === "TRANSFERENCIA_SAIDA"
      : false;
  }
  if (typeFilter === "AJUSTE") {
    return record.type?.includes("CORRECAO") || record.type?.includes("Divergência");
  }
  return record.type === typeFilter;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canReadHistory(context)) {
      return NextResponse.json({ error: "Sem permissão para consultar movimentações." }, { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 50)));
    const from = params.get("from");
    const to = params.get("to");
    const typeFilter = params.get("type") || "all";
    const kioskId = params.get("kioskId") || "all";
    const search = (params.get("search") || "").trim().toLocaleLowerCase("pt-BR");
    const baseProductId = params.get("baseProductId");
    const requestedSortKey = params.get("sortKey") || "timestamp";
    const sortKey = ALLOWED_SORT_KEYS.has(requestedSortKey) ? requestedSortKey : "timestamp";
    const sortDirection = params.get("sortDirection") === "asc" ? "asc" : "desc";

    let query: FirebaseFirestore.Query = dbAdmin.collection("movementHistory");
    if (from) query = query.where("timestamp", ">=", from);
    if (to) query = query.where("timestamp", "<=", to);

    const [movementSnapshot, productSnapshot, baseProductSnapshot] = await Promise.all([
      query.get(),
      baseProductId ? dbAdmin.collection("products").where("baseProductId", "==", baseProductId).get() : null,
      baseProductId ? dbAdmin.collection("baseProducts").doc(baseProductId).get() : null,
    ]);

    const products = new Map<string, Product>();
    productSnapshot?.docs.forEach((doc) => products.set(doc.id, { id: doc.id, ...doc.data() } as Product));
    const allowedProductIds = baseProductId ? new Set(products.keys()) : null;
    const baseProduct = baseProductSnapshot?.exists
      ? ({ id: baseProductSnapshot.id, ...baseProductSnapshot.data() } as BaseProduct)
      : null;

    const filtered = movementSnapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as MovementRecord))
      .filter((record) => {
        if (allowedProductIds && !allowedProductIds.has(record.productId)) return false;
        if (kioskId !== "all" && record.fromKioskId !== kioskId && record.toKioskId !== kioskId) return false;
        if (!matchesType(record, typeFilter, kioskId)) return false;
        if (!search) return true;
        return [record.productName, record.lotNumber, record.username, record.notes]
          .some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(search));
      });

    filtered.sort((left, right) => {
      const leftValue = left[sortKey as keyof MovementRecord];
      const rightValue = right[sortKey as keyof MovementRecord];
      let comparison = 0;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        comparison = leftValue - rightValue;
      } else {
        comparison = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), "pt-BR");
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    const totals = filtered.reduce(
      (acc, record) => {
        const product = products.get(record.productId);
        const baseQuantity = baseProduct && product
          ? getMovementQuantityInBaseUnit(record, product, baseProduct)
          : Number(record.quantityChange) || 0;
        const quantity = Math.abs(baseQuantity);
        const kind = classifyType(record.type);

        if (kioskId !== "all") {
          const isIncoming = record.toKioskId === kioskId;
          const isOutgoing = record.fromKioskId === kioskId;
          if (kind === "transfer") {
            if (isIncoming) acc.entries += quantity;
            else if (isOutgoing) acc.exits += quantity;
            if (isIncoming || isOutgoing) acc.transfers += quantity;
          } else if (kind === "in" && isIncoming) {
            acc.entries += quantity;
          } else if (kind === "out" && isOutgoing) {
            acc.exits += quantity;
          }
        } else if (kind === "transfer") {
          acc.transfers += quantity;
        } else if (kind === "in") {
          acc.entries += quantity;
        } else {
          acc.exits += quantity;
        }
        return acc;
      },
      { entries: 0, exits: 0, transfers: 0 }
    );

    const start = (page - 1) * pageSize;
    return NextResponse.json({
      records: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
      totals,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao consultar movimentações." },
      { status: 400 }
    );
  }
}
