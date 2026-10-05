import "server-only";

import type { NextRequest } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";

function configuredEmails() {
  return new Set(
    (process.env.INSTAGRAM_SCHEDULER_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function requireInstagramSchedulerAccess(context: ServerUserContext) {
  const allowedEmails = configuredEmails();
  const authenticatedEmail = context.decoded.email?.trim().toLowerCase() ?? "";
  const storedEmail = context.userDoc.email?.trim().toLowerCase() ?? "";

  if (allowedEmails.size > 0) {
    if (
      (authenticatedEmail && allowedEmails.has(authenticatedEmail))
      || (storedEmail && allowedEmails.has(storedEmail))
    ) return;
  } else if (context.isDefaultAdmin) {
    return;
  }

  throw new AppError({
    code: "INSTAGRAM_SCHEDULER_FORBIDDEN",
    kind: "AUTHORIZATION",
    safeMessage: "Você não tem acesso a esta programação.",
    reportable: false,
  });
}

export async function requireInstagramSchedulerUser(request: NextRequest) {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({
      code: "INSTAGRAM_SCHEDULER_AUTHENTICATION_REQUIRED",
      kind: "AUTHENTICATION",
      safeMessage: "Faça login para acessar a programação do Instagram.",
      reportable: false,
      cause,
    });
  });
  requireInstagramSchedulerAccess(context);
  return context;
}
