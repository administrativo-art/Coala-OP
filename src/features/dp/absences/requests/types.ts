import type { DPAbsenceColor, DPAbsencePolicy, DPAbsenceRequestUnit } from '@/types';

export type AbsenceRequestOption = {
  id: string;
  name: string;
  units: DPAbsenceRequestUnit[];
  calculation: DPAbsencePolicy['calculation'];
  validFrom: string;
  validTo: string | null;
  color: DPAbsenceColor;
  origin?: 'collaborator' | 'manager' | 'dp';
};

export type AbsencePreviewPending =
  | 'historical_profile_unverified'
  | 'overlaps_unverified'
  | 'accumulated_balance_unverified'
  | 'scheduled_workdays_unavailable'
  | 'hour_schedule_unverified'
  | 'document_required'
  | 'approval_and_submission_unavailable';

export type PublicAbsenceRule = Pick<DPAbsencePolicy,
  'id' | 'name' | 'calculation' | 'maxUnitsPerRequest' | 'maxUnitsPerPeriod' | 'limitPeriod'
  | 'minimumNoticeDays' | 'maximumRetroactiveDays' | 'attachment' | 'approvalFlow' | 'instructions'>;

export type AbsenceRequestPreview = {
  previewOnly: true;
  canSubmit: false;
  source: 'coala' | 'coala-rh';
  absenceType: { id: string; name: string; lineageId: string; version: number; validFrom: string; validTo: string | null };
  rule: { id: string; name: string; snapshot: PublicAbsenceRule };
  period: { startDate: string; endDate: string; startTime: string | null; endTime: string | null };
  quantity: { value: number | null; unit: DPAbsenceRequestUnit; calculation: DPAbsencePolicy['calculation'] };
  approvalFlow: DPAbsencePolicy['approvalFlow'];
  attachmentRequired: boolean;
  instructions: string | null;
  limits: {
    maxUnitsPerRequest: number | null;
    maxUnitsPerPeriod: number | null;
    limitPeriod: DPAbsencePolicy['limitPeriod'] | null;
    remaining: null;
    minimumNoticeDays: number | null;
    maximumRetroactiveDays: number | null;
  };
  pending: AbsencePreviewPending[];
};
