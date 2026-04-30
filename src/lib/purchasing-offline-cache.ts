const DB_NAME = 'coala-purchasing';
const DB_VERSION = 1;
const STORE = 'baseProducts';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('barcode', 'barcode', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheBaseProducts(
  products: Array<{ id: string; name: string; unit: string; barcode?: string; [k: string]: unknown }>,
): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const p of products) store.put(p);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror = () => { db.close(); rej(tx.error); };
    });
  } catch {
    // IndexedDB not available (SSR, private mode) — silently skip
  }
}

export async function lookupByBarcode(
  barcode: string,
): Promise<{ id: string; name: string; unit: string } | null> {
  if (typeof window === 'undefined') return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const index = tx.objectStore(STORE).index('barcode');
    return await new Promise((resolve, reject) => {
      const req = index.get(barcode);
      req.onsuccess = () => { db.close(); resolve((req.result as { id: string; name: string; unit: string }) ?? null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    return null;
  }
}
