import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { authAdmin, dbAdmin } from "@/lib/firebase-admin";
import { EMAIL_SENDERS, sendEmail } from "@/lib/email/resend";
import { renderPasswordResetEmail } from "@/lib/email/first-access-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_RESPONSE = {
  ok: true,
  message: "Se o e-mail estiver cadastrado, enviaremos as instruções de redefinição.",
};
const HOUR_MS = 60 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;
const MAX_PER_HOUR = 5;

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 320) : "";
}

function emailHash(email: string) {
  return createHash("sha256").update(email).digest("hex");
}

async function reserveAttempt(email: string) {
  const now = Date.now();
  const ref = dbAdmin.collection("passwordResetRateLimits").doc(emailHash(email));
  return dbAdmin.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.data() ?? {};
    const windowStartedAt = Number(data.windowStartedAt ?? 0);
    const lastAttemptAt = Number(data.lastAttemptAt ?? 0);
    const withinWindow = now - windowStartedAt < HOUR_MS;
    const count = withinWindow ? Number(data.count ?? 0) : 0;
    if (now - lastAttemptAt < MIN_INTERVAL_MS || count >= MAX_PER_HOUR) return false;
    transaction.set(ref, {
      windowStartedAt: withinWindow ? windowStartedAt : now,
      lastAttemptAt: now,
      count: count + 1,
      updatedAt: new Date(now).toISOString(),
    }, { merge: true });
    return true;
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email || !email.includes("@")) return NextResponse.json(GENERIC_RESPONSE);

  const allowed = await reserveAttempt(email).catch(() => false);
  if (!allowed) return NextResponse.json(GENERIC_RESPONSE);

  try {
    const user = await authAdmin.getUserByEmail(email);
    if (user.disabled) return NextResponse.json(GENERIC_RESPONSE);

    const resetUrl = await authAdmin.generatePasswordResetLink(email, {
      url: "https://op.coalashakes.com/login",
      handleCodeInApp: false,
    });
    const subject = "Redefina sua senha do Coala One";
    const sent = await sendEmail({
      from: EMAIL_SENDERS.access,
      to: email,
      subject,
      html: renderPasswordResetEmail({ actionUrl: resetUrl }),
      text: `Redefina sua senha do Coala One\n\nAcesse o link para criar uma nova senha: ${resetUrl}\n\nSe você não fez essa solicitação, ignore esta mensagem.\n\nEssa é uma mensagem automática, não responda esse e-mail.`,
    });

    await dbAdmin.collection("emailCommunications").add({
      event: "password_reset",
      recipientHash: emailHash(email),
      sender: EMAIL_SENDERS.access,
      subject,
      status: "accepted",
      providerId: sent.id,
      acceptedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (code !== "auth/user-not-found") {
      console.error("[forgot-password] Falha ao processar redefinição:", code || "unknown");
    }
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
