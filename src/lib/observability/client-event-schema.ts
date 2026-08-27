import { z } from "zod";

export const ClientErrorIngestSchema = z.object({
  eventId: z.string().uuid(),
  source: z.enum(["render", "unhandled-rejection", "background"]),
  operation: z.string().min(1).max(160),
  routeOrJob: z.string().min(1).max(300),
  errorName: z.string().min(1).max(200),
  messageSanitized: z.string().min(1).max(2_020),
  stackSanitized: z.string().max(8_020).optional(),
}).strict();

export type ClientErrorIngest = z.infer<typeof ClientErrorIngestSchema>;
