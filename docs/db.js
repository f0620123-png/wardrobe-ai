const DB_NAME = "wardrobe_ai_db";
const DB_VER = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("images")) {
        db.createObjectStore("images"); // key: imageKey, value: Blob
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export const ImageDB = {
  async put(imageKey, blob) {
    return withStore("images", "readwrite", (s) => s.put(blob, imageKey));
  },
  async get(imageKey) {
    return withStore("images", "readonly", (s) => new Promise((res, rej) => {
      const r = s.get(imageKey);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    }));
  },
  async del(imageKey) {
    return withStore("images", "readwrite", (s) => s.delete(imageKey));
  },
};
