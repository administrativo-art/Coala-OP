import type { CoverageMode } from './core';

export type AbsenceCoverageDecision = {
  mode: CoverageMode;
  substituteUid?: string;
  substituteName?: string;
  external?: boolean;
  exceptionReason?: string;
  decidedByName?: string;
  decidedAt: string;
};

export type AbsenceCoverageShift = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  shiftName: string | null;
  decision: AbsenceCoverageDecision | null;
};

export type AbsenceCoverageView = {
  requestId: string;
  beneficiaryUid: string;
  beneficiaryName: string;
  unitId: string;
  unitName: string;
  canDecide: boolean;
  canAssignExternal: boolean;
  shifts: AbsenceCoverageShift[];
};

export type AbsenceCoverageCandidate = {
  uid: string;
  name: string;
  external: boolean;
  originUnitName: string | null;
  eligible: boolean;
  summary: string;
};
