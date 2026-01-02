/* docs/app.js */

const DEFAULT_WORKER_BASE = "https://autumn-cell-d032.f0620123.workers.dev";

const LS_WORKER_BASE = "wardrobe.worker.base.v1";
const LS_WEATHER_KEY = "wardrobe.weather.cache.v1";
const LS_WEATHER_TTL_MS = 10 * 60 * 1000;

let inflightWeather = null; // AbortController

// ---------- DOM helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function setText(sel, text) { const el = $(sel); if (el) el.textContent = text; }
function setHtml(sel, html) { const el = $(sel); if (el) el.innerHTML = html; }

function toast(msg, ms = 2200) {
  const el = $("#toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), ms);
}

function setLoading(isLoading) {
  const btn = $("#btnLocate");
  if (btn) {
    btn.disabled = isLoading;
    btn.textContent = isLoading ? "定位中…" : "定位/更新\n天氣";
  }
  const sk = $("#weatherSkeleton");
  if (sk) sk.style.display = isLoading ? "block" : "none";
}

function getWorkerBase() {
  return (localStorage.getItem(LS_WORKER_BASE) || DEFAULT_WORKER_BASE).replace(/\/+$/,"");
}

// ---------- caching ----------
function readWeatherCache() {
  try {
    const raw = localStorage.getItem(LS_WEATHER_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.ts || !obj.data) return null;
    if (Date.now() - obj.ts > LS_WEATHER_TTL_MS) return null;
    return obj.data;
  } catch { return null; }
}
function writeWeatherCache(data) {
  try { localStorage.setItem(LS_WEATHER_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// ---------- geolocation ----------
function getCurrentPosition(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("此裝置不支援定位"));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60 * 1000,
      ...opts,
    });
  });
}

// ---------- fetch weather ----------
async function fetchWeather(lat, lon) {
  if (inflightWeather) inflightWeather.abort();
  inflightWeather = new AbortController();

  const base = getWorkerBase();
  const url = `${base}/weather/now?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    signal: inflightWeather.signal,
    cache: "no-store",
  });

  const jsonData = await res.json().catch(() => null);
  if (!res.ok || !jsonData || jsonData.ok !== true) {
    const msg = jsonData?.error || `Weather API error (${res.status})`;
    throw new Error(msg);
  }
  return jsonData;
}

// ---------- outfit rules ----------
function recommendOutfit(feelsC, precipMm, windMs) {
  const f = Number(feelsC);
  const p = Number(precipMm);
  const w = Number(windMs);

  const parts = [];
  let level = "";

  if (f <= 10) {
    level = "寒冷";
    parts.push("保暖內層（發熱衣/長袖）", "厚外套（羽絨/羊毛）", "長褲", "可加圍巾/手套");
  } else if (f <= 16) {
    level = "偏涼";
    parts.push("長袖或薄針織", "輕外套（風衣/牛仔/薄羽絨）", "長褲");
  } else if (f <= 22) {
    level = "舒適";
    parts.push("短袖或薄長袖", "可帶薄外套備用", "長褲/裙皆可");
  } else if (f <= 28) {
    level = "偏熱";
    parts.push("短袖", "透氣材質（棉/麻/機能排汗）", "短褲/薄長褲");
  } else {
    level = "炎熱";
    parts.push("無袖/短袖", "輕薄透氣", "防曬（帽/袖套/防曬外套）");
  }

  if (Number.isFinite(w) && w >= 6) parts.push("風大：外層選防風材質");
  if (Number.isFinite(p) && p >= 0.5) parts.push("可能降雨：帶傘/防水外套");

  return { level, parts };
}

// ---------- render weather ----------
function renderWeather(w) {
  const temp = w.temperature;
  const feels = w.feels_like;
  const