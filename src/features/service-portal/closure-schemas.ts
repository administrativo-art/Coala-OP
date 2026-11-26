import { z } from 'zod';

const id = z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const closureReleaseQuerySchema = z.object({ grantId: id }).strict();
export const closureReleaseActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), grantId: id, employeeUid: id, includePayslip: z.boolean() }).strict(),
  z.object({ action: z.literal('release'), grantId: id, employeeUid: id, includePayslip: z.boolean(), requestId: z.string().uuid(), expectedSourceHash: hash, expectedEmploymentProofHash: hash }).strict(),
]);
export const portalClosureQuerySchema = z.object({ grantId: id }).strict();
export const portalClosureAccessSchema = z.object({ grantId: id, releaseId: id, action: z.enum(['open', 'download_payslip']) }).strict();
