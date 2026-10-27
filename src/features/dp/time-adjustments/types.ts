/** Formato do pedido de ajuste devolvido pela API (sem o motivo resumido do AEJ, que é interno). */
export type AdjustmentView = {
  id: string; workspaceId: string; employeeUid: string; employeeName: string | null; workDate: string;
  scope?: 'official' | 'pilot';
  kind: 'include' | 'discard' | 'correct'; status: 'in_review' | 'approved' | 'rejected' | 'cancelled'; version: number;
  establishmentId: string; unitId: string;
  target: { receiptId: string; nsr?: number; pilotSequence?: number; markedAt: string; executionUnitId: string } | null;
  inclusion: { markedAt: string; executionUnitId: string } | null;
  operations?: Array<{ kind: 'include' | 'discard' | 'correct';
    target: { receiptId: string; nsr?: number; pilotSequence?: number; markedAt: string; executionUnitId: string } | null;
    inclusion: { markedAt: string; executionUnitId: string } | null }>;
  reason: string;
  acts: Array<{ action: 'requested' | 'approved' | 'rejected' | 'cancelled'; actorUid: string; role: 'titular' | 'reviewer';
    at: string; clockSource: 'hora_legal' | 'server'; reason?: string; previousHash: string | null; hash: string }>;
  createdAt: string; updatedAt: string; decidedAt?: string; decidedBy?: string;
};

export type TreatmentView = { id: string; adjustmentId: string; workDate: string; type: 'discard' | 'inclusion';
  originalReceiptId: string | null; markedAt: string | null; executionUnitId: string | null };

export type MarkingClassificationRequestView = {
  id: string; employeeId: string; employeeName: string | null; receiptId: string; workDate: string;
  markedAt: string; nsr: number; unitId: string; closureVersion: number; version: number;
  requestedPurpose: 'journey_start' | 'break_start' | 'break_end' | 'journey_end';
  currentClassification: { purpose?: string } | null; status: 'in_review' | 'approved' | 'rejected' | 'cancelled';
  createdAt: string; updatedAt: string;
};

export const ADJUSTMENT_KIND_LABELS: Record<AdjustmentView['kind'], { title: string; hint: string }> = {
  include: { title: 'Esqueci de bater', hint: 'Inclui um horário que faltou. Você informa a hora.' },
  discard: { title: 'Bati errado ou em duplicidade', hint: 'Pede para desconsiderar uma batida.' },
  correct: { title: 'O horário está errado', hint: 'Desconsidera a batida e inclui o horário certo.' },
};

export const ADJUSTMENT_STATUS_LABELS: Record<AdjustmentView['status'], string> = {
  in_review: 'Em análise', approved: 'Aprovado · tratado no ponto', rejected: 'Recusado', cancelled: 'Cancelado',
};
