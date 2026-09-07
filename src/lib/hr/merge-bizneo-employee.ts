import type { Firestore } from 'firebase-admin/firestore';

/** Reconciles the legacy Bizneo document without replacing onboarding data. */
export async function mergeBizneoEmployee(
  db: Firestore,
  uid: string,
  bizneoId: string,
  now: string,
) {
  if (uid === bizneoId) return;
  const employees = db.collection('employees');
  const canonicalRef = employees.doc(uid);
  const legacyRef = employees.doc(bizneoId);

  await db.runTransaction(async (transaction) => {
    const [canonicalDoc, legacyDoc] = await transaction.getAll(canonicalRef, legacyRef);
    if (!legacyDoc.exists) return;
    if (!canonicalDoc.exists) throw new Error('Cadastro canônico do RH não encontrado.');
    const canonical = canonicalDoc.data()!;
    const legacy = legacyDoc.data()!;
    if (canonical.merged_into || (legacy.merged_into && legacy.merged_into !== uid)) {
      throw new Error('Cadastro do RH já vinculado a outro registro.');
    }
    for (const data of [canonical, legacy]) {
      if ([data.auth_uid, data.source_user_id].some(value => value && value !== uid)) {
        throw new Error('Cadastro do RH vinculado a outro usuário.');
      }
    }
    if (legacy.merged_into === uid) return;

    // Only absent top-level fields are inherited. Explicit null/empty values
    // from onboarding remain authoritative; subcollections stay in the legacy
    // document for audit and are not migrated by this reconciliation.
    const inherited = Object.fromEntries(Object.entries(legacy).filter(([key]) =>
      !Object.hasOwn(canonical, key) && !['merged_into', 'merged_at'].includes(key),
    ));
    transaction.set(canonicalRef, {
      ...inherited,
      auth_uid: uid,
      source_user_id: uid,
      bizneo_employee_id: bizneoId,
    }, { merge: true });
    transaction.update(legacyRef, { merged_into: uid, merged_at: now });
  });
}
