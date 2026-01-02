/* docs/db.js - v7.2 */
(() => {
  "use strict";

  const DB_NAME = "wardrobe_ai_db";
  const DB_VER = 2;
  const STORE = "items";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("category", "category", { unique: false });
          os.createIndex("updatedAt", "updatedAt", { unique: false });
        } else {
          const os = req.transaction.objectStore(STORE);
          if (!os.indexNames.contains("category")) os.createIndex("category", "category", { unique: false });
          if (!os.indexNames.contains("updatedAt")) os.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, mode = "readonly") {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async function getAllItems() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const os = tx(db, "readonly");
      const req = os.getAll();
      req.onsuccess = () => {
        const arr = req.result || [];
        // sort by updatedAt desc
        arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(arr);
        db.close();
      };
      req.onerror = () => { reject(req.error); db.close(); };
    });
  }

  async function getItem(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const os = tx(db, "readonly");
      const req = os.get(id);
      req.onsuccess = () => { resolve(req.result || null); db.close(); };
      req.onerror = () => { reject(req.error); db.close(); };
    });
  }

  async function putItem(item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const os = tx(db, "readwrite");
      const req = os.put(item);
      req.onsuccess = () => { resolve(true); db.close(); };
      req.onerror = () => { reject(req.error); db.close(); };
    });
  }

  async function deleteItem(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const os = tx(db, "readwrite");
      const req = os.delete(id);
      req.onsuccess = () => { resolve(true); db.close(); };
      req.onerror = () => { reject(req.error); db.close(); };
    });
  }

  // expose
  window.WardrobeDB = {
    getAllItems,
    getItem,
    putItem,
    deleteItem,
  };
})();