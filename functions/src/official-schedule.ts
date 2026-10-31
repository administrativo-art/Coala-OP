import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";

export type OfficialShift = Record<string, unknown> & { id: string; scheduleId: string; userId: string;
  date: string; type: string; unitId?: string; startTime?: string; endTime?: string;
  shiftDefinitionId?: string; countsTowardGoals?: boolean };
const MAX_BASE = 3000;
const MAX_OVERLAY = 2000;
const MAX_PERSON = 62;

function normalize(scheduleId: string, id: string, value: Record<string, unknown>): OfficialShift {
  if (typeof value.userId !== "string" || typeof value.date !== "string" || typeof value.type !== "string") {
    throw new Error("Official shift identity invalid.");
  }
  for (const field of ["unitId", "startTime", "endTime", "shiftDefinitionId"]) {
    if (value[field] !== undefined && typeof value[field] !== "string") throw new Error("Official shift field invalid.");
  }
  return { ...value, id, scheduleId } as OfficialShift;
}

/** Function-native official reader. The schedule snapshot must belong to the supplied transaction when present. */
export async function readOfficialScheduleShifts(db: Firestore, schedule: DocumentSnapshot,
  options: { date?: string; userIds?: string[]; transaction?: Transaction } = {}): Promise<OfficialShift[]> {
  if (!schedule.exists) throw new Error("Official schedule missing.");
  const tx = options.transaction;
  const get = <T extends FirebaseFirestore.Query<FirebaseFirestore.DocumentData> | FirebaseFirestore.DocumentReference>(ref: T) =>
    tx ? tx.get(ref as FirebaseFirestore.Query<FirebaseFirestore.DocumentData>) : ref.get();
  const revisionId = schedule.get("activeRevisionId");
  if (!revisionId) {
    if (schedule.get("publicationStatus") === "draft" && !(Number(schedule.get("publicationVersion")) > 0)) return [];
    let query: FirebaseFirestore.Query = schedule.ref.collection("shifts");
    if (options.date) query = query.where("date", "==", options.date);
    if (options.userIds) {
      if (!options.userIds.length) return [];
      if (options.userIds.length > 30) throw new Error("Official person query limit reached.");
      query = query.where("userId", "in", options.userIds);
    }
    const snapshot = await get(query.limit(MAX_BASE + 1)) as FirebaseFirestore.QuerySnapshot;
    if (snapshot.size > MAX_BASE) throw new Error("Official legacy shift limit reached.");
    return snapshot.docs.map((doc) => normalize(schedule.id, doc.id, doc.data()));
  }
  if (typeof revisionId !== "string" || revisionId.includes("/")) throw new Error("Official revision pointer invalid.");
  const manifestRef = schedule.ref.collection("revisions").doc(revisionId);
  const manifest = await get(manifestRef) as DocumentSnapshot;
  if (!manifest.exists || manifest.get("status") !== "ready" || manifest.get("scheduleId") !== schedule.id) {
    throw new Error("Official revision manifest invalid.");
  }
  const map = new Map<string, OfficialShift>();
  const put = (id: string, value: unknown) => {
    if (value === null) { map.delete(id); return; }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Official overlay value invalid.");
    map.set(id, normalize(schedule.id, id, value as Record<string, unknown>));
  };
  if (options.userIds) {
    if (options.userIds.length > 30) throw new Error("Official person query limit reached.");
    for (const userId of options.userIds) {
      if (!userId || userId.includes("/")) throw new Error("Official person ID invalid.");
      const [person, overlay] = await Promise.all([
        get(manifestRef.collection("people").doc(userId)) as Promise<DocumentSnapshot>,
        get(schedule.ref.collection("operationalOverlays").doc(revisionId).collection("people").doc(userId)) as Promise<DocumentSnapshot>,
      ]);
      const base = person.exists ? person.get("shifts") : [];
      const edits = overlay.exists ? overlay.get("edits") : {};
      if (!Array.isArray(base) || base.length > MAX_PERSON || !edits || typeof edits !== "object"
        || Array.isArray(edits) || Object.keys(edits).length > MAX_PERSON) throw new Error("Official person row invalid.");
      for (const shift of base) {
        if (!shift || typeof shift.id !== "string") throw new Error("Official person shift invalid.");
        put(shift.id, shift);
      }
      for (const [id, value] of Object.entries(edits)) put(id, value);
    }
  } else {
    const [base, overlay] = await Promise.all([
      get(manifestRef.collection("entries").limit(MAX_BASE + 1)) as Promise<FirebaseFirestore.QuerySnapshot>,
      get(schedule.ref.collection("operationalOverlays").doc(revisionId).collection("entries").limit(MAX_OVERLAY + 1)) as Promise<FirebaseFirestore.QuerySnapshot>,
    ]);
    if (base.size > MAX_BASE || overlay.size > MAX_OVERLAY) throw new Error("Official revision shift limit reached.");
    base.docs.forEach((doc) => put(doc.id, doc.data()));
    overlay.docs.forEach((doc) => put(doc.id, doc.get("value")));
  }
  const shifts = [...map.values()].filter((shift) => (!options.date || shift.date === options.date)
    && (!options.userIds || options.userIds.includes(String(shift.userId))));
  if (!tx) {
    const current = await db.collection("dp_schedules").doc(schedule.id).get();
    if (current.get("activeRevisionId") !== revisionId
      || current.get("operationalVersion") !== schedule.get("operationalVersion")
      || current.get("publicationVersion") !== schedule.get("publicationVersion")) {
      throw new Error("Official schedule changed during read.");
    }
  }
  return shifts;
}
