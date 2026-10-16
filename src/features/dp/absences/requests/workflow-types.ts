import type { DPAbsencePolicy, DPAbsenceType } from '@/types';
import type { AbsenceRequestPreviewInput } from './schemas';
import type { AbsenceDaySegment } from './reservations';
import type { AbsenceInitiationOrigin } from './beneficiary.server';
import type { AbsenceReviewSla } from './review-sla';

export type AbsenceRequestStatus = 'draft' | 'submitted' | 'in_review' | 'adjustments_requested' | 'approved' | 'rejected' | 'cancelled';
export type AbsenceAttachment = {
  id: string; mime: 'application/pdf' | 'image/jpeg' | 'image/png'; size: number; sha256: string;
  storagePath: string; generation: string; classification: 'sensitive';
  retention: { policy: 'employment_plus_20_years'; source?: 'coala.users.terminationDate';
    sourceVersion?: number | null; sourceDocumentVersion?: number | null;
    terminationDate: string | null; reviewAfter: string | null };
  deletion?: { state: 'pending' | 'removed'; requestedAt: string; completedAt?: string; actorUid: string; reason: string };
};
export type AbsenceRequestRecord = {
  id: string; workspaceId: string; requesterUid: string; beneficiaryUid: string; beneficiaryName?: string | null;
  unitId: string; origin: AbsenceInitiationOrigin;
  status: AbsenceRequestStatus; version: number; revision: number; input: AbsenceRequestPreviewInput;
  startDate: string; endDate: string;
  quantity: number; unit: 'day' | 'hour'; typeId: string; lineageId: string; typeVersion: number;
  typeSnapshot: Pick<DPAbsenceType, 'name' | 'workdayEffect' | 'blocksSchedule' | 'includeInAbsenteeism' | 'validFrom' | 'validTo'>;
  policyId: string; policySnapshot: DPAbsencePolicy; profileFingerprint: string;
  profileReviewRequired: boolean; profileReviewConfirmedBy?: string; profileReviewReason?: string;
  profileReviewConfirmedFingerprint?: string; profileReviewConfirmedRevision?: number;
  attachments: AbsenceAttachment[]; custodianDpUid: string | null;
  segments: AbsenceDaySegment[];
  stage: 'manager' | 'dp' | null; stageIndex: number; assignedReviewerIds: string[];
  reviewSla?: AbsenceReviewSla;
  history: Array<{ action: string; actorUid: string; at: string; reason?: string; version: number }>;
  createdAt: string; updatedAt: string; submittedAt?: string; decidedAt?: string;
  lastOperationId?: string; lastOperationActorUid?: string; lastOperationAction?: string; lastOperationHash?: string;
  operationalFence?: { fenceId: string; requestVersion: number; epoch: string;
    state: 'activation_pending' | 'active' | 'reversal_pending' | 'reversed' };
  operationalPending?: { operationId: string; expectedVersion: number; actionHash: string; actorUid: string };
};

export type AbsenceRequestDto = Pick<AbsenceRequestRecord,
  'id' | 'status' | 'version' | 'revision' | 'input' | 'quantity' | 'unit' | 'typeId' | 'typeVersion' | 'origin'
  | 'stage' | 'createdAt' | 'updatedAt' | 'submittedAt' | 'decidedAt' | 'reviewSla'> & {
    typeName: string; attachmentCount: number; canSubmit: boolean; canReview: boolean;
    beneficiaryUid: string; beneficiaryName: string | null; requesterUid: string; assignedReviewerIds: string[];
    canCancel: boolean; canConfirmProfile: boolean; profileReviewRequired: boolean;
    attachments: Array<Pick<AbsenceAttachment, 'id' | 'mime' | 'size'> & { canRead: boolean }>;
    history: AbsenceRequestRecord['history'];
    operational?: { state: 'preparing' | 'activation_pending' | 'active' | 'reversal_pending' | 'reversed';
      operationallyApplied: boolean; canReconcile: boolean; canAbortPreparation: boolean };
    preflight?: { approvers: Array<{ uid: string; name: string }>; approvalPending: boolean;
      balances: Array<{ period: string; limit: number | null; remaining: number | null }>;
      profileReviewRequired: boolean; approvalSlaHours?: number };
  };
