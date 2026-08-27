export function isAsoAppointmentAfterAdmission(
  appointmentDate?: string | null,
  expectedAdmissionDate?: string | null,
) {
  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!appointmentDate || !expectedAdmissionDate) return false;
  if (!dateOnlyPattern.test(appointmentDate) || !dateOnlyPattern.test(expectedAdmissionDate)) return false;
  return appointmentDate > expectedAdmissionDate;
}
