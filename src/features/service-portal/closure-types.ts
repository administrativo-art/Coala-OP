import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import type { readBankStatementForProvider } from '@/features/dp/time-bank/service.server';
import type { PayrollReadiness } from '@/features/dp/time-bank/payroll-readiness';
import type { PortalPrincipal } from './types';

export type ProviderClosureContent = {
  schemaVersion: 1;
  employee: { uid: string; name: string; cpfMasked?: string };
  employer: { unitId: string; name: string; cnpj: string };
  competence: string; closureVersion: number;
  mirror: { days: Array<{ date: string; punches: Array<{ time: string; state: 'original' | 'discarded' | 'included' }>; pairedMinutes: number | null }> };
  payroll: {
    overtime: Array<{ ratePercent: number; destination: 'payroll' | 'time_bank'; minutes: number; creditFactor: number | null }>;
    absenceEffects: Array<{ date: string; effect: string }>;
    unjustifiedAbsenceDates: string[]; scheduledDays: number; workedDays: number;
    creditMinutes: number; debitMinutes: number; monthBalanceMinutes: number;
    discountMinutes: number; nightMinutes: number; expiredCreditMinutes: number; bankPayrollMinutes: number; payrollOvertimeMinutes: number;
  };
  documents: Array<{ kind: 'payslip'; filename: string; sha256: string }>;
};
export type ClosureReleaseSelection = { grantId: string; employeeUid: string; includePayslip: boolean };
export type ClosureReleaseInput = ClosureReleaseSelection & {
  requestId: string; expectedSourceHash: string; expectedEmploymentProofHash: string;
};
export type ClosureReleasePreview = { content: ProviderClosureContent; sourceHash: string; employmentProofHash: string };
export type ProviderClosureRow = {
  releaseId: string; employeeUid: string; employeeName: string; cpfMasked?: string; closureVersion: number;
  status: 'available' | 'reopened' | 'outdated' | 'employment_changed'; releasedAt: string;
};
export type ClosureAccessInput = { grantId: string; releaseId: string; action: 'open' | 'download_payslip' };
export type ClosureReleaseDependencies = {
  mainDb: Firestore; hrDb: Firestore; now: () => Date; randomId: () => string;
  readStorage?: (storagePath: string) => Promise<Buffer>;
  readStatement: (workspaceId: string, uid: string, competence: string, tx?: Transaction) => ReturnType<typeof readBankStatementForProvider>;
  readReadiness: (context: ServerUserContext, competence: string) => Promise<PayrollReadiness>;
};
export type ProviderClosureRelease = {
  id: string; workspaceId: string; memberId: string; officeId: string; grantId: string;
  employeeUid: string; employerUnitId: string; competence: string; closureVersion: number;
  content: ProviderClosureContent; contentHash: string; sourceHash: string; employmentProofHash: string;
  historyId: string; historyRevision: number; createdAt: string; createdBy: string; requestId: string;
  payslip: { documentId: string; employeeId: string; version: number; storagePath: string; sha256: string } | null;
};
export type ProviderClosureAccess = {
  id: string; workspaceId: string; memberId: string; officeId: string; grantId: string;
  employeeUid: string; releaseId: string; closureVersion: number; updatedAt: string; updatedBy: string;
};
export type PortalClosurePrincipal = PortalPrincipal;
