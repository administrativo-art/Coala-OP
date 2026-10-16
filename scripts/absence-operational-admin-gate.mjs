/** Legacy Admin writers cannot participate in the Coala occupancy clock protocol. */
export async function assertAbsenceOperationalAdminWriteAllowed(db, workspaceId = 'coala',
  guardValue = process.env.DP_ABSENCE_OPERATIONAL_GUARD) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) throw new Error('Workspace operacional inválido.');
  if (guardValue && guardValue !== 'off') {
    throw new Error('Escrita administrativa ocupacional suspensa enquanto o guard operacional for solicitado.');
  }
  const readiness = await db.collection('dp_absenceOperationalReadiness').doc(workspaceId).get();
  if (readiness.exists && ['bootstrapping', 'ready'].includes(readiness.get('state'))) {
    throw new Error('Escrita administrativa ocupacional suspensa durante bootstrap/cutover de ausências.');
  }
}

/** Bulk writers of employment data must stop while any retention deletion owns a person fence. */
export async function assertAbsenceRetentionEmploymentWriteAllowed(db) {
  const active = await db.collection('users').where('absenceDocumentDeletionFence.state', 'in',
    ['executing', 'execution_unknown', 'release_pending', 'review_required']).limit(1).get();
  if (!active.empty) {
    throw new Error('Escrita administrativa de vínculos suspensa durante exclusão documental.');
  }
}
