/* docs/db.js */
(() => {
  const DB_NAME = "wardrobe_ai_db";
  const DB_VER = 2;
  const STORE_ITEMS = "items";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ITEMS)) {
          const store = db.createObjectStore(STORE_ITEMS, { keyPath: "id" });
          store.createIndex("by_cat", "category", { unique: false });
          store.createIndex("by_updated", "updatedAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, mode = "readonly") {
    return db.transaction([STORE_ITEMS], mode).objectStore(STORE_ITEMS);
  }

  async function putItem(item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const store = tx(db, "readwrite");
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  async function getItem(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const store = tx(db, "readonly");
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteItem(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const store = tx(db, "readwrite");
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function listItems() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const store = tx(db, "readonly");
      const req = store.getAll();
      req.onsuccess = () => {
        const arr = req.result || [];
        arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(arr);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // image utils
  async function fileToJpegBlob(file, max = 1400, quality = 0.86) {
    if (!(file instanceof File)) throw new Error("Invalid file");
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) {
      // fallback: keep original
      return file;
    }
    const { width, height } = bmp;
    const scale = Math.min(1, max / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, w, h);

    return await new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob || file),
        "image/jpeg",
        quality
      );
    });
  }

  window.WardrobeDB = {
    putItem,
    getItem,
    deleteItem,
    listItems,
    fileToJpegBlob,
  };
})();