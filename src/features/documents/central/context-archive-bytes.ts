import { createHash } from "node:crypto";
import type { ContextFileReference } from "./context-archive-reference";
/** Pure integrity check; readers never mutate either point records or their archive references. */
export function validContextArchiveBytes(bytes: Buffer, reference: Pick<ContextFileReference, "hash" | "size" | "mimeType">) {
  return (!reference.hash || createHash("sha256").update(bytes).digest("hex") === reference.hash)
    && (reference.size === undefined || bytes.byteLength === reference.size)
    && (reference.mimeType !== "application/pdf" || bytes.subarray(0, 4).toString() === "%PDF")
    && (reference.mimeType !== "application/zip" || bytes.subarray(0, 4).toString("hex") === "504b0304");
}
