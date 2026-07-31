import { NextRequest, NextResponse } from "next/server";

import {
  canUpdateCompany,
  getCompanyUserContext,
} from "@/app/api/companies/_auth";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export async function GET(request: NextRequest) {
  const context = await getCompanyUserContext(request);
  if (!context) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (!canUpdateCompany(context)) {
    return NextResponse.json(
      { error: "Sem permissão para definir o responsável pela assinatura." },
      { status: 403 },
    );
  }

  const users = await dbAdmin.collection("users").get();
  const options = users.docs
    .filter((user) => user.get("isActive") !== false)
    .map((user) => ({
      id: user.id,
      name: text(
        user.get("documentSignatureName"),
        user.get("username"),
        user.get("name"),
        "Usuário sem nome",
      ),
      email: text(
        user.get("documentSignatureEmail"),
        user.get("email"),
      ).toLocaleLowerCase("pt-BR"),
    }))
    .filter((user) => user.email)
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

  return NextResponse.json({ options });
}
