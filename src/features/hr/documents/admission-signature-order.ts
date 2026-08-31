export const ADMISSION_SIGNATURE_TEMPLATE_ORDER = [
  "system-admission-employment-probation-contract",
  "system-admission-hours-bank-agreement",
  "system-admission-lgpd-awareness-term",
  "system-admission-image-voice-consent",
  "system-admission-goals-awards-policy",
  "system-admission-transportation-voucher-request",
  "system-admission-transportation-voucher-waiver",
  "system-admission-confidentiality-agreement",
  "system-admission-bundle-closing-term",
] as const;

export const ADMISSION_TRANSPORT_VOUCHER_REQUEST_TEMPLATE_ID =
  "system-admission-transportation-voucher-request";
export const ADMISSION_TRANSPORT_VOUCHER_WAIVER_TEMPLATE_ID =
  "system-admission-transportation-voucher-waiver";
export const ADMISSION_BUNDLE_CLOSING_TEMPLATE_ID =
  "system-admission-bundle-closing-term";

type AdmissionSignatureOrderItem = {
  id?: unknown;
  templateId?: unknown;
  order?: unknown;
  name?: unknown;
  templateName?: unknown;
};

const officialOrder = new Map<string, number>(
  ADMISSION_SIGNATURE_TEMPLATE_ORDER.map((templateId, index) => [templateId, index]),
);

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function finiteOrder(value: unknown) {
  if (value === null || value === undefined || value === "") return Number.MAX_SAFE_INTEGER;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function templateId(item: AdmissionSignatureOrderItem) {
  return text(item.templateId) || text(item.id);
}

export function admissionTransportVoucherTemplateId(answer: unknown) {
  if (answer === true || answer === "yes") {
    return ADMISSION_TRANSPORT_VOUCHER_REQUEST_TEMPLATE_ID;
  }
  if (answer === false || answer === "no") {
    return ADMISSION_TRANSPORT_VOUCHER_WAIVER_TEMPLATE_ID;
  }
  return null;
}

export function isAdmissionSignatureTemplateApplicable(
  item: Pick<AdmissionSignatureOrderItem, "id" | "templateId">,
  transportVoucherAnswer: unknown,
) {
  const id = templateId(item);
  if (
    id !== ADMISSION_TRANSPORT_VOUCHER_REQUEST_TEMPLATE_ID
    && id !== ADMISSION_TRANSPORT_VOUCHER_WAIVER_TEMPLATE_ID
  ) {
    return true;
  }
  return id === admissionTransportVoucherTemplateId(transportVoucherAnswer);
}

export function admissionSignaturePackageTemplateIds(
  transportVoucherAnswer: unknown,
) {
  return ADMISSION_SIGNATURE_TEMPLATE_ORDER.filter(
    (id) =>
      id !== ADMISSION_BUNDLE_CLOSING_TEMPLATE_ID
      && isAdmissionSignatureTemplateApplicable(
        { id },
        transportVoucherAnswer,
      ),
  );
}

export function isCompleteAdmissionSignaturePackage(
  templateIds: readonly string[],
  transportVoucherAnswer: unknown,
) {
  const expected = admissionSignaturePackageTemplateIds(
    transportVoucherAnswer,
  );
  const received = new Set(templateIds);
  return received.size === expected.length
    && expected.every((id) => received.has(id));
}

/**
 * Keeps the preparation list, persisted workflow and composed admission PDF on
 * the same canonical sequence. Non-system templates follow their saved order.
 */
export function compareAdmissionSignatureOrder(
  left: AdmissionSignatureOrderItem,
  right: AdmissionSignatureOrderItem,
) {
  const leftTemplateId = templateId(left);
  const rightTemplateId = templateId(right);
  const leftOfficialOrder = officialOrder.get(leftTemplateId);
  const rightOfficialOrder = officialOrder.get(rightTemplateId);

  if (leftOfficialOrder !== undefined || rightOfficialOrder !== undefined) {
    if (leftOfficialOrder === undefined) return 1;
    if (rightOfficialOrder === undefined) return -1;
    if (leftOfficialOrder !== rightOfficialOrder) return leftOfficialOrder - rightOfficialOrder;
  }

  const savedOrderDifference = finiteOrder(left.order) - finiteOrder(right.order);
  if (savedOrderDifference) return savedOrderDifference;

  const leftName = text(left.name) || text(left.templateName);
  const rightName = text(right.name) || text(right.templateName);
  return leftName.localeCompare(rightName, "pt-BR")
    || leftTemplateId.localeCompare(rightTemplateId, "pt-BR");
}
