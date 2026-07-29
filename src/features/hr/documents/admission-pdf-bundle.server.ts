import {
  composeDocumentPackage,
} from "@/features/hr/documents/document-pdf-composer.server";
import type {
  DocumentPackageParty,
} from "@/features/hr/documents/document-package-manifest";

export type AdmissionPdfBundleComponent = {
  id: string;
  name: string;
  buffer: Buffer;
  templateId?: string | null;
  templateVersion?: number | null;
  sourceDocxHash?: string | null;
  signatureScope?: "bundle" | "independent";
};

export type AdmissionPdfBundleIndexItem = {
  id: string;
  name: string;
  templateId: string | null;
  templateVersion: number | null;
  startPage: number;
  endPage: number;
  pageCount: number;
};

/**
 * Adaptador de compatibilidade. A composição admissional usa o mesmo motor
 * genérico de recibos, uniformes e documentos avulsos.
 */
export async function buildAdmissionPdfBundle(params: {
  components: AdmissionPdfBundleComponent[];
  /** Mantido apenas para compatibilidade; a marca já pertence ao PDF individual. */
  logoPng: Buffer;
  title: string;
  packageId?: string;
  protocol?: string;
  parties?: DocumentPackageParty[];
  letterheadVersion?: string;
}) {
  void params.logoPng;
  const composed = await composeDocumentPackage({
    packageId: params.packageId ?? "admission-package-local",
    packageType: "admission",
    protocol: params.protocol ?? "ADM-PENDENTE",
    title: params.title,
    parties: params.parties ?? [],
    letterheadVersion: params.letterheadVersion ?? "coala-letterhead-v2",
    components: params.components.map((component) => ({
      componentId: component.id,
      title: component.name,
      buffer: component.buffer,
      templateId: component.templateId,
      templateVersion: component.templateVersion,
      sourceDocxHash: component.sourceDocxHash,
      signatureScope: component.signatureScope === "independent"
        ? "standalone"
        : "bundle",
    })),
  });
  const index: AdmissionPdfBundleIndexItem[] = composed.manifest.components.map(
    (component) => ({
      id: component.componentId,
      name: component.title,
      templateId: component.templateId === "unknown" ? null : component.templateId,
      templateVersion: component.templateVersion,
      startPage: component.startPage,
      endPage: component.endPage,
      pageCount: component.endPage - component.startPage + 1,
    }),
  );
  return {
    ...composed,
    index,
  };
}
