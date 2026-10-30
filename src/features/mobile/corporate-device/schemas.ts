import { z } from 'zod';

export const corporateDeviceRequestSchema = z.object({
  installationId: z.string().uuid(),
  deviceKeyId: z.string().regex(/^[a-f0-9]{64}$/),
  devicePublicKey: z.string().min(100).max(2_000),
  keySecurity: z.enum(['tee', 'strongbox']),
  appVersion: z.string().trim().min(1).max(32),
  model: z.string().trim().min(1).max(100),
  androidVersion: z.string().trim().min(1).max(32),
}).strict();

export const corporateDeviceDecisionSchema = z.object({
  deviceId: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(['approve', 'reject', 'suspend', 'revoke']),
}).strict();

export type CorporateDeviceRequestInput = z.infer<typeof corporateDeviceRequestSchema>;
export type CorporateDeviceDecisionInput = z.infer<typeof corporateDeviceDecisionSchema>;
