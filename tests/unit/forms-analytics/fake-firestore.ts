import { FieldValue, Timestamp } from "firebase-admin/firestore";

type DocData = Record<string, unknown>;

const DELETE_SENTINEL = FieldValue.delete();
const SERVER_TS_SENTINEL = FieldValue.serverTimestamp();

function materialize(value: unknown): { remove: boolean; value?: unknown } {
  if (value instanceof FieldValue) {
    if (value.isEqual(DELETE_SENTINEL)) return { remove: true };
    if (value.isEqual(SERVER_TS_SENTINEL)) {
      return { remove: false, value: Timestamp.now() };
    }
    // increment e afins: aproximação suficiente para os testes
    return { remove: false, value: Timestamp.now() };
  }
  return { remove: false, value };
}

function applyPatch(target: DocData, patch: DocData) {
  for (const [key, raw] of Object.entries(patch)) {
    const { remove, value } = materialize(raw);
    if (remove) delete target[key];
    else target[key] = value;
  }
}

class FakeSnapshot {
  constructor(
    public readonly id: string,
    private readonly raw: DocData | undefined,
    public readonly ref: FakeDocRef
  ) {}

  get exists() {
    return this.raw !== undefined;
  }

  data() {
    return this.raw ? { ...this.raw } : undefined;
  }

  get(field: string) {
    return this.raw?.[field];
  }
}

export class FakeDocRef {
  constructor(
    private readonly store: Map<string, DocData>,
    public readonly id: string
  ) {}

  async get() {
    return new FakeSnapshot(this.id, this.store.get(this.id), this);
  }

  getSync() {
    return new FakeSnapshot(this.id, this.store.get(this.id), this);
  }

  async set(data: DocData) {
    const next: DocData = {};
    applyPatch(next, data);
    this.store.set(this.id, next);
  }

  async create(data: DocData) {
    if (this.store.has(this.id)) throw new Error("ALREADY_EXISTS");
    await this.set(data);
  }

  async update(patch: DocData) {
    const current = this.store.get(this.id);
    if (!current) throw new Error(`Documento inexistente: ${this.id}`);
    applyPatch(current, patch);
  }
}

class FakeQuery {
  constructor(
    private readonly collection: FakeCollection,
    private readonly filters: Array<{ field: string; op: string; value: unknown }>,
    private readonly limitCount?: number
  ) {}

  where(field: string, op: string, value: unknown) {
    return new FakeQuery(
      this.collection,
      [...this.filters, { field, op, value }],
      this.limitCount
    );
  }

  limit(count: number) {
    return new FakeQuery(this.collection, this.filters, count);
  }

  select() {
    return this;
  }

  async get() {
    const docs: FakeSnapshot[] = [];
    for (const [id, data] of this.collection.store.entries()) {
      const matches = this.filters.every(({ field, op, value }) => {
        const actual = data[field];
        if (op === "==") return Object.is(actual, value);
        if (op === "in") return Array.isArray(value) && value.includes(actual);
        throw new Error(`Operador não suportado no fake: ${op}`);
      });
      if (matches) {
        docs.push(new FakeSnapshot(id, data, this.collection.doc(id)));
      }
      if (this.limitCount !== undefined && docs.length >= this.limitCount) break;
    }
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class FakeCollection {
  constructor(public readonly store: Map<string, DocData>) {}

  private counter = 0;

  doc(id?: string) {
    return new FakeDocRef(this.store, id ?? `auto_${(this.counter += 1)}`);
  }

  where(field: string, op: string, value: unknown) {
    return new FakeQuery(this, [{ field, op, value }]);
  }
}

interface BatchOp {
  kind: "set" | "update";
  ref: FakeDocRef;
  data: DocData;
}

export class FakeFirestore {
  private readonly collections = new Map<string, Map<string, DocData>>();

  collection(name: string) {
    let store = this.collections.get(name);
    if (!store) {
      store = new Map();
      this.collections.set(name, store);
    }
    return new FakeCollection(store);
  }

  seed(collectionName: string, id: string, data: DocData) {
    this.collection(collectionName);
    this.collections.get(collectionName)!.set(id, { ...data });
  }

  docData(collectionName: string, id: string) {
    return this.collections.get(collectionName)?.get(id);
  }

  allDocs(collectionName: string): Array<DocData & { id: string }> {
    return [...(this.collections.get(collectionName)?.entries() ?? [])].map(
      ([id, data]) => ({ ...data, id })
    );
  }

  async runTransaction<T>(
    fn: (tx: {
      get: (target: FakeDocRef | FakeQuery) => Promise<unknown>;
      update: (ref: FakeDocRef, patch: DocData) => void;
      set: (ref: FakeDocRef, data: DocData) => void;
    }) => Promise<T>
  ): Promise<T> {
    return fn({
      get: async (target) => target.get(),
      update: (ref, patch) => {
        void ref.update(patch);
      },
      set: (ref, data) => {
        void ref.set(data);
      },
    });
  }

  batch() {
    const ops: BatchOp[] = [];
    return {
      set: (ref: FakeDocRef, data: DocData) => {
        ops.push({ kind: "set", ref, data });
      },
      update: (ref: FakeDocRef, data: DocData) => {
        ops.push({ kind: "update", ref, data });
      },
      commit: async () => {
        for (const op of ops) {
          if (op.kind === "set") await op.ref.set(op.data);
          else await op.ref.update(op.data);
        }
      },
    };
  }
}
