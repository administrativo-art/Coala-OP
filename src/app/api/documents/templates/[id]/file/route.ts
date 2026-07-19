import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { extractDocxVariables } from "@/features/hr/documents/docx-generator";
import { assertHrAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { isDocumentVariableKey } from "@/features/hr/integration/document-variables";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
const MAX_BYTES = 10 * 1024 * 1024;
function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await assertHrAccess(request, "manage");
    const { id } = await context.params;
    const reference = dbAdmin.collection("companyDocumentTemplates").doc(id);
    const document = await reference.get();
    if (!document.exists || document.get("deletedAt")) return error("Modelo não encontrado.", 404);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".docx")) return error("Envie um arquivo Word no formato DOCX.");
    if (file.size > MAX_BYTES) return error("O modelo DOCX deve possuir até 10 MB.");
    const buffer = Buffer.from(await file.arrayBuffer());
    let variables: string[];
    try { variables = extractDocxVariables(buffer); } catch { return error("O arquivo DOCX está corrompido ou não é um modelo válido."); }
    const unknownVariables = variables.filter((key) => !isDocumentVariableKey(key) && !["name", "cpf", "birth_date", "relation"].includes(key));
    if (unknownVariables.length) return error(`Variáveis desconhecidas: ${unknownVariables.join(", ")}.`);
    const version = Number(document.get("version") ?? 0) + 1;
    const storagePath = `document-templates/${id}/versions/${String(version).padStart(3, "0")}/template.docx`;
    await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, { resumable: false, metadata: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", cacheControl: "private, no-store", metadata: { templateId: id, version: String(version) } } });
    const now = Timestamp.now();
    const update = { status: "published", version, storagePath, originalName: file.name.slice(0, 180), size: file.size, contentHash: createHash("sha256").update(buffer).digest("hex"), variables, variableContract: "coala-documents-v1", unknownVariables: [], updatedAt: now, updatedBy: access.decoded.uid, updatedByName: access.actorName };
    await reference.update(update);
    return NextResponse.json({ template: { id, ...(serializeHrValue({ ...document.data(), ...update }) as Record<string, unknown>) } });
  } catch (cause) { return error(cause instanceof Error ? cause.message : "Falha ao enviar modelo.", 403); }
}
