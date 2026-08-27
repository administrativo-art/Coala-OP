import { z } from "zod";

import { ERROR_KINDS, ERROR_SEVERITIES } from "./taxonomy";

export const SYSTEM_ERROR_EVENT_SCHEMA_VERSION = 1 as const;

export const SystemErrorEventSchema = z.object({
  schemaVersion: z.literal(SYSTEM_ERROR_EVENT_SCHEMA_VERSION),
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
  errorKind: z.enum(ERROR_KINDS),
  severity: z.enum(ERROR_SEVERITIES),
  source: z.string().min(1).max(120),
  operation: z.string().min(1).max(160).optional(),
  routeOrJob: z.string().min(1).max(300).optional(),
  requestId: z.string().max(128).optional(),
  correlationId: z.string().max(128).optional(),
  environment: z.string().min(1).max(80),
  release: z.string().min(1).max(200),
  fingerprint: z.string().regex(/^err-v1-[0-9a-f]{16}$/),
  errorName: z.string().min(1).max(200),
  messageSanitized: z.string().min(1).max(2_020),
  stackSanitized: z.string().max(8_020).optional(),
  metadataSanitized: z.record(z.string(), z.unknown()),
  retryAttempt: z.number().int().nonnegative().optional(),
  isTerminal: z.boolean(),
});

export type SystemErrorEvent = z.infer<typeof SystemErrorEventSchema>;
