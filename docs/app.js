/* docs/app.js */

const DEFAULT_WORKER_BASE = "https://autumn-cell-d032.f0620123.workers.dev";
const LS_WORKER_BASE = "wardrobe.worker.base.v1";

const LS_WEATHER_KEY = "wardrobe.weather.cache.v2";
const LS_WEATHER_TTL_MS = 10 * 60 * 1000; // 10min client cache

let inflightWeather = null; // AbortController

// objectURL 管理（避免記憶體累積）
const objectUrlPool = new Map(); // key -> url
function setObjectUrl(key, blob) {
  if (objectUrlPool.has(key)) {
    URL.revokeObjectURL(objectUrlPool.get(key));
    objectUrlPool.delete(key);
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrlPool.set(key, url);
  return url;
}
function revokeAllObjectUrls() {
  for (const url of objectUrlPool.values()) URL.revokeObjectURL(url);
  objectUrlPool.clear();
}

// ---------- DOM helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function setText(sel, text) {
  const el = $(sel);
  if (el) el.textContent = text;
}
function setHtml(sel, html) {
  const el = $(sel);
  if (el) el.innerHTML = html;
}

function toast(msg, ms = 2200) {
  const el = $("#toast");
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), ms);
}

function setLoading(isLoading) {
  const btn = $("#btnLocate");
  if (btn) {
    btn.disabled = isLoading;
    btn.textContent = isLoading ? "定位中…" : "定位/更新天氣";
  }
  const sk = $("#weatherSkeleton");
  if (sk) sk.style.display = isLoading ? "block" : "none";
}

// ---------- Settings ----------
function getWorkerBase() {
  return (localStorage.getItem(LS_WORKER_BASE) || DEFAULT_WORKER_BASE).replace(/\/+$/, "");
}
function setWorkerBase(v) {
  localStorage.setItem(LS_WORKER_BASE, String(v || "").trim().replace(/\/+$/, ""));
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
  } catch {
    return null;
  }
}
function writeWeatherCache(data) {
  try {
    localStorage.setItem(LS_WEATHER_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

// ---------- geolocation ----------
function getCurrentPosition(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("此裝置不支援定位"));
      return;
    }
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

  // 注意：GET 不要亂加 Content-Type，避免 CORS preflight
  const res = await fetch(url, {
    method: "GET",
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
  const wind = w.wind_speed;
  const rain = w.precipitation;
  const unit = w.unit || "C";

  setText("#tempText", `${temp}°${unit}`);
  setText("#feelsText", `體感 ${feels}°${unit}`);
  setText("#metaText", `風 ${wind} m/s · 降雨 ${rain} mm · 來源 ${w.provider || "-"}`);

  const rec = recommendOutfit(feels, rain, wind);
  setHtml(
    "#outfitHint",
    `
      <div class="hintTitle">今日體感：${rec.level}</div>
      <ul class="hintList">${rec.parts.map((x) => `<li>${x}</li>`).join("")}</ul>
    `
  );
}

// ---------- main weather flow ----------
async function refreshByGPS() {
  try {
    setLoading(true);

    const cached = readWeatherCache();
    if (cached) {
      renderWeather(cached);
      setLoading(false);
      toast("已顯示快取天氣，背景更新中…", 1500);
    }

    const pos = await getCurrentPosition();
    const { latitude, longitude } = pos.coords;

    const w = await fetchWeather(latitude, longitude);
    writeWeatherCache(w);
    renderWeather(w);

    toast("天氣已更新");
  } catch (e) {
    toast(`更新失敗：${String(e?.message || e)}`);
  } finally {
    setLoading(false);
  }
}

// ---------- Tabs ----------
let currentTab = "wardrobe";
function setTab(tab) {
  currentTab = tab;

  $$(".navBtn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("#pageWardrobe").classList.toggle("active", tab === "wardrobe");
  $("#pageOutfit").classList.toggle("active", tab === "outfit");
  $("#pageSettings").classList.toggle("active", tab === "settings");

  // FAB 永遠可新增單品（不跟頁面一起被重建）
  const fab = $("#fabAdd");
  if (fab) fab.style.display = "grid";
}

// ---------- Items state ----------
let items = [];
let filter = "all";

// outfit selection (store item id per slot)
const outfitSel = {
  inner: null,
  top: null,
  bottom: null,
  outer: null,
  shoes: null,
  accessory: null,
};

const CAT_LABEL = {
  inner: "內搭",
  top: "上衣",
  bottom: "下身",
  outer: "外套",
  shoes: "鞋子",
  accessory: "配件",
};

// ---------- Wardrobe render ----------
function renderWardrobe() {
  const grid = $("#wardrobeGrid");
  const empty = $("#wardrobeEmpty");

  const filtered = items.filter((it) => filter === "all" ? true : it.category === filter);
  setText("#countText", String(items.length));

  // 清掉舊的 objectURL（避免無限成長）
  // 只 revoke 「列表用」的 key，避免 modal preview 的 key 被一起砍
  for (const k of Array.from(objectUrlPool.keys())) {
    if (k.startsWith("card_")) {
      URL.revokeObjectURL(objectUrlPool.get(k));
      objectUrlPool.delete(k);
    }
  }

  if (!filtered.length) {
    grid.innerHTML = "";
    empty.style.display = items.length ? "block" : "block";
    empty.querySelector(".emptySub").textContent = items.length ? "此分類沒有單品" : "按右下角「+」新增第一件";
    return;
  }
  empty.style.display = "none";

  grid.innerHTML = filtered.map((it) => {
    const name = it.name || "未命名";
    const badge = it.category ? CAT_LABEL[it.category] : "未分類";
    const hasImg = !!it.imageBlob;
    const imgUrl = hasImg ? setObjectUrl(`card_${it.id}`, it.imageBlob) : "";

    return `
      <div class="itemCard" data-id="${it.id}">
        <div class="thumb">
          ${hasImg ? `<img src="${imgUrl}" alt="${name}">` : `<div class="noImg">No Image</div>`}
        </div>
        <div class="itemBody">
          <div class="itemName">${escapeHtml(name)}</div>
          <div class="badge">${escapeHtml(badge)}</div>
        </div>
      </div>
    `;
  }).join("");

  // bind click cards
  $$("#wardrobeGrid .itemCard").forEach((card) => {
    card.addEventListener("click", () => openEditModal(card.dataset.id));
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- Modal (Add/Edit) ----------
let modalMode = "add";
let editingId = null;
let draftImageBlob = null;
let draftCategory = null;

function showModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.add("show");
  m.setAttribute("aria-hidden", "false");
}
function hideModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.remove("show");
  m.setAttribute("aria-hidden", "true");
}

function resetModal() {
  modalMode = "add";
  editingId = null;
  draftImageBlob = null;
  draftCategory = null;

  setText("#modalTitle", "新增單品");
  $("#btnDeleteItem").style.display = "none";

  $("#inputName").value = "";
  $("#inputNote").value = "";
  $("#inputAIDesc").value = "";
  $("#inputImage").value = "";

  $$("#catRow .catBtn").forEach((b) => b.classList.remove("active"));

  // preview
  const img = $("#imgPreview");
  const ph = $("#imgPlaceholder");
  img.style.display = "none";
  img.removeAttribute("src");
  ph.style.display = "block";

  // 清掉 modal preview 的 objectURL
  if (objectUrlPool.has("modal_preview")) {
    URL.revokeObjectURL(objectUrlPool.get("modal_preview"));
    objectUrlPool.delete("modal_preview");
  }
}

function setModalCategory(cat) {
  draftCategory = cat;
  $$("#catRow .catBtn").forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
}

function setModalPreview(blob) {
  const img = $("#imgPreview");
  const ph = $("#imgPlaceholder");
  if (!blob) {
    img.style.display = "none";
    img.removeAttribute("src");
    ph.style.display = "block";
    return;
  }
  const url = setObjectUrl("modal_preview", blob);
  img.src = url;
  img.style.display = "block";
  ph.style.display = "none";
}

function openAddModal() {
  resetModal();
  showModal("#modalItem");
}

async function openEditModal(id) {
  const it = await dbGetItem(id);
  if (!it) { toast("找不到該單品"); return; }

  resetModal();
  modalMode = "edit";
  editingId = id;

  setText("#modalTitle", "編輯單品");
  $("#btnDeleteItem").style.display = "inline-flex";

  $("#inputName").value = it.name || "";
  $("#inputNote").value = it.note || "";
  $("#inputAIDesc").value = it.aiDesc || "";

  setModalCategory(it.category || null);

  draftImageBlob = it.imageBlob || null;
  setModalPreview(draftImageBlob);

  showModal("#modalItem");
}

async function saveModalItem() {
  const name = $("#inputName").value.trim();
  const note = $("#inputNote").value.trim();
  const aiDesc = $("#inputAIDesc").value.trim();
  const category = draftCategory || null;

  const now = Date.now();

  if (modalMode === "add") {
    const it = {
      id: uid(),
      name,
      note,
      aiDesc,
      category,
      imageBlob: draftImageBlob || null,
      createdAt: now,
      updatedAt: now,
    };
    await dbUpsertItem(it);
    toast("已新增");
  } else {
    const old = await dbGetItem(editingId);
    if (!old) { toast("找不到該單品"); return; }
    const it = {
      ...old,
      name,
      note,
      aiDesc,
      category,
      imageBlob: draftImageBlob || null,
      updatedAt: now,
    };
    await dbUpsertItem(it);
    toast("已儲存");
  }

  hideModal("#modalItem");
  await reloadItems();
}

async function deleteModalItem() {
  if (modalMode !== "edit" || !editingId) return;
  if (!confirm("確定要刪除這個單品嗎？")) return;
  await dbDeleteItem(editingId);
  toast("已刪除");
  hideModal("#modalItem");
  await reloadItems();
}

// ---------- AI describe ----------
async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function aiDescribeCurrentImage() {
  try {
    const base = getWorkerBase();
    if (!draftImageBlob) {
      toast("先選擇圖片");
      return;
    }
    toast("AI 分析中…", 1200);

    // 1) 嘗試 multipart/form-data
    let res, data;
    try {
      const fd = new FormData();
      fd.append("image", draftImageBlob, "item.jpg");
      fd.append("hint", "請用繁體中文、以一段話描述這件服裝：顏色、版型、材質/厚薄、風格、適合場合。");
      res = await fetch(`${base}/ai/wardrobe/analyze-image`, { method: "POST", body: fd });
      data = await res.json().catch(() => null);
      if (!res.ok) throw new Error("multipart not ok");
    } catch {
      // 2) fallback JSON base64
      const b64 = await blobToBase64(draftImageBlob);
      res = await fetch(`${base}/ai/wardrobe/analyze-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: b64,
          mime: draftImageBlob.type || "image/jpeg",
          prompt: "請用繁體中文、以一段話描述這件服裝：顏色、版型、材質/厚薄、風格、適合場合。",
        }),
      });
      data = await res.json().catch(() => null);
    }

    if (!res.ok || !data || data.ok !== true) {
      const msg = data?.error || `AI error (${res.status})`;
      throw new Error(msg);
    }

    const text = data.description || data.text || data.result || "";
    if (!text) {
      toast("AI 有回應但沒有文字欄位（請看 worker 回傳格式）");
      return;
    }
    $("#inputAIDesc").value = text.trim();
    toast("已生成描述");
  } catch (e) {
    toast(`AI 失敗：${String(e?.message || e)}`);
  }
}

// ---------- Outfit picker ----------
let pickingSlot = null;
let pickingSelectedId = null;

function openPicker(slot) {
  pickingSlot = slot;
  pickingSelectedId = outfitSel[slot] || null;

  setText("#pickerTitle", `選擇：${CAT_LABEL[slot] || slot}`);
  renderPickerGrid(slot);

  showModal("#modalPicker");
}

function renderPickerGrid(slot) {
  const grid = $("#pickerGrid");
  const empty = $("#pickerEmpty");

  const arr = items.filter((it) => it.category === slot);
  // 清掉舊 picker url
  for (const k of Array.from(objectUrlPool.keys())) {
    if (k.startsWith("pick_")) {
      URL.revokeObjectURL(objectUrlPool.get(k));
      objectUrlPool.delete(k);
    }
  }

  if (!arr.length) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  grid.innerHTML = arr.map((it) => {
    const name = it.name || "未命名";
    const hasImg = !!it.imageBlob;
    const imgUrl = hasImg ? setObjectUrl(`pick_${it.id}`, it.imageBlob) : "";
    const active = (pickingSelectedId === it.id) ? "style='outline:3px solid rgba(123,77,255,.55)'" : "";
    return `
      <div class="itemCard" data-id="${it.id}" ${active}>
        <div class="thumb">
          ${hasImg ? `<img src="${imgUrl}" alt="${escapeHtml(name)}">` : `<div class="noImg">No Image</div>`}
        </div>
        <div class="itemBody">
          <div class="itemName">${escapeHtml(name)}</div>
          <div class="badge">${CAT_LABEL[it.category] || "未分類"}</div>
        </div>
      </div>
    `;
  }).join("");

  $$("#pickerGrid .itemCard").forEach((card) => {
    card.addEventListener("click", () => {
      pickingSelectedId = card.dataset.id;
      renderPickerGrid(slot);
    });
  });
}

function applyPicker() {
  if (!pickingSlot) return;
  outfitSel[pickingSlot] = pickingSelectedId || null;
  updatePickedLabels();
  hideModal("#modalPicker");
}

function clearPickerSlot() {
  if (!pickingSlot) return;
  outfitSel[pickingSlot] = null;
  updatePickedLabels();
  hideModal("#modalPicker");
}

function updatePickedLabels() {
  for (const slot of Object.keys(outfitSel)) {
    const id = outfitSel[slot];
    const el = $(`#picked_${slot}`);
    if (!el) continue;
    if (!id) {
      el.textContent = "未選擇";
      continue;
    }
    const it = items.find((x) => x.id === id);
    el.textContent = it ? (it.name || "未命名") : "未選擇";
  }
}

// ---------- Compose (simple stack) ----------
async function loadImageFromBlob(blob) {
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function composeOutfit() {
  const canvas = $("#composeCanvas");
  const hint = $("#composeHint");
  const ctx = canvas.getContext("2d");

  // 清背景
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const slots = ["inner", "top", "bottom", "outer", "shoes", "accessory"];
  const selected = slots
    .map((s) => outfitSel[s] ? items.find((x) => x.id === outfitSel[s]) : null)
    .filter(Boolean);

  if (!selected.length) {
    hint.style.display = "block";
    toast("先選擇至少一個單品");
    return;
  }
  hint.style.display = "none";

  // 標題
  ctx.fillStyle = "#111";
  ctx.font = "bold 44px -apple-system, BlinkMacSystemFont, 'Noto Sans TC'";
  ctx.fillText("MIX & MATCH", 44, 72);

  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, 'Noto Sans TC'";
  ctx.fillText(new Date().toLocaleString(), 44, 110);

  // 逐一畫圖（等比例置中）
  const startY = 150;
  let y = startY;
  const pad = 22;
  const boxW = canvas.width - 88; // left/right margin 44
  const boxX = 44;
  const boxH = 150; // 每個欄位高度

  for (const it of selected) {
    // 背板
    ctx.fillStyle = "rgba(0,0,0,.03)";
    roundRect(ctx, boxX, y, boxW, boxH, 22);
    ctx.fill();

    // label
    ctx.fillStyle = "#222";
    ctx.font = "bold 26px -apple-system, BlinkMacSystemFont, 'Noto Sans TC'";
    ctx.fillText(`${CAT_LABEL[it.category] || ""}：${it.name || "未命名"}`, boxX + 20, y + 42);

    // image
    if (it.imageBlob) {
      const img = await loadImageFromBlob(it.imageBlob);
      const imgBoxX = boxX + 20;
      const imgBoxY = y + 58;
      const imgBoxW = boxW - 40;
      const imgBoxH = boxH - 78;

      const scale = Math.min(imgBoxW / img.width, imgBoxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const dx = imgBoxX + (imgBoxW - w) / 2;
      const dy = imgBoxY + (imgBoxH - h) / 2;

      ctx.save();
      roundRect(ctx, imgBoxX, imgBoxY, imgBoxW, imgBoxH, 18);
      ctx.clip();
      ctx.drawImage(img, dx, dy, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, 'Noto Sans TC'";
      ctx.fillText("No Image", boxX + 20, y + 110);
    }

    y += boxH + pad;
    if (y > canvas.height - 120) break;
  }

  toast("已合成");
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function saveCanvasAsImage() {
  const canvas = $("#composeCanvas");
  canvas.toBlob((blob) => {
    if (!blob) { toast("輸出失敗"); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outfit_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast("已嘗試下載/另存（iOS 可能需長按）");
  }, "image/png");
}

// ---------- Reload ----------
async function reloadItems() {
  items = await dbListItems();
  renderWardrobe();
  updatePickedLabels();
}

// ---------- SW ----------
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    // scope 必須是 ./ 才能在 /wardrobe-ai/ 子路徑正確
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch {
    // ignore
  }
}
async function checkSWUpdate() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    await reg.update();
  } catch {}
}
async function clearCachesKeepDB() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    toast("已清除快取，請重開網頁", 2400);
  } catch (e) {
    toast(`清除失敗：${String(e?.message || e)}`);
  }
}

// ---------- Settings: healthz ----------
async function testHealthz() {
  try {
    const base = getWorkerBase();
    const res = await fetch(`${base}/healthz`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) {
      $("#healthBox").textContent = `失敗：${data?.error || res.status}`;
      toast("測試失敗");
      return;
    }
    $("#healthBox").textContent = JSON.stringify(data, null, 2);
    toast("OK");
  } catch (e) {
    $("#healthBox").textContent = `錯誤：${String(e?.message || e)}`;
    toast("測試失敗");
  }
}

// ---------- Boot ----------
function bindEvents() {
  // weather
  $("#btnLocate").addEventListener("click", refreshByGPS);
  $("#btnRefresh").addEventListener("click", async () => {
    await checkSWUpdate();
    toast("已請求更新");
    refreshByGPS();
    reloadItems();
  });

  // tabs
  $$(".navBtn").forEach((b) => {
    b.addEventListener("click", () => setTab(b.dataset.tab));
  });

  // filter chips
  $$("#filterRow .chip").forEach((c) => {
    c.addEventListener("click", () => {
      $$("#filterRow .chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      filter = c.dataset.filter;
      renderWardrobe();
    });
  });

  // FAB（關鍵：直接綁在固定按鈕上，不依賴頁面重繪）
  const fab = $("#fabAdd");
  fab.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openAddModal();
  });

  // modal close
  $("#btnCloseModal").addEventListener("click", () => hideModal("#modalItem"));
  $("#modalItem").addEventListener("click", (e) => {
    if (e.target && e.target.id === "modalItem") hideModal("#modalItem");
  });

  // modal category
  $$("#catRow .catBtn").forEach((b) => {
    b.addEventListener("click", () => setModalCategory(b.dataset.cat));
  });

  // image input
  $("#inputImage").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    draftImageBlob = await fileToBlob(file);
    setModalPreview(draftImageBlob);
  });

  // AI describe
  $("#btnAIDescribe").addEventListener("click", aiDescribeCurrentImage);

  // save/delete
  $("#btnSaveItem").addEventListener("click", saveModalItem);
  $("#btnDeleteItem").addEventListener("click", deleteModalItem);

  // outfit pickers
  $$(".btnPick").forEach((b) => {
    b.addEventListener("click", () => openPicker(b.dataset.slot));
  });

  $("#btnClosePicker").addEventListener("click", () => hideModal("#modalPicker"));
  $("#modalPicker").addEventListener("click", (e) => {
    if (e.target && e.target.id === "modalPicker") hideModal("#modalPicker");
  });
  $("#btnPickerDone").addEventListener("click", applyPicker);
  $("#btnPickerClear").addEventListener("click", clearPickerSlot);

  $("#btnClearOutfit").addEventListener("click", () => {
    for (const k of Object.keys(outfitSel)) outfitSel[k] = null;
    updatePickedLabels();
    toast("已清空");
  });

  $("#btnCompose").addEventListener("click", composeOutfit);
  $("#btnSaveCompose").addEventListener("click", saveCanvasAsImage);

  // settings
  $("#workerBase").value = getWorkerBase();
  $("#btnSaveWorker").addEventListener("click", () => {
    const v = $("#workerBase").value.trim();
    if (!v) { toast("請輸入 Worker Base"); return; }
    setWorkerBase(v);
    toast("已儲存");
  });
  $("#btnTestHealthz").addEventListener("click", testHealthz);

  $("#btnClearCaches").addEventListener("click", clearCachesKeepDB);
  $("#btnShowUpdateTip").addEventListener("click", () => {
    toast("若仍舊版：網址加 ?update=999 或清除快取後重開", 2600);
  });
}

async function boot() {
  // PWA
  await registerSW();

  // first render from cache
  const cached = readWeatherCache();
  if (cached) renderWeather(cached);

  // default tab
  setTab("wardrobe");

  // bind UI
  bindEvents();

  // load items
  await reloadItems();

  // try auto weather once
  refreshByGPS();

  // keep SW fresh (especially when ?update=... )
  checkSWUpdate();

  // if URL contains update=, give user a hint
  const u = new URL(location.href);
  if (u.searchParams.has("update")) {
    toast("已進入更新模式：若畫面怪，請到設定→清除快取後重開", 2600);
  }
}

document.addEventListener("DOMContentLoaded", boot);