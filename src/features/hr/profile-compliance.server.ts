import { resolvePersonLink } from "@/features/hr/lib/person-link.server";
import {
  evaluateProfileCompliance,
  isProfileReviewDue,
  type ProfileComplianceFormValues,
  profileReviewCycle,
} from "@/features/hr/profile-compliance";

const REQUIRED_HR_KEYS = [
  "employee.birth_date",
  "employee.phone",
  "employee.pix_key_type",
  "employee.pix_key",
  "employee.address_zipcode",
  "employee.address_street",
  "employee.address_number",
  "employee.address_no_number",
  "employee.address_neighborhood",
  "employee.city",
  "employee.state",
  "employee.emergency_name",
  "employee.emergency_relation",
  "employee.emergency_phone",
] as const;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function fieldText(fields: Record<string, Record<string, unknown>>, key: string) {
  const value = fields[key];
  return text(value?.value_text)
    || (typeof value?.value_json === "string" ? text(value.value_json) : "");
}

function dateInputValue(value: unknown) {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  } else if (value && typeof value === "object") {
    const candidate = value as { toDate?: unknown; seconds?: unknown; _seconds?: unknown };
    if (typeof candidate.toDate === "function") date = (candidate.toDate as () => Date)();
    else {
      const seconds = Number(candidate.seconds ?? candidate._seconds);
      if (Number.isFinite(seconds)) date = new Date(seconds * 1000);
    }
  }
  return date ? date.toISOString().slice(0, 10) : "";
}

export async function evaluateUserProfileCompliance(userId: string, now = new Date()) {
  const link = await resolvePersonLink(userId);
  if (!link.userDocument?.exists || !link.employeeDocument?.exists) {
    throw new Error("A conta ainda não possui cadastro pessoal padronizado no RH.");
  }
  const user = link.userDocument.data() ?? {};
  const snapshots = await Promise.all(
    REQUIRED_HR_KEYS.map((key) => link.employeeDocument!.ref.collection("field_values").doc(key).get()),
  );
  const fieldValues = Object.fromEntries(
    snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]),
  ) as Record<string, Record<string, unknown>>;
  const compliance = user.profileCompliance && typeof user.profileCompliance === "object"
    ? user.profileCompliance as Record<string, unknown>
    : {};
  const reviewDue = isProfileReviewDue(compliance.lastConfirmedAt, now);
  const result = evaluateProfileCompliance({ user, fieldValues, reviewDue });
  const cycle = profileReviewCycle(now);
  const values: ProfileComplianceFormValues = {
    birthDate: dateInputValue(user.birthDate ?? fieldValues["employee.birth_date"]?.value_date),
    accessEmail: text(user.email).toLowerCase(),
    mobilePhone: text(user.phone) || fieldText(fieldValues, "employee.phone"),
    pixKeyType: fieldText(fieldValues, "employee.pix_key_type"),
    pixKey: fieldText(fieldValues, "employee.pix_key"),
    addressZipcode: fieldText(fieldValues, "employee.address_zipcode"),
    addressStreet: fieldText(fieldValues, "employee.address_street"),
    addressNumber: fieldText(fieldValues, "employee.address_number"),
    addressNoNumber: fieldValues["employee.address_no_number"]?.value_boolean === true,
    addressNeighborhood: fieldText(fieldValues, "employee.address_neighborhood"),
    addressCity: fieldText(fieldValues, "employee.city"),
    addressState: fieldText(fieldValues, "employee.state").toUpperCase(),
    emergencyName: fieldText(fieldValues, "employee.emergency_name"),
    emergencyRelation: fieldText(fieldValues, "employee.emergency_relation"),
    emergencyPhone: fieldText(fieldValues, "employee.emergency_phone"),
  };
  return {
    ...result,
    employeeId: link.employeeDocument.id,
    reviewDue,
    currentReviewStartedAt: cycle.currentStart.toISOString(),
    nextReviewAt: cycle.nextStart.toISOString(),
    values,
  };
}
