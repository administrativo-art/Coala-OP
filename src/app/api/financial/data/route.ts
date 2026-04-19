import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/verify-auth";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import {
  canReadFinancialPath,
  resolveFinancialPermissions,
  serializeFinancialValue,
} from "@/features/financial/lib/server-access";

function normalizePath(rawPath: string | null) {
  if (!rawPath) return null;
  const trimmed = rawPath.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return null;
  if (trimmed.includes("..")) return null;
  return trimmed;
}

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request);
    if (!decoded.uid) {
      return NextResponse.json({ error: "Usuário inválido." }, { status: 401 });
    }

    const path = normalizePath(request.nextUrl.searchParams.get("path"));
    if (!path) {
      return NextResponse.json({ error: "Path financeiro inválido." }, { status: 400 });
    }

    const access = await resolveFinancialPermissions(decoded);
    if (!canReadFinancialPath(path, access.permissions, access.isDefaultAdmin)) {
      return NextResponse.json(
        {
          error: access.lookupError ?? "Sem permissão para ler dados financeiros.",
          userLookupStatus: access.userLookupStatus,
        },
        { status: 403 }
      );
    }

    const segments = path.split("/").filter(Boolean);

    if (segments.length % 2 === 1) {
      const snapshot = await financialDbAdmin.collection(path).get();
      return NextResponse.json({
        kind: "collection",
        path,
        docs: snapshot.docs.map((doc) => ({
          id: doc.id,
          ...((serializeFinancialValue(doc.data()) as Record<string, unknown>) ?? {}),
        })),
      });
    }

    const snapshot = await financialDbAdmin.doc(path).get();
    return NextResponse.json({
      kind: "document",
      path,
      doc: snapshot.exists
        ? {
            id: snapshot.id,
            ...((serializeFinancialValue(snapshot.data()) as Record<string, unknown>) ?? {}),
          }
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao ler dados do módulo financeiro.",
      },
      { status: 500 }
    );
  }
}
