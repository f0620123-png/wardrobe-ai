/* docs/db.js */
(function () {
  const KEY = "wardrobe_items_v1";

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("DB read error", e);
      return [];
    }
  }

  function write(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
  }

  function uid() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  window.DB = {
    list() {
      return read();
    },
    get(id) {
      return read().find(x => x.id === id) || null;
    },
    upsert(item) {
      const items = read();
      const idx = items.findIndex(x => x.id === item.id);
      if (idx >= 0) items[idx] = item;
      else items.unshift(item);
      write(items);
      return item;
    },
    remove(id) {
      const items = read().filter(x => x.id !== id);
      write(items);
    },
    newItem(partial = {}) {
      return {
        id: uid(),
        title: "",
        category: "上衣",
        tMin: 0,
        tMax: 30,
        imageDataUrl: "",
        createdAt: Date.now(),
        ...partial
      };
    }
  };
})();