export const PROFILE_COMPLIANCE_POLICY_VERSION = 1 as const;

export const PROFILE_COMPLIANCE_REQUIRED_FIELDS = [
  "birth_date",
  "access_email",
  "mobile_phone",
  "pix_key_type",
  "pix_key",
  "address_zipcode",
  "address_street",
  "address_number",
  "address_neighborhood",
  "address_city",
  "address_state",
  "emergency_name",
  "emergency_relation",
  "emergency_phone",
] as const;

export type ProfileComplianceField = typeof PROFILE_COMPLIANCE_REQUIRED_FIELDS[number];
export type ProfileComplianceStatus = "pending" | "complete" | "overdue";

export type ProfileComplianceFormValues = {
  birthDate: string;
  accessEmail: string;
  mobilePhone: string;
  pixKeyType: string;
  pixKey: string;
  addressZipcode: string;
  addressStreet: string;
  addressNumber: string;
  addressNoNumber: boolean;
  addressNeighborhood: string;
  addressCity: string;
  addressState: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
};

export type ProfileComplianceResult = {
  status: ProfileComplianceStatus;
  policyVersion: typeof PROFILE_COMPLIANCE_POLICY_VERSION;
  missingFields: ProfileComplianceField[];
  invalidFields: ProfileComplianceField[];
  complete: boolean;
};

export function profileReviewCycle(date = new Date()) {
  // Belém não adota horário de verão: meia-noite local corresponde a 03:00 UTC.
  const belemLocal = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const year = belemLocal.getUTCFullYear();
  const quarterStartMonth = Math.floor(belemLocal.getUTCMonth() / 3) * 3;
  const currentStart = new Date(Date.UTC(year, quarterStartMonth, 1, 3, 0, 0, 0));
  const nextStart = new Date(Date.UTC(year, quarterStartMonth + 3, 1, 3, 0, 0, 0));
  return { currentStart, nextStart };
}

export function isProfileReviewDue(lastConfirmedAt: unknown, date = new Date()) {
  const confirmed = dateValue(lastConfirmedAt);
  return !confirmed || confirmed.getTime() < profileReviewCycle(date).currentStart.getTime();
}

type FieldValue = {
  value_text?: unknown;
  value_date?: unknown;
  value_boolean?: unknown;
  value_json?: unknown;
};

export type ProfileComplianceInput = {
  user: {
    email?: unknown;
    phone?: unknown;
    birthDate?: unknown;
    isActive?: unknown;
  };
  fieldValues?: Record<string, FieldValue | undefined>;
  reviewDue?: boolean;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function fieldText(fields: ProfileComplianceInput["fieldValues"], key: string) {
  const field = fields?.[key];
  return text(field?.value_text)
    || (typeof field?.value_json === "string" ? text(field.value_json) : "");
}

function dateValue(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value && typeof value === "object") {
    const record = value as { toDate?: unknown; seconds?: unknown; _seconds?: unknown };
    if (typeof record.toDate === "function") return (record.toDate as () => Date)();
    const seconds = Number(record.seconds ?? record._seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  return null;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function isMobilePhone(value: string) {
  const digits = phoneDigits(value);
  return digits.length === 11 && digits[2] === "9";
}

function isEmergencyPhone(value: string) {
  const digits = phoneDigits(value);
  return digits.length === 10 || digits.length === 11;
}

function isBirthDate(value: unknown) {
  const date = dateValue(value);
  if (!date) return false;
  const now = new Date();
  return date.getTime() < now.getTime() && date.getFullYear() >= 1900;
}

function isPixKey(type: string, value: string) {
  const digits = value.replace(/\D/g, "");
  if (type === "cpf") return digits.length === 11;
  if (type === "cnpj") return digits.length === 14;
  if (type === "phone") return isMobilePhone(value);
  if (type === "email") return isEmail(value);
  if (type === "random") return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
  return false;
}

export function evaluateProfileCompliance(input: ProfileComplianceInput): ProfileComplianceResult {
  const fields = input.fieldValues ?? {};
  const values: Record<ProfileComplianceField, unknown> = {
    birth_date: input.user.birthDate ?? fields["employee.birth_date"]?.value_date,
    access_email: text(input.user.email),
    mobile_phone: text(input.user.phone) || fieldText(fields, "employee.phone"),
    pix_key_type: fieldText(fields, "employee.pix_key_type"),
    pix_key: fieldText(fields, "employee.pix_key"),
    address_zipcode: fieldText(fields, "employee.address_zipcode"),
    address_street: fieldText(fields, "employee.address_street"),
    address_number: fields["employee.address_no_number"]?.value_boolean === true
      ? "S/N"
      : fieldText(fields, "employee.address_number"),
    address_neighborhood: fieldText(fields, "employee.address_neighborhood"),
    address_city: fieldText(fields, "employee.city"),
    address_state: fieldText(fields, "employee.state"),
    emergency_name: fieldText(fields, "employee.emergency_name"),
    emergency_relation: fieldText(fields, "employee.emergency_relation"),
    emergency_phone: fieldText(fields, "employee.emergency_phone"),
  };

  const missingFields = PROFILE_COMPLIANCE_REQUIRED_FIELDS.filter((key) => !values[key]);
  const invalidFields: ProfileComplianceField[] = [];
  if (values.birth_date && !isBirthDate(values.birth_date)) invalidFields.push("birth_date");
  if (values.access_email && !isEmail(String(values.access_email))) invalidFields.push("access_email");
  if (values.mobile_phone && !isMobilePhone(String(values.mobile_phone))) invalidFields.push("mobile_phone");
  const pixType = String(values.pix_key_type ?? "").toLowerCase();
  if (values.pix_key_type && !["cpf", "cnpj", "phone", "email", "random"].includes(pixType)) invalidFields.push("pix_key_type");
  if (values.pix_key && values.pix_key_type && !isPixKey(pixType, String(values.pix_key))) invalidFields.push("pix_key");
  if (values.address_zipcode && phoneDigits(String(values.address_zipcode)).length !== 8) invalidFields.push("address_zipcode");
  if (values.address_state && !/^[A-Z]{2}$/u.test(String(values.address_state).toUpperCase())) invalidFields.push("address_state");
  if (values.emergency_phone && !isEmergencyPhone(String(values.emergency_phone))) invalidFields.push("emergency_phone");

  const complete = missingFields.length === 0 && invalidFields.length === 0;
  return {
    status: complete ? (input.reviewDue ? "overdue" : "complete") : "pending",
    policyVersion: PROFILE_COMPLIANCE_POLICY_VERSION,
    missingFields,
    invalidFields,
    complete,
  };
}
