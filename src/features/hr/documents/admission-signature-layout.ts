import { z } from "zod";

import type { AutentiqueSignerInput } from "@/lib/autentique-core";

export const ADMISSION_SIGNATURE_LAYOUT_VERSION = 1 as const;

export const admissionSignaturePartySchema = z.enum(["employee", "company"]);
export const admissionSignatureElementSchema = z.enum(["SIGNATURE", "INITIALS"]);

export const admissionSignaturePlacementSchema = z.object({
  party: admissionSignaturePartySchema,
  element: admissionSignatureElementSchema,
  page: z.number().int().min(1).max(200),
  x: z.number().finite().min(0).max(100),
  y: z.number().finite().min(0).max(100),
});

export const admissionSignatureLayoutSchema = z.object({
  schemaVersion: z.literal(ADMISSION_SIGNATURE_LAYOUT_VERSION),
  packageHash: z.string().regex(/^[a-f0-9]{64}$/i),
  pageCount: z.number().int().min(1).max(200),
  positions: z.array(admissionSignaturePlacementSchema).min(4).max(500),
}).superRefine((layout, context) => {
  const unique = new Set<string>();
  for (const [index, position] of layout.positions.entries()) {
    if (position.page > layout.pageCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["positions", index, "page"],
        message: "A posição referencia uma página inexistente.",
      });
    }
    const key = `${position.party}:${position.element}:${position.page}`;
    if (unique.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["positions", index],
        message: "Existe mais de um campo do mesmo tipo para o signatário nesta página.",
      });
    }
    unique.add(key);
  }

  for (const party of admissionSignaturePartySchema.options) {
    const signatures = layout.positions.filter(
      (position) => position.party === party && position.element === "SIGNATURE",
    );
    if (signatures.length !== 1 || signatures[0]?.page !== layout.pageCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["positions"],
        message: "Cada signatário precisa ter uma assinatura na última página.",
      });
    }
    for (let page = 1; page <= layout.pageCount; page += 1) {
      if (!layout.positions.some(
        (position) => position.party === party
          && position.element === "INITIALS"
          && position.page === page,
      )) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["positions"],
          message: "Cada signatário precisa ter uma rubrica em todas as páginas.",
        });
        break;
      }
    }
  }
});

export type AdmissionSignatureParty = z.infer<typeof admissionSignaturePartySchema>;
export type AdmissionSignatureElement = z.infer<typeof admissionSignatureElementSchema>;
export type AdmissionSignaturePlacement = z.infer<typeof admissionSignaturePlacementSchema>;
export type AdmissionSignatureLayout = z.infer<typeof admissionSignatureLayoutSchema>;

export type AdmissionSignatureLayoutSigner = {
  party: AdmissionSignatureParty;
  name: string;
  email: string;
};

export type AdmissionSignatureParticipant = AdmissionSignatureLayoutSigner & {
  providerSignatureId: string;
  status: "sent" | "viewed" | "signed" | "rejected" | "delivery_failed";
  invitedAt: string | null;
  emailSentAt: string | null;
  emailDeliveredAt: string | null;
  emailOpenedAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  rejectedAt: string | null;
  lastResentAt?: string | null;
  resendCount?: number;
  signatureLinkGeneratedAt?: string | null;
  lastIp?: string | null;
  lastPort?: number | null;
};

export type AdmissionSignaturePackageState = {
  status: string;
  packageHash: string | null;
  pageCount: number | null;
  placementReady: boolean;
  layout: AdmissionSignatureLayout | null;
  signers: AdmissionSignatureLayoutSigner[];
  participants: AdmissionSignatureParticipant[];
};

function roundedCoordinate(value: number) {
  return Math.round(value * 10) / 10;
}

export function defaultAdmissionSignatureLayout(params: {
  packageHash: string;
  pageCount: number;
}): AdmissionSignatureLayout {
  const positions: AdmissionSignaturePlacement[] = [];
  for (let page = 1; page <= params.pageCount; page += 1) {
    positions.push(
      { party: "employee", element: "INITIALS", page, x: 5, y: 79 },
      { party: "company", element: "INITIALS", page, x: 82, y: 79 },
    );
  }
  positions.push(
    { party: "employee", element: "SIGNATURE", page: params.pageCount, x: 16, y: 84 },
    { party: "company", element: "SIGNATURE", page: params.pageCount, x: 62, y: 84 },
  );
  return admissionSignatureLayoutSchema.parse({
    schemaVersion: ADMISSION_SIGNATURE_LAYOUT_VERSION,
    packageHash: params.packageHash,
    pageCount: params.pageCount,
    positions,
  });
}

export function normalizeAdmissionSignatureLayout(value: unknown) {
  const parsed = admissionSignatureLayoutSchema.parse(value);
  return {
    ...parsed,
    positions: parsed.positions.map((position) => ({
      ...position,
      x: roundedCoordinate(position.x),
      y: roundedCoordinate(position.y),
    })),
  } satisfies AdmissionSignatureLayout;
}

export function autentiquePositionsForParty(
  layout: AdmissionSignatureLayout,
  party: AdmissionSignatureParty,
): NonNullable<AutentiqueSignerInput["positions"]> {
  return layout.positions
    .filter((position) => position.party === party)
    .sort((left, right) => left.page - right.page || left.element.localeCompare(right.element))
    .map((position) => ({
      x: roundedCoordinate(position.x).toFixed(1),
      y: roundedCoordinate(position.y).toFixed(1),
      z: position.page,
      element: position.element,
    }));
}

export function moveAdmissionSignaturePlacement(params: {
  layout: AdmissionSignatureLayout;
  party: AdmissionSignatureParty;
  element: AdmissionSignatureElement;
  page: number;
  x: number;
  y: number;
  repeatInitials?: boolean;
}) {
  const next = params.layout.positions.map((position) => {
    const matches = position.party === params.party
      && position.element === params.element
      && (position.page === params.page
        || (params.element === "INITIALS" && params.repeatInitials));
    return matches
      ? { ...position, x: roundedCoordinate(params.x), y: roundedCoordinate(params.y) }
      : position;
  });
  return normalizeAdmissionSignatureLayout({ ...params.layout, positions: next });
}
