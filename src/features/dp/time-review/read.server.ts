import 'server-only';

import { hrDbAdmin } from '@/lib/firebase-rh-admin';

import { toReviewView, type TimeReviewRequest } from './core';

/** Pedidos de revisão do mês de uma pessoa (até 40), para a tela própria e a conferência. O chamador autoriza. */
export async function listReviewRequestsOfPerson(workspaceId: string, employeeUid: string, month: string) {
  const snapshot = await hrDbAdmin.collection('dp_timeReviewRequests').where('workspaceId', '==', workspaceId)
    .where('employeeUid', '==', employeeUid).where('date', '>=', `${month}-01`).where('date', '<=', `${month}-31`)
    .orderBy('date').limit(40).get();
  return snapshot.docs.map((doc) => toReviewView(doc.id, doc.data() as TimeReviewRequest));
}
