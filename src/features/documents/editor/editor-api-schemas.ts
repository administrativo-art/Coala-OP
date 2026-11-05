import { z } from "zod";

/**
 * Schemas de fronteira das rotas do editor. Todos `.strict()`: campo estranho é rejeitado e o
 * valor recebido nunca é ecoado na resposta. O conteúdo em si é validado por `parseEditorContent`
 * no store (limites de profundidade, nós e bytes); aqui só se garante que é um objeto.
 */
export const EDITOR_REQUEST_MAX_BYTES = 512 * 1024;

const clientRequestId = z.string().uuid();
const title = z.string().trim().min(1).max(200);
const contentObject = z.record(z.unknown());
const subjectEmployee = z
  .object({ employeeId: z.string().trim().min(1).max(180).refine((id) => !id.includes("/")) })
  .strict();

export const editorDocumentIdSchema = z.string().regex(/^ed_[0-9a-f]{32}$/);

export const editorTemplateIdSchema = z.string().regex(/^tpl_[0-9a-f]{32}$/);
const templateName = z.string().trim().min(1).max(200);
const templateVersion = z.number().int().min(1).max(1_000_000);

export const createEditorTemplateBodySchema = z
  .object({
    clientRequestId,
    name: templateName,
    description: z.string().trim().max(1000).optional(),
    content: contentObject.optional(),
    /** Copia uma versão de documento do editor; o servidor exige que o ator possa abrir o documento. */
    fromDocument: z.object({ documentId: editorDocumentIdSchema, version: templateVersion }).strict().optional(),
  })
  .strict()
  .refine((body) => body.content === undefined || body.fromDocument === undefined, "content e fromDocument são exclusivos");

export const listEditorTemplatesQuerySchema = z
  .object({
    status: z.enum(["draft", "published", "archived"]).optional(),
    limit: z.coerce.number().int().min(1).max(25).optional(),
    cursor: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/).optional(),
  })
  .strict();

export const listEditorDocumentsQuerySchema = z
  .object({
    status: z.enum(["draft", "final"]).optional(),
    limit: z.coerce.number().int().min(1).max(25).optional(),
    cursor: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/).optional(),
  })
  .strict();

export const saveEditorTemplateBodySchema = z
  .object({ expectedVersion: templateVersion, clientRequestId, content: contentObject, name: templateName.optional(), description: z.string().trim().max(1000).optional() })
  .strict();

export const publishEditorTemplateBodySchema = z.object({ clientRequestId, expectedVersion: templateVersion }).strict();
export const archiveEditorTemplateBodySchema = z.object({ clientRequestId, expectedVersion: templateVersion }).strict();

export const useEditorTemplateBodySchema = z
  .object({ clientRequestId, expectedPublishedVersion: templateVersion.optional() })
  .strict();

export const createEditorBodySchema = z
  .object({ clientRequestId, title, content: contentObject.optional() })
  .strict();

export const saveEditorBodySchema = z
  .object({
    expectedContentVersion: z.number().int().min(1).max(1_000_000),
    clientRequestId,
    content: contentObject,
    title: title.optional(),
  })
  .strict();

export const previewEditorBodySchema = z
  .object({ mode: z.enum(["sample", "resolved"]), subject: subjectEmployee.optional() })
  .strict()
  .refine((body) => body.mode === "resolved" || body.subject === undefined, "sample não aceita titular")
  .refine((body) => body.mode === "sample" || body.subject !== undefined, "resolved exige titular");

export const finalizeEditorBodySchema = z
  .object({
    clientRequestId,
    expectedContentVersion: z.number().int().min(1).max(1_000_000),
    subject: subjectEmployee.optional(),
  })
  .strict();

export type ListEditorDocumentsQuery = z.infer<typeof listEditorDocumentsQuerySchema>;
export type CreateEditorBody = z.infer<typeof createEditorBodySchema>;
export type SaveEditorBody = z.infer<typeof saveEditorBodySchema>;
export type PreviewEditorBody = z.infer<typeof previewEditorBodySchema>;
export type FinalizeEditorBody = z.infer<typeof finalizeEditorBodySchema>;
export type CreateEditorTemplateBody = z.infer<typeof createEditorTemplateBodySchema>;
export type ListEditorTemplatesQuery = z.infer<typeof listEditorTemplatesQuerySchema>;
export type SaveEditorTemplateBody = z.infer<typeof saveEditorTemplateBodySchema>;
export type PublishEditorTemplateBody = z.infer<typeof publishEditorTemplateBodySchema>;
export type ArchiveEditorTemplateBody = z.infer<typeof archiveEditorTemplateBodySchema>;
export type UseEditorTemplateBody = z.infer<typeof useEditorTemplateBodySchema>;
