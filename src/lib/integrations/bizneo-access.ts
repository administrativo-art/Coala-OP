import { type NextRequest } from "next/server";

import { requireUser } from "@/lib/auth-server";

export type BizneoAccessMode = "users" | "schedules";

export class BizneoAccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "BizneoAccessError";
  }
}

export async function assertBizneoAccess(
  request: NextRequest,
  mode: BizneoAccessMode
) {
  const context = await requireUser(request).catch(() => {
    throw new BizneoAccessError("Não autorizado.", 401);
  });
  const canManageUsers =
    context.isDefaultAdmin ||
    context.permissions.settings.manageUsers ||
    context.permissions.dp.collaborators.edit;
  const canManageSchedules =
    context.isDefaultAdmin ||
    context.permissions.dp.schedules.create ||
    context.permissions.dp.schedules.edit ||
    context.permissions.dp.settings.manageShifts;

  if (mode === "users" ? !canManageUsers : !canManageSchedules) {
    throw new BizneoAccessError(
      mode === "users"
        ? "Sem permissão para sincronizar colaboradores com o Bizneo."
        : "Sem permissão para gerenciar escalas no Bizneo.",
      403,
    );
  }

  return context;
}
