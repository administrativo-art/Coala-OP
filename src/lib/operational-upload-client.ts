import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

export type OperationalUploadKind =
  | "reposition-signature"
  | "dispatch-document"
  | "purchase-receipt";

type TokenProvider = {
  getIdToken: () => Promise<string>;
};

export async function dataUrlToFile(dataUrl: string, fileName: string) {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("Arquivo local inválido.");
  const blob = await response.blob();
  return new File([blob], fileName, {
    type: blob.type || "application/octet-stream",
  });
}

export async function uploadOperationalFile(params: {
  user: TokenProvider;
  kind: OperationalUploadKind;
  targetId: string;
  file: File;
}) {
  const formData = new FormData();
  formData.set("kind", params.kind);
  formData.set("targetId", params.targetId);
  formData.set("file", params.file);

  return authenticatedApiRequest<{ url: string; path: string }>(
    "/api/uploads/operations",
    {
      method: "POST",
      getIdToken: params.user.getIdToken,
      body: formData,
      fallbackError: "Falha ao enviar arquivo.",
    }
  );
}
