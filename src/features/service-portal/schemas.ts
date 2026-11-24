import { z } from 'zod';

const id = z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/);
const name = z.string().trim().min(2).max(160);
const requestId = z.string().uuid();
export const portalPasswordSchema = z.string().min(12, 'Use uma senha com pelo menos 12 caracteres.').max(128);
export const portalLoginSchema = z.object({ email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()), password: z.string().min(1).max(128) }).strict();
export const portalActivationSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: portalPasswordSchema }).strict();
export const portalManagementSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_office'), name, requestId }).strict(),
  z.object({ action: z.literal('set_office_active'), officeId: id, active: z.boolean() }).strict(),
  z.object({ action: z.literal('invite_member'), officeId: id, name, email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()), requestId }).strict(),
  z.object({ action: z.literal('reissue_invitation'), memberId: id, requestId }).strict(),
  z.object({ action: z.literal('set_member_active'), memberId: id, active: z.boolean() }).strict(),
  z.object({ action: z.literal('grant'), memberId: id, employerUnitId: id, competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), expiresAt: z.string().datetime({ offset: true }), requestId }).strict(),
  z.object({ action: z.literal('revoke_grant'), grantId: id }).strict(),
]);
export type PortalManagementInput = z.infer<typeof portalManagementSchema>;
