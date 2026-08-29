import { z } from "zod";

import type { CashDepositPeriodPolicy } from "./types";

export const cashDepositPeriodPolicySchema = z.object({
  id: z.string().trim().min(1).max(500),
  workspaceId: z.string().trim().min(1).max(160),
  year: z.number().int().min(2020).max(2200),
  month: z.number().int().min(1).max(12),
  policy: z.enum(["standard", "dre_only"]),
  reason: z.string().trim().min(3).max(1000),
  createdAt: z.string().datetime({ offset: true }),
  createdBy: z.string().trim().min(1).max(500),
  updatedAt: z.string().datetime({ offset: true }),
  updatedBy: z.string().trim().min(1).max(500),
});

export const cashDepositPeriodPolicyCommandSchema = z.object({
  workspaceId: z.string().trim().min(1).max(160),
  year: z.number().int().min(2020).max(2200),
  month: z.number().int().min(1).max(12),
  policy: z.enum(["standard", "dre_only"]),
  reason: z.string().trim().min(3).max(1000),
  actorId: z.string().trim().min(1).max(500),
  actorName: z.string().trim().min(1).max(500),
});

export type CashDepositPeriodPolicyCommand = z.infer<typeof cashDepositPeriodPolicyCommandSchema>;

export type CashDepositPeriodPolicyChangePlan = {
  action: "create" | "update" | "unchanged";
  previous: CashDepositPeriodPolicy | null;
  next: CashDepositPeriodPolicy;
};

export function cashDepositPeriodPolicyDocumentId(workspaceId: string, year: number, month: number) {
  return `${workspaceId}_${year}_${String(month).padStart(2, "0")}`;
}

export function planCashDepositPeriodPolicyChange(input: {
  command: CashDepositPeriodPolicyCommand;
  existing: CashDepositPeriodPolicy | null;
  now: string;
}): CashDepositPeriodPolicyChangePlan {
  const command = cashDepositPeriodPolicyCommandSchema.parse(input.command);
  const expectedId = cashDepositPeriodPolicyDocumentId(command.workspaceId, command.year, command.month);
  const existing = input.existing ? cashDepositPeriodPolicySchema.parse(input.existing) : null;
  if (existing && (
    existing.id !== expectedId
    || existing.workspaceId !== command.workspaceId
    || existing.year !== command.year
    || existing.month !== command.month
  )) {
    throw new Error("A política existente não corresponde à competência solicitada.");
  }
  if (existing?.policy === command.policy && existing.reason === command.reason) {
    return { action: "unchanged", previous: existing, next: existing };
  }
  const next: CashDepositPeriodPolicy = {
    id: expectedId,
    workspaceId: command.workspaceId,
    year: command.year,
    month: command.month,
    policy: command.policy,
    reason: command.reason,
    createdAt: existing?.createdAt ?? input.now,
    createdBy: existing?.createdBy ?? command.actorId,
    updatedAt: input.now,
    updatedBy: command.actorId,
  };
  return {
    action: existing ? "update" : "create",
    previous: existing,
    next,
  };
}
