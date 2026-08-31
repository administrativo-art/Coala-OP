import "server-only";

import {
  AUTENTIQUE_GRAPHQL_URL,
  buildCreateSignatureLinkMutation,
  buildCreateDocumentMutation,
  buildDeleteSignerMutation,
  buildResendSignaturesMutation,
  type AutentiqueSignerInput,
} from "@/lib/autentique-core";

function mimeTypeFor(fileName: string) {
  if (fileName.toLowerCase().endsWith(".pdf")) return "application/pdf";
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

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
    email_events?: {
      sent: string | null;
      opened: string | null;
      delivered: string | null;
      refused: string | null;
      reason: string | null;
    } | null;
    viewed?: AutentiqueSignatureEvent | null;
    signed?: AutentiqueSignatureEvent | null;
    rejected?: AutentiqueSignatureEvent | null;
  }>;
};

export type AutentiqueSignatureEvent = {
  ip: string | null;
  port: number | null;
  reason: string | null;
  created_at: string | null;
};

export type AutentiqueDocumentSignatures = {
  id: string;
  signedUrl: string | null;
  signaturesCount: number;
  signedCount: number;
  completed: boolean;
  signatures: AutentiqueCreatedDocument["signatures"];
};

async function autentiqueGraphql<T>(query: string, variables: Record<string, unknown>) {
  const token = process.env.AUTENTIQUE_API_TOKEN?.trim();
  if (!token) throw new Error("AUTENTIQUE_API_TOKEN não configurado.");
  const response = await fetch(AUTENTIQUE_GRAPHQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as {
    data?: T;
    errors?: GraphqlError[];
  } | null;
  if (!response.ok || payload?.errors?.length || !payload?.data) {
    const detail = payload?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(detail || `Não foi possível acessar a Autentique (HTTP ${response.status}).`);
  }
  return payload.data;
}

export async function getAutentiqueDocumentSignatures(documentId: string) {
  const query = `query DocumentSignatures($id: UUID!) {
    document(id: $id) {
      id
      signatures_count
      signed_count
      files { signed }
      signatures {
        public_id
        name
        email
        created_at
        action { name }
        link { short_link }
        user { id name email }
        email_events { sent opened delivered refused reason }
        viewed { ...SignatureEvent }
        signed { ...SignatureEvent }
        rejected { ...SignatureEvent }
      }
    }
  }
  fragment SignatureEvent on Event {
    ip
    port
    reason
    created_at
  }`;
  const data = await autentiqueGraphql<{
    document?: {
      id: string;
      signatures_count?: number;
      signed_count?: number;
      files?: { signed?: string | null };
      signatures?: AutentiqueCreatedDocument["signatures"];
    };
  }>(query, { id: documentId });
  if (!data.document) throw new Error("Documento não encontrado no Autentique.");
  const signaturesCount = Number(data.document.signatures_count ?? 0);
  const signedCount = Number(data.document.signed_count ?? 0);
  const signedUrl = data.document.files?.signed ?? null;
  return {
    id: data.document.id,
    signedUrl,
    signaturesCount,
    signedCount,
    completed: Boolean(signedUrl) && signedCount >= Math.max(signaturesCount, 1),
    signatures: data.document.signatures ?? [],
  } satisfies AutentiqueDocumentSignatures;
}

export async function addAutentiqueSigner(params: {
  documentId: string;
  signer: AutentiqueSignerInput;
}) {
  if (!params.signer.email && !params.signer.phone && !params.signer.name) {
    throw new Error("O novo signatário precisa de e-mail, telefone ou nome.");
  }
  const mutation = `mutation AddSigner($document_id: UUID!, $signer: SignerInput) {
    createSigner(document_id: $document_id, signer: $signer) {
      public_id
      name
      email
      created_at
      action { name }
      link { short_link }
      user { id name email }
    }
  }`;
  const data = await autentiqueGraphql<{
    createSigner?: AutentiqueCreatedDocument["signatures"][number];
  }>(mutation, {
    document_id: params.documentId,
    signer: {
      ...(params.signer.email ? { email: params.signer.email } : {}),
      ...(params.signer.name ? { name: params.signer.name } : {}),
      ...(params.signer.phone ? { phone: params.signer.phone } : {}),
      ...(params.signer.deliveryMethod ? { delivery_method: params.signer.deliveryMethod } : {}),
      action: params.signer.action ?? "SIGN",
      ...(params.signer.positions?.length ? { positions: params.signer.positions } : {}),
    },
  });
  if (!data.createSigner) throw new Error("O Autentique não confirmou o novo signatário.");
  return data.createSigner;
}

export async function resendAutentiqueSignatures(publicIds: string[]) {
  if (!publicIds.length) throw new Error("Informe ao menos uma assinatura para reenviar.");
  const data = await autentiqueGraphql<{ resendSignatures?: boolean }>(
    buildResendSignaturesMutation(),
    { public_ids: publicIds },
  );
  if (data.resendSignatures !== true) {
    throw new Error("O Autentique não confirmou o reenvio da assinatura.");
  }
}

export async function createAutentiqueSignatureLink(publicId: string) {
  const data = await autentiqueGraphql<{
    createLinkToSignature?: { short_link?: string | null };
  }>(buildCreateSignatureLinkMutation(), { public_id: publicId });
  const shortLink = data.createLinkToSignature?.short_link?.trim();
  if (!shortLink) throw new Error("O Autentique não retornou o link de assinatura.");
  return shortLink;
}

export async function deleteAutentiqueSigner(params: {
  documentId: string;
  publicId: string;
}) {
  const data = await autentiqueGraphql<{ deleteSigner?: boolean }>(
    buildDeleteSignerMutation(),
    { public_id: params.publicId, document_id: params.documentId },
  );
  if (data.deleteSigner !== true) {
    throw new Error("O Autentique não confirmou a remoção do signatário anterior.");
  }
}

export function autentiqueSandboxEnabled() {
  const productionExplicitlyEnabled =
    process.env.AUTENTIQUE_SANDBOX === "false" &&
    process.env.AUTENTIQUE_ALLOW_PRODUCTION === "true";
  return !productionExplicitlyEnabled;
}

export async function getAutentiqueDocumentStatus(documentId: string) {
  const token = process.env.AUTENTIQUE_API_TOKEN?.trim();
  if (!token) throw new Error("AUTENTIQUE_API_TOKEN não configurado.");
  const query = `query DocumentStatus($id: UUID!) {
    document(id: $id) {
      id
      signatures_count
      signed_count
      files { signed }
    }
  }`;
  const response = await fetch(AUTENTIQUE_GRAPHQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { id: documentId } }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as { data?: { document?: { id: string; signatures_count?: number; signed_count?: number; files?: { signed?: string | null } } }; errors?: GraphqlError[] } | null;
  if (!response.ok || payload?.errors?.length || !payload?.data?.document) {
    const detail = payload?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(detail || `Não foi possível consultar a Autentique (HTTP ${response.status}).`);
  }
  const document = payload.data.document;
  return {
    id: document.id,
    signaturesCount: Number(document.signatures_count ?? 0),
    signedCount: Number(document.signed_count ?? 0),
    signedUrl: document.files?.signed ?? null,
    completed: Boolean(document.files?.signed) && Number(document.signed_count ?? 0) >= Number(document.signatures_count ?? 1),
  };
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
  if (params.signers.some((signer) => !signer.email && !signer.phone && !signer.name)) {
    throw new Error("Todo signatário precisa de e-mail, telefone ou nome.");
  }

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
          ...(signer.email ? { email: signer.email } : {}),
          ...(signer.name ? { name: signer.name } : {}),
          ...(signer.phone ? { phone: signer.phone } : {}),
          ...(signer.deliveryMethod ? { delivery_method: signer.deliveryMethod } : {}),
          action: signer.action ?? "SIGN",
          ...(signer.cpf ? { configs: { cpf: signer.cpf } } : {}),
          ...(signer.requireSmsVerificationPhone
            ? { security_verifications: [{ type: "SMS", verify_phone: signer.requireSmsVerificationPhone }] }
            : {}),
          ...(signer.positions?.length ? { positions: signer.positions } : {}),
        })),
        file: null,
      },
    })
  );
  form.append("map", JSON.stringify({ file: ["variables.file"] }));
  form.append(
    "file",
    new Blob([new Uint8Array(params.buffer)], { type: mimeTypeFor(params.fileName) }),
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
