import type { OnboardingDocument } from "@/types";

export type OnboardingDocumentPreviewKind = "image" | "pdf" | "unknown";

function decodedPath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function onboardingDocumentPreviewKind(
  document: Pick<OnboardingDocument, "filePath" | "fileUrl">,
): OnboardingDocumentPreviewKind {
  const candidates = [document.filePath, document.fileUrl]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(value => decodedPath(value).split(/[?#]/, 1)[0]?.toLowerCase() ?? "");

  if (candidates.some(value => /\.(?:jpe?g|png)$/.test(value))) return "image";
  if (candidates.some(value => /\.pdf$/.test(value))) return "pdf";
  return "unknown";
}
