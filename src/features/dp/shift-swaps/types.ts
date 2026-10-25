export type ShiftSwapStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'stale';

export type ShiftSwapIdentityEvidence = {
  authenticatedUid: string;
  authenticatedEmail: string | null;
  actorName: string;
  authTime: string | null;
  signInProvider: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  operationId: string;
};

export type ShiftSwapEvent = {
  action: 'submitted' | 'accepted' | 'rejected' | 'cancelled' | 'marked_stale';
  at: string;
  actorUid: string;
  actorName: string;
  declaration: string;
  evidence: ShiftSwapIdentityEvidence;
};

export type ShiftSwapShift = {
  scheduleId: string;
  shiftId: string;
  unitId: string;
  unitName: string;
  date: string;
  startTime: string;
  endTime: string;
  shiftDefinitionId: string | null;
  shiftName: string | null;
  occupantUid: string;
  occupantName: string;
  fingerprint: string;
};

export type ShiftSwapRequest = {
  id: string;
  workspaceId: string;
  status: ShiftSwapStatus;
  version: number;
  requesterUid: string;
  requesterName: string;
  targetUid: string;
  targetName: string;
  participantUids: string[];
  offeredShift: ShiftSwapShift;
  requestedShift: ShiftSwapShift;
  reason: string | null;
  events: ShiftSwapEvent[];
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  viewerActions?: {
    accept: boolean;
    reject: boolean;
    cancel: boolean;
  };
};

export type ShiftSwapOption = Omit<ShiftSwapShift, 'fingerprint'>;
