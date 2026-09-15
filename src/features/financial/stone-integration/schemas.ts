import { z } from "zod";

const identifier = z.string().trim().min(1).max(180).refine((value) => !value.includes("/"));
const civilDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/);
const optionalText = z.string().trim().max(500).optional().nullable().transform((value) => value || null);
const externalCode = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/);
const secretReference = z.string().trim().max(240)
  .regex(/^(?:secret-manager|env):\/\/[A-Za-z0-9._:/-]+$/, "Use uma referência secret-manager:// ou env://.")
  .optional()
  .nullable()
  .transform((value) => value || null);

export const stoneMerchantMappingSchema = z.object({
  kioskId: identifier,
  accountId: identifier,
  stoneCodes: z.array(externalCode).min(1).max(20),
  terminalIds: z.array(externalCode).max(100).default([]),
  legalEntityDocument: z.string().trim().regex(/^\d{14}$/).optional().nullable().transform((value) => value || null),
  merchantName: z.string().trim().max(180).optional().nullable().transform((value) => value || null),
  secretReference,
  status: z.enum(["active", "inactive"]),
  validFrom: civilDate,
  validTo: civilDate.optional().nullable(),
  notes: optionalText,
  reason: z.string().trim().min(5).max(1_000),
}).strict().refine((value) => !value.validTo || value.validTo >= value.validFrom, {
  path: ["validTo"],
  message: "A vigência final deve ser posterior à inicial.",
});

export const stoneIntegrationListQuerySchema = z.object({
  cursor: z.string().trim().min(3).max(500).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const stoneMappingIdSchema = identifier;
