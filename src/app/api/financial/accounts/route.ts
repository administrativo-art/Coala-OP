import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyAuth } from "@/lib/verify-auth";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { resolveFinancialPermissions } from "@/features/financial/lib/server-access";

async function canManage(decoded: Awaited<ReturnType<typeof verifyAuth>>) {
  const access = await resolveFinancialPermissions(decoded);
  return (
    access.isDefaultAdmin ||
    (access.permissions?.view === true &&
      access.permissions?.settings?.manageAccountPlans === true)
  );
}

async function wouldCreateParentCycle(accountId: string, parentId: string | null | undefined) {
  if (!parentId) return false;
  if (parentId === accountId) return true;

  const snap = await financialDbAdmin.collection("accounts").get();
  const parentById = new Map<string, string | null>();
  snap.docs.forEach((doc) => {
    const data = doc.data();
    parentById.set(doc.id, (data.parentId as string | null | undefined) ?? null);
  });

  const visited = new Set<string>();
  let current: string | null | undefined = parentId;
  while (current) {
    if (current === accountId) return true;
    if (visited.has(current)) return true;
    visited.add(current);
    current = parentById.get(current);
  }

  return false;
}

// POST /api/financial/accounts  — create
export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request);
    if (!decoded.uid) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    if (!(await canManage(decoded)))
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

    const body = await request.json();
    const { name, description, parentId, dre_position, order, is_dre_account } = body;
    if (!name || typeof name !== "string")
      return NextResponse.json({ error: "Nome obrigatório." }, { status: 400 });

    const ref = await financialDbAdmin.collection("accounts").add({
      name: name.trim(),
      description: description ?? null,
      parentId: parentId ?? null,
      dre_position: dre_position ?? null,
      order: typeof order === "number" ? order : 0,
      active: true,
      is_dre_account: typeof is_dre_account === "boolean" ? is_dre_account : true,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: ref.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao criar conta." },
      { status: 500 }
    );
  }
}

// PATCH /api/financial/accounts  — update
export async function PATCH(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request);
    if (!decoded.uid) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    if (!(await canManage(decoded)))
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

    const body = await request.json();
    const { id, ...fields } = body;
    if (!id || typeof id !== "string")
      return NextResponse.json({ error: "ID obrigatório." }, { status: 400 });

    const allowed = ["name", "description", "parentId", "dre_position", "order", "active", "is_dre_account"];
    const update: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in fields) {
        // is_dre_account is boolean — preserve false explicitly
        update[key] = key === "is_dre_account" ? (typeof fields[key] === "boolean" ? fields[key] : true) : (fields[key] ?? null);
      }
    }
    if ("parentId" in update && await wouldCreateParentCycle(id, update.parentId as string | null)) {
      return NextResponse.json(
        { error: "Conta pai inválida: a alteração criaria um ciclo no plano de contas." },
        { status: 400 }
      );
    }
    if (Object.keys(update).length === 0)
      return NextResponse.json({ error: "Nenhum campo para atualizar." }, { status: 400 });

    await financialDbAdmin.collection("accounts").doc(id).update(update);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao atualizar conta." },
      { status: 500 }
    );
  }
}

// DELETE /api/financial/accounts?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request);
    if (!decoded.uid) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    if (!(await canManage(decoded)))
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID obrigatório." }, { status: 400 });

    await financialDbAdmin.collection("accounts").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao excluir conta." },
      { status: 500 }
    );
  }
}
