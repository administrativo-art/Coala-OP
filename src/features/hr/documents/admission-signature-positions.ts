import type { DocumentPackageManifest } from "@/features/hr/documents/document-package-manifest";
import type { AutentiqueSignerInput } from "@/lib/autentique-core";

const CLOSING_TEMPLATE_ID = "system-admission-bundle-closing-term";

export function admissionBundleSignerPositions(
  manifest: Pick<DocumentPackageManifest, "components">,
  party: "employee" | "company",
): NonNullable<AutentiqueSignerInput["positions"]> {
  const closing = manifest.components.find(
    (component) => component.templateId === CLOSING_TEMPLATE_ID,
  );
  if (!closing) {
    throw new Error("O termo final do kit não foi localizado para posicionar as assinaturas.");
  }
  return [{
    x: party === "employee" ? "16.0" : "62.0",
    y: "84.0",
    z: closing.endPage,
    element: "SIGNATURE",
  }];
}
