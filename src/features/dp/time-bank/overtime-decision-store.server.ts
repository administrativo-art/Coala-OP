import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { sha256 } from '@/features/dp/time-adjustments/closure-core';

import type { OvertimeDecision, OvertimeDecisions } from './overtime-decision';

/** Um documento por pessoa e competência: leitura por id, sem índice composto, e cópia direta para a versão fechada. */

export type OvertimeDecisionAct = {
  operationId: string; requestHash: string; action: 'decided' | 'revoked'; date: string; by: string; at: string;
  decision: OvertimeDecision | null;
};
export type OvertimeDecisionDocument = {
  schemaVersion: 1; workspaceId: string; competence: string; employeeUid: string;
  /** Unidades dos dias decididos e quem decidiu: base da consulta por pessoa. */
  unitIds: string[]; actorUids: string[];
  revision: number; days: OvertimeDecisions; history: OvertimeDecisionAct[]; updatedAt: string;
};

export const overtimeDecisionRef = (db: Firestore, workspaceId: string, competence: string, employeeUid: string) =>
  db.collection('dp_timeOvertimeDecisions').doc(sha256([workspaceId, competence, employeeUid]));

export async function readOvertimeDecisionDays(db: Firestore, workspaceId: string, competence: string, employeeUid: string): Promise<OvertimeDecisions> {
  const snapshot = await overtimeDecisionRef(db, workspaceId, competence, employeeUid).get();
  return (snapshot.data() as OvertimeDecisionDocument | undefined)?.days ?? {};
}
