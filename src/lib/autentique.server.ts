import "server-only";

import {
  AUTENTIQUE_GRAPHQL_URL,
  buildCreateDocumentMutation,
  type AutentiqueSignerInput,
} from "@/lib/autentique-core";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type GraphqlError = { message?: string };

export type AutentiqueCreatedDocument = {
  id: string;
  name: string;
  created_at: string;
  signatures: Array<{
    public_id: string;
    name: string | null;
    email: string | null;
    created_at: string;
    action: { name: string } | null;
    link: { short_link: string } | null;
    user: { id: string; name: string; email: string } | null;
  }>;
};

export function autentiqueSandboxEnabled() {
  const productionExplicitlyEnabled =
    process.env.AUTENTIQUE_SANDBOX === "false" &&
    process.env.AUTENTIQUE_ALLOW_PRODUCTION === "true";
  return !productionExplicitlyEnabled;
}

export async function createAutentiqueDocument(params: {
  buffer: Buffer;
  fileName: string;
  documentName: string;
  message?: string | null;
  signers: AutentiqueSignerInput[];
}) {
  const token = process.env.AUTENTIQUE_API_TOKEN?.trim();
  if (!token) throw new Error("AUTENTIQUE_API_TOKEN não configurado.");
  if (!params.signers.length) throw new Error("Informe ao menos um signatário.");

  const sandbox = autentiqueSandboxEnabled();
  const form = new FormData();
  form.append(
    "operations",
    JSON.stringify({
      query: buildCreateDocumentMutation(sandbox),
      variables: {
        document: {
          name: params.documentName,
          message:
            params.message ??
            "Acesse o documento para conferir e realizar a assinatura eletrônica.",
          locale: {
            country: "BR",
            language: "pt-BR",
            timezone: "America/Belem",
            date_format: "DD_MM_YYYY",
          },
        },
        signers: params.signers.map((signer) => ({
          email: signer.email,
          action: signer.action ?? "SIGN",
        })),
        file: null,
      },
    })
  );
  form.append("map", JSON.stringify({ file: ["variables.file"] }));
  form.append(
    "file",
    new Blob([new Uint8Array(params.buffer)], { type: DOCX_MIME }),
    params.fileName
  );

  const response = await fetch(AUTENTIQUE_GRAPHQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | {
        data?: { createDocument?: AutentiqueCreatedDocument };
        errors?: GraphqlError[];
      }
    | null;
  if (!response.ok || payload?.errors?.length || !payload?.data?.createDocument) {
    const detail = payload?.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(
      detail || `Autentique recusou o envio (HTTP ${response.status}).`
    );
  }

  return { document: payload.data.createDocument, sandbox };
}
