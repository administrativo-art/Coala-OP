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
  const token = await params.user.getIdToken();
  const formData = new FormData();
  formData.set("kind", params.kind);
  formData.set("targetId", params.targetId);
  formData.set("file", params.file);

  const response = await fetch("/api/uploads/operations", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Falha ao enviar arquivo.");
  }

  return payload as { url: string; path: string };
}
