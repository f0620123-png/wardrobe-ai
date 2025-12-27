/* docs/db.js
   IndexedDB: items (store image as Blob)
*/

const DB_NAME = "wardrobe_db_v1";
const DB_VER = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("items")) {
        const store = db.createObjectStore("items", { keyPath: "id", autoIncrement: true });
        store.createIndex("by_category", "category", { unique: false });
        store.createIndex("by_createdAt", "createdAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("outfits")) {
        const store = db.createObjectStore("outfits", { keyPath: "id", autoIncrement: true });
        store.createIndex("by_createdAt", "createdAt", { unique: false });
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

    let result;
    Promise.resolve()
      .then(() => fn(store))
      .then((r) => (result = r))
      .catch(reject);

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ===== Items =====
async function dbGetAllItems() {
  return withStore("items", "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

async function dbGetItem(id) {
  return withStore("items", "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(Number(id));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

async function dbPutItem(item) {
  return withStore("items", "readwrite", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.put(item);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

async function dbDeleteItem(id) {
  return withStore("items", "readwrite", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.delete(Number(id));
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  });
}

async function dbClearItems() {
  return withStore("items", "readwrite", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  });
}