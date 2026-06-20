import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { UNIFORM_STOCK_ID } from "@/lib/uniform";
import { WORKSPACE_ID } from "@/lib/workspace";
import type { LotEntry, Product, UniformAssignment, UniformEvent } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canView(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin ||
    context.permissions.stock.uniforms?.view === true ||
    context.permissions.dp.collaborators.view === true;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canView(context)) {
      return NextResponse.json(
        { error: "Sem permissão para visualizar uniformes." },
        { status: 403 },
      );
    }

    const collaboratorUserId = request.nextUrl.searchParams.get("collaboratorUserId")?.trim();
    const canViewInventory = context.isDefaultAdmin ||
      context.permissions.stock.uniforms?.view === true ||
      context.permissions.stock.uniforms?.deliver === true;

    const [lotsSnap, assignmentsSnap, eventsSnap] = await Promise.all([
      canViewInventory
        ? dbAdmin.collection("lots").where("kioskId", "==", UNIFORM_STOCK_ID).get()
        : Promise.resolve(null),
      dbAdmin.collection("uniformAssignments").where("workspaceId", "==", WORKSPACE_ID).get(),
      dbAdmin.collection("uniformEvents").where("workspaceId", "==", WORKSPACE_ID).get(),
    ]);

    const assignments = assignmentsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as UniformAssignment))
      .filter((entry) => !collaboratorUserId || entry.collaboratorUserId === collaboratorUserId)
      .sort((left, right) => right.deliveredAt.localeCompare(left.deliveredAt));

    const events = eventsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as UniformEvent))
      .filter((entry) => !collaboratorUserId || entry.collaboratorUserId === collaboratorUserId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, collaboratorUserId ? 100 : 500);

    const rawLots = lotsSnap
      ? lotsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as LotEntry))
      : [];
    const productIds = Array.from(new Set([
      ...rawLots.map((lot) => lot.productId),
      ...assignments.map((assignment) => assignment.productId),
      ...events.map((event) => event.productId),
    ].filter(Boolean)));
    const productSnaps = await Promise.all(
      productIds.map((productId) => dbAdmin.collection("products").doc(productId).get()),
    );
    const productMap = new Map(
      productSnaps
        .filter((doc) => doc.exists)
        .map((doc) => [doc.id, { id: doc.id, ...doc.data() } as Product]),
    );
    const lots = rawLots.map((lot) => {
      const product = productMap.get(lot.productId);
      return {
        ...lot,
        productName: lot.productName || product?.baseName || lot.productId,
        apparelType: lot.apparelType ?? product?.apparelType,
        apparelSize: lot.apparelSize ?? product?.apparelSize,
        apparelColor: lot.apparelColor ?? product?.apparelColor,
        imageUrl: lot.imageUrl ?? product?.imageUrl,
      };
    });
    const enrichedAssignments = assignments.map((assignment) => {
      const product = productMap.get(assignment.productId);
      return {
        ...assignment,
        apparelType: assignment.apparelType ?? product?.apparelType,
        apparelSize: assignment.apparelSize ?? product?.apparelSize,
        apparelColor: assignment.apparelColor ?? product?.apparelColor,
        imageUrl: assignment.imageUrl ?? product?.imageUrl,
      };
    });
    const enrichedEvents = events.map((event) => {
      const product = productMap.get(event.productId);
      return {
        ...event,
        apparelType: event.apparelType ?? product?.apparelType,
        apparelSize: event.apparelSize ?? product?.apparelSize,
        apparelColor: event.apparelColor ?? product?.apparelColor,
        imageUrl: event.imageUrl ?? product?.imageUrl,
      };
    });

    return NextResponse.json(
      {
        lots,
        assignments: enrichedAssignments,
        events: enrichedEvents,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar uniformes." },
      { status: 400 },
    );
  }
}
