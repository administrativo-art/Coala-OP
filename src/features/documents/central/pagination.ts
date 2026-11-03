import { z } from "zod";

const schema = z.object({ batch: z.string().min(1).max(256).regex(/^[^/]+$/), item: z.string().min(1).max(256).regex(/^[^/]+$/).optional() }).strict();
export type UploadCursor = z.infer<typeof schema>;
export function encodeUploadCursor(value: UploadCursor) {
  return Buffer.from(JSON.stringify(schema.parse(value))).toString("base64url");
}
export function decodeUploadCursor(value?: string): UploadCursor | null {
  if (!value) return null;
  if (value.length > 1500) throw new Error("Cursor inválido.");
  return schema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
}
