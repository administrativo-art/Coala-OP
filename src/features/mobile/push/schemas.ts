import { z } from 'zod';

export const installationIdSchema = z.string().uuid();
export const registerPushDeviceSchema = z.object({
  installationId: installationIdSchema,
  token: z.string().min(64).max(4096).regex(/^\S+$/),
  packageName: z.enum(['coalaone.go', 'coalaone.go.debug']),
  permissionGranted: z.literal(true),
  appVersion: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9._+-]+$/).optional(),
}).strict();
export const removePushDeviceSchema = z.object({ installationId: installationIdSchema }).strict();
export type RegisterPushDeviceInput = z.infer<typeof registerPushDeviceSchema>;
export type RemovePushDeviceInput = z.infer<typeof removePushDeviceSchema>;

export const pushDeliverySchema = z.object({
  workspaceId: z.string().min(1), recipientUid: z.string().min(1), eventId: z.string().uuid(),
  path: z.string().max(300),
}).strict();

export function safePushPath(path: string) {
  if (path.startsWith('//') || path.includes('\\') || path.includes('?') || path.includes('#') || path.includes('%')) return false;
  return /^\/dashboard(?:\/collaborator(?:\/requests(?:\/[A-Za-z0-9_-]+)?)?|\/dp(?:\/(?:collaborators|requests)(?:\/[A-Za-z0-9_-]+)?)?)?$/.test(path);
}
