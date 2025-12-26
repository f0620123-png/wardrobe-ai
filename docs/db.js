/* docs/db.js
   localStorage wrapper
   - Items
   - UI prefs
   - Weather cache
*/

(() => {
  const STORAGE_KEY = "wardrobe.items.v3";
  const STORAGE_UI_KEY = "wardrobe.ui.v1";
  const LS_WEATHER_KEY = "wardrobe.weather.cache.v1";

  function safeParse(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function loadItems() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? safeParse(raw, []) : [];
    return Array.isArray(arr) ? arr : [];
  }

  function saveItems(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function loadUI() {
    const raw = localStorage.getItem(STORAGE_UI_KEY);
    return raw ? safeParse(raw, {}) : {};
  }

  function saveUI(ui) {
    localStorage.setItem(STORAGE_UI_KEY, JSON.stringify(ui || {}));
  }

  function readWeatherCache() {
    const raw = localStorage.getItem(LS_WEATHER_KEY);
    return raw ? safeParse(raw, null) : null;
  }

  function writeWeatherCache(obj) {
    localStorage.setItem(LS_WEATHER_KEY, JSON.stringify(obj));
  }

  function clearWeatherCache() {
    localStorage.removeItem(LS_WEATHER_KEY);
  }

  function clearAll() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_UI_KEY);
    localStorage.removeItem(LS_WEATHER_KEY);
  }

  window.DB = {
    keys: { STORAGE_KEY, STORAGE_UI_KEY, LS_WEATHER_KEY },
    loadItems,
    saveItems,
    loadUI,
    saveUI,
    readWeatherCache,
    writeWeatherCache,
    clearWeatherCache,
    clearAll,
  };
})();