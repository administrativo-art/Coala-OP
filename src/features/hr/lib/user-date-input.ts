import { z } from "zod";

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });

const timestampObjectSchema = z
  .object({
    seconds: z.number().int().finite().optional(),
    nanoseconds: z.number().int().min(0).max(999_999_999).optional(),
    _seconds: z.number().int().finite().optional(),
    _nanoseconds: z.number().int().min(0).max(999_999_999).optional(),
  })
  .passthrough()
  .refine((value) => value.seconds !== undefined || value._seconds !== undefined);

export const userDateInputSchema = z.union([dateOnlySchema, timestampObjectSchema]);

export function parseUserDateInput(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (
    value
    && typeof value === "object"
    && "toDate" in value
    && typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const parsed = (value as { toDate: () => unknown }).toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }

  const parsed = userDateInputSchema.safeParse(value);
  if (!parsed.success) return null;

  if (typeof parsed.data === "string") {
    return new Date(`${parsed.data}T12:00:00.000Z`);
  }

  const seconds = parsed.data.seconds ?? parsed.data._seconds;
  if (seconds === undefined) return null;
  const nanoseconds = parsed.data.nanoseconds ?? parsed.data._nanoseconds ?? 0;
  const date = new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000));
  return Number.isNaN(date.getTime()) ? null : date;
}
