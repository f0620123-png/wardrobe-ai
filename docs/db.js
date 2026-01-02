/* docs/db.js
   IndexedDB：儲存單品（含圖片 DataURL）
   - 兼顧 iOS Safari 相容性：不依賴 Blob store
*/

(function () {
  const DB_NAME = "wardrobe-ai-db";
  const DB_VERSION = 1;
  const STORE = "items";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("by_updatedAt", "updatedAt");
          os.createIndex("by_cat", "cat");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function now() { return Date.now(); }

  function uid() {
    return "i_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }

  async function listItems() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const items = [];
      const store = tx(db, "readonly");
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) {
          db.close();
          // sort: updated desc
          items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          resolve(items);
          return;
        }
        items.push(cur.value);
        cur.continue();
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function getItem(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const store = tx(db, "readonly");
      const req = store.get(id);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function upsertItem(item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const store = tx(db, "readwrite");
      const it = { ...item };

      if (!it.id) it.id = uid();
      if (!it.createdAt) it.createdAt = now();
      it.updatedAt = now();

      const req = store.put(it);
      req.onsuccess = () => { db.close(); resolve(it); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function deleteItem(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const store = tx(db, "readwrite");
      const req = store.delete(id);
      req.onsuccess = () => { db.close(); resolve(true); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  // --- legacy import (best-effort) ---
  // 嘗試把舊 localStorage 版本（若存在）匯入到 IndexedDB
  async function importLegacyOnce() {
    try {
      const flagKey = "wardrobe.legacyImported.v1";
      if (localStorage.getItem(flagKey) === "1") return;

      const candidates = [
        "wardrobe.items.v1",
        "wardrobe.items",
        "wardrobe_ai_items",
        "wardrobeAI.items"
      ];
      let raw = null;
      for (const k of candidates) {
        raw = localStorage.getItem(k);
        if (raw) break;
      }
      if (!raw) {
        localStorage.setItem(flagKey, "1");
        return;
      }

      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) {
        localStorage.setItem(flagKey, "1");
        return;
      }

      // 逐筆寫入
      for (const x of arr) {
        if (!x) continue;
        // 可能欄位名稱不同，做容錯 mapping
        const mapped = {
          id: x.id || x._id,
          name: x.name || x.title || "",
          cat: x.cat || x.category || "top",
          note: x.note || x.memo || "",
          aiNote: x.aiNote || x.ai || "",
          imageDataUrl: x.imageDataUrl || x.image || x.photo || "",
          createdAt: x.createdAt || Date.now(),
          updatedAt: x.updatedAt || Date.now(),
        };
        await upsertItem(mapped);
      }

      localStorage.setItem(flagKey, "1");
    } catch {
      // ignore
    }
  }

  window.WardrobeDB = {
    openDB,
    listItems,
    getItem,
    upsertItem,
    deleteItem,
    importLegacyOnce
  };
})();
