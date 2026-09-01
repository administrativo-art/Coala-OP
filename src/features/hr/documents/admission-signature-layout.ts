import { z } from "zod";

import type { AutentiqueSignerInput } from "@/lib/autentique-core";

export const ADMISSION_SIGNATURE_LAYOUT_VERSION = 1 as const;

export const admissionSignaturePartySchema = z.enum(["employee", "company"]);
export const admissionSignatureElementSchema = z.enum(["SIGNATURE", "INITIALS"]);

export const ADMISSION_INITIALS_X = {
  employee: 68,
  company: 84,
} as const;

function legacyPlacementId(position: {
  party: z.infer<typeof admissionSignaturePartySchema>;
  element: z.infer<typeof admissionSignatureElementSchema>;
  page: number;
}) {
  return `${position.party}_${position.element.toLowerCase()}_p${position.page}`;
}

export const admissionSignaturePlacementSchema = z.object({
  id: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  party: admissionSignaturePartySchema,
  element: admissionSignatureElementSchema,
  page: z.number().int().min(1).max(200),
  x: z.number().finite().min(0).max(100),
  y: z.number().finite().min(0).max(100),
}).transform((position) => ({
  ...position,
  id: position.id ?? legacyPlacementId(position),
}));

export const admissionSignatureLayoutSchema = z.object({
  schemaVersion: z.literal(ADMISSION_SIGNATURE_LAYOUT_VERSION),
  packageHash: z.string().regex(/^[a-f0-9]{64}$/i),
  pageCount: z.number().int().min(1).max(200),
  positions: z.array(admissionSignaturePlacementSchema).min(2).max(500),
}).superRefine((layout, context) => {
  const uniqueIds = new Set<string>();
  const uniqueInitials = new Set<string>();
  for (const [index, position] of layout.positions.entries()) {
    if (position.page > layout.pageCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["positions", index, "page"],
        message: "A posição referencia uma página inexistente.",
      });
    }
    if (uniqueIds.has(position.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["positions", index, "id"],
        message: "Cada campo de assinatura ou rubrica precisa ter um identificador único.",
      });
    }
    uniqueIds.add(position.id);

    if (position.element === "INITIALS") {
      const key = `${position.party}:${position.page}`;
      if (uniqueInitials.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["positions", index],
          message: "Cada signatário pode ter somente uma rubrica por página.",
        });
      }
      uniqueInitials.add(key);
    }
  }

  for (const party of admissionSignaturePartySchema.options) {
    if (!layout.positions.some(
      (position) => position.party === party && position.element === "SIGNATURE",
    )) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["positions"],
        message: "Cada signatário precisa ter ao menos um campo de assinatura.",
      });
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
  avatarUrl?: string | null;
};

export type AdmissionSignatureParticipant = AdmissionSignatureLayoutSigner & {
  providerSignatureId: string;
  status: "sent" | "viewed" | "signed" | "rejected" | "delivery_failed";
  invitedAt: string | null;
  emailSentAt: string | null;
  emailDeliveredAt: string | null;
  deliveryFailureReason?: string | null;
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

function nextPlacementId(
  layout: AdmissionSignatureLayout,
  party: AdmissionSignatureParty,
  element: AdmissionSignatureElement,
  page: number,
) {
  const base = legacyPlacementId({ party, element, page });
  const ids = new Set(layout.positions.map((position) => position.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

export function defaultAdmissionSignatureLayout(params: {
  packageHash: string;
  pageCount: number;
}): AdmissionSignatureLayout {
  const positions: Array<z.input<typeof admissionSignaturePlacementSchema>> = [];
  for (let page = 1; page <= params.pageCount; page += 1) {
    positions.push(
      { party: "employee", element: "INITIALS", page, x: ADMISSION_INITIALS_X.employee, y: 79 },
      { party: "company", element: "INITIALS", page, x: ADMISSION_INITIALS_X.company, y: 79 },
    );
  }
  positions.push(
    { party: "employee", element: "SIGNATURE", page: params.pageCount, x: 16, y: 84 },
    { party: "company", element: "SIGNATURE", page: params.pageCount, x: 62, y: 84 },
  );
  return normalizeAdmissionSignatureLayout({
    schemaVersion: ADMISSION_SIGNATURE_LAYOUT_VERSION,
    packageHash: params.packageHash,
    pageCount: params.pageCount,
    positions,
  });
}

export function normalizeAdmissionSignatureLayout(value: unknown) {
  const parsed = admissionSignatureLayoutSchema.parse(value);
  const pairedInitialsY = new Map<number, number>();
  for (let page = 1; page <= parsed.pageCount; page += 1) {
    const employee = parsed.positions.find(
      (position) => position.page === page
        && position.party === "employee"
        && position.element === "INITIALS",
    );
    const company = parsed.positions.find(
      (position) => position.page === page
        && position.party === "company"
        && position.element === "INITIALS",
    );
    const y = employee?.y ?? company?.y;
    if (typeof y === "number") pairedInitialsY.set(page, roundedCoordinate(y));
  }
  return {
    ...parsed,
    positions: parsed.positions.map((position) => ({
      ...position,
      x: position.element === "INITIALS"
        ? ADMISSION_INITIALS_X[position.party]
        : roundedCoordinate(position.x),
      y: position.element === "INITIALS"
        ? pairedInitialsY.get(position.page) ?? roundedCoordinate(position.y)
        : roundedCoordinate(position.y),
    })),
  } satisfies AdmissionSignatureLayout;
}

export function autentiquePositionsForParty(
  layout: AdmissionSignatureLayout,
  party: AdmissionSignatureParty,
): NonNullable<AutentiqueSignerInput["positions"]> {
  return layout.positions
    .filter((position) => position.party === party)
    .sort((left, right) => (
      left.page - right.page
      || left.element.localeCompare(right.element)
      || left.id.localeCompare(right.id)
    ))
    .map((position) => ({
      x: roundedCoordinate(position.x).toFixed(1),
      y: roundedCoordinate(position.y).toFixed(1),
      z: position.page,
      element: position.element,
    }));
}

export function moveAdmissionSignaturePlacement(params: {
  layout: AdmissionSignatureLayout;
  placementId: string;
  x: number;
  y: number;
  repeatInitials?: boolean;
}) {
  const selected = params.layout.positions.find((position) => position.id === params.placementId);
  if (!selected) return params.layout;
  const next = params.layout.positions.map((position) => {
    if (selected.element === "INITIALS") {
      const matchesPage = params.repeatInitials || position.page === selected.page;
      if (position.element !== "INITIALS" || !matchesPage) return position;
      return {
        ...position,
        x: ADMISSION_INITIALS_X[position.party],
        y: roundedCoordinate(params.y),
      };
    }
    return position.id === selected.id
      ? { ...position, x: roundedCoordinate(params.x), y: roundedCoordinate(params.y) }
      : position;
  });
  return normalizeAdmissionSignatureLayout({ ...params.layout, positions: next });
}

export function addAdmissionSignaturePlacement(params: {
  layout: AdmissionSignatureLayout;
  party: AdmissionSignatureParty;
  element: AdmissionSignatureElement;
  page: number;
}) {
  if (
    params.element === "INITIALS"
    && params.layout.positions.some((position) => (
      position.party === params.party
      && position.element === "INITIALS"
      && position.page === params.page
    ))
  ) {
    return params.layout;
  }
  const matchingSignatures = params.layout.positions.filter((position) => (
    position.party === params.party
    && position.element === "SIGNATURE"
    && position.page === params.page
  )).length;
  const pairedInitial = params.layout.positions.find((position) => (
    position.element === "INITIALS" && position.page === params.page
  ));
  const position: AdmissionSignaturePlacement = {
    id: nextPlacementId(params.layout, params.party, params.element, params.page),
    party: params.party,
    element: params.element,
    page: params.page,
    x: params.element === "INITIALS"
      ? ADMISSION_INITIALS_X[params.party]
      : params.party === "employee" ? 16 : 62,
    y: params.element === "INITIALS"
      ? pairedInitial?.y ?? 79
      : Math.max(14, 84 - matchingSignatures * 8),
  };
  return normalizeAdmissionSignatureLayout({
    ...params.layout,
    positions: [...params.layout.positions, position],
  });
}

export function canRemoveAdmissionSignaturePlacement(
  layout: AdmissionSignatureLayout,
  placementId: string,
) {
  const selected = layout.positions.find((position) => position.id === placementId);
  if (!selected) return false;
  if (selected.element === "INITIALS") return true;
  return layout.positions.filter((position) => (
    position.party === selected.party && position.element === "SIGNATURE"
  )).length > 1;
}

export function removeAdmissionSignaturePlacement(params: {
  layout: AdmissionSignatureLayout;
  placementId: string;
}) {
  if (!canRemoveAdmissionSignaturePlacement(params.layout, params.placementId)) {
    return params.layout;
  }
  return normalizeAdmissionSignatureLayout({
    ...params.layout,
    positions: params.layout.positions.filter((position) => position.id !== params.placementId),
  });
}
