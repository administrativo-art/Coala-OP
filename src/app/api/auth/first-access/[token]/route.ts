import { NextResponse, type NextRequest } from "next/server";

import {
  consumeFirstAccessLink,
  getFirstAccessLinkStatus,
  provisionPdvFirstAccess,
} from "@/lib/first-access-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanToken(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 160);
}

function errorMessage(reason: string) {
  if (reason === "used") return "Este link ja foi usado.";
  if (reason === "expired") return "Este link expirou. Solicite um novo link ao RH.";
  if (reason === "revoked") return "Este link foi substituido por um link mais recente.";
  return "Link de primeiro acesso invalido.";
}

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const clean = cleanToken(token);
  if (!clean) {
    return NextResponse.json({ error: "Token invalido." }, { status: 400 });
  }

  const status = await getFirstAccessLinkStatus(clean);
  if (!status.ok) {
    return NextResponse.json({ error: errorMessage(status.reason) }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    email: status.email,
    username: status.username,
    expiresAt: status.expiresAt,
    pdvAccess: status.pdvAccess,
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const clean = cleanToken(token);
  if (!clean) {
    return NextResponse.json({ error: "Token invalido." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const action = body?.action === "pdv_password" ? "pdv_password" : "coala_password";
  const password = typeof body?.password === "string" ? body.password : "";
  if (action === "pdv_password") {
    if (!/^[1-9]\d{3}$/.test(password)) {
      return NextResponse.json({ error: "A senha do PDV deve ter exatamente 4 números e não pode começar com zero." }, { status: 400 });
    }
    try {
      const result = await provisionPdvFirstAccess(clean, password);
      if (!result.ok) return NextResponse.json({ error: errorMessage(result.reason) }, { status: 400 });
      return NextResponse.json({ ok: true, nextStep: "coala_password" });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao criar acesso no PDV Legal." }, { status: 502 });
    }
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "A senha deve ter pelo menos 8 caracteres." }, { status: 400 });
  }

  const status = await getFirstAccessLinkStatus(clean);
  if (!status.ok) return NextResponse.json({ error: errorMessage(status.reason) }, { status: 400 });
  if (status.pdvAccess.required && !status.pdvAccess.completed) {
    return NextResponse.json({ error: "Crie primeiro a senha do PDV Legal." }, { status: 409 });
  }
  const result = await consumeFirstAccessLink(clean, password);
  if (!result.ok) {
    return NextResponse.json({ error: errorMessage(result.reason) }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    email: result.email,
    username: result.username,
  });
}
