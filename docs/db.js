/* docs/db.js - IndexedDB wrapper (store image as Blob) */

const DB_NAME = "wardrobe_ai_db";
const DB_VER = 1;
const STORE_ITEMS = "items";

let _dbPromise = null;

function dbOpen() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const st = db.createObjectStore(STORE_ITEMS, { keyPath: "id" });
        st.createIndex("category", "category", { unique: false });
        st.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("DB open failed"));
  });

  return _dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("TX failed"));
    tx.onabort = () => reject(tx.error || new Error("TX aborted"));
  });
}

function uid() {
  return "it_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

async function dbUpsertItem(item) {
  const db = await dbOpen();
  const tx = db.transaction(STORE_ITEMS, "readwrite");
  tx.objectStore(STORE_ITEMS).put(item);
  await txDone(tx);
  return item;
}

async function dbDeleteItem(id) {
  const db = await dbOpen();
  const tx = db.transaction(STORE_ITEMS, "readwrite");
  tx.objectStore(STORE_ITEMS).delete(id);
  await txDone(tx);
}

async function dbGetItem(id) {
  const db = await dbOpen();
  const tx = db.transaction(STORE_ITEMS, "readonly");
  const req = tx.objectStore(STORE_ITEMS).get(id);
  const result = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("Get failed"));
  });
  return result;
}

async function dbListItems() {
  const db = await dbOpen();
  const tx = db.transaction(STORE_ITEMS, "readonly");
  const req = tx.objectStore(STORE_ITEMS).getAll();
  const arr = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error("List failed"));
  });
  // new first
  arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return arr;
}

/** 只清 IndexedDB 的衣櫃（一般不建議） */
async function dbClearAllItems() {
  const db = await dbOpen();
  const tx = db.transaction(STORE_ITEMS, "readwrite");
  tx.objectStore(STORE_ITEMS).clear();
  await txDone(tx);
}

/** 將 File 轉 Blob（直接用 file 本身即可） */
async function fileToBlob(file) {
  return file; // File is a Blob
}