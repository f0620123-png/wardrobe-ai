/* docs/app.js */

const DEFAULT_WORKER_BASE = "https://autumn-cell-d032.f0620123.workers.dev";

const LS_WORKER_BASE = "wardrobe.worker.base.v1";
const LS_WEATHER_KEY = "wardrobe.weather.cache.v1";
const LS_WEATHER_TTL_MS = 10 * 60 * 1000;

let inflight = null; // AbortController for weather
let state = {
  filter: "all",
  items: [],
  editingId: null,
  editingImageBlob: null,
  editingCategory: null,
  mix: {
    inner: null,
    top: null,
    bottom: null,
    outer: null,
    shoes: null,
    accessory: null,
  },
};

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);

function toast(msg, ms = 2200) {
  const el = $("#toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), ms);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getWorkerBase() {
  return localStorage.getItem(LS_WORKER_BASE) || DEFAULT_WORKER_BASE;
}

function setLoadingWeather(isLoading) {
  const btn = $("#btnLocate");
  if (btn) {
    btn.disabled = isLoading;
    btn.textContent = isLoading ? "定位中…" : "定位/更新天氣";
  }
  const sk = $("#weatherSkeleton");
  if (sk) sk.style.display = isLoading ? "block" : "none";
}

// ---------- image processing ----------
async function compressImageToBlob(file, maxSize = 1280, quality = 0.86) {
  // iOS / Safari compatibility: use Image + canvas
  const imgURL = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = imgURL;
    });

    const { width, height } = img;
    let tw = width, th = height;
    if (Math.max(width, height) > maxSize) {
      const ratio = maxSize / Math.max(width, height);
      tw = Math.round(width * ratio);
      th = Math.round(height * ratio);
    }

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, tw, th);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(
        (b) => resolve(b),
        "image/jpeg",
        quality
      );
    });

    return blob || file;
  } catch {
    // fallback
    return file;
  } finally {
    URL.revokeObjectURL(imgURL);
  }
}

async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function showImagePreviewFromBlob(blob) {
  const img = $("#itemImagePreview");
  const ph = $("#imgPlaceholder");
  if (!img || !ph) return;

  if (!blob) {
    img.style.display = "none";
    img.removeAttribute("src");
    ph.style.display = "flex";
    return;
  }

  const url = URL.createObjectURL(blob);
  img.onload = () => URL.revokeObjectURL(url);
  img.src = url;
  img.style.display = "block";
  ph.style.display = "none";
}

// ---------- modal ----------
function openModal() {
  const m = $("#modalItem");
  if (!m) return;
  m.classList.add("show");
  m.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  const m = $("#modalItem");
  if (!m) return;
  m.classList.remove("show");
  m.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  clearEditForm();
}

function openPicker() {
  const m = $("#modalPicker");
  if (!m) return;
  m.classList.add("show");
  m.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closePicker() {
  const m = $("#modalPicker");
  if (!m) return;
  m.classList.remove("show");
  m.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function setActiveCategory(cat) {
  state.editingCategory = cat;
  $$(".chip").forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
  $("#catText").textContent = `目前：${catLabel(cat)}`;
}

function clearEditForm() {
  state.editingId = null;
  state.editingImageBlob = null;
  state.editingCategory = null;

  $("#modalTitle").textContent = "新增單品";
  $("#btnDelete").style.display = "none";

  $("#inpName").value = "";
  $("#inpNote").value = "";
  $("#inpAIDesc").value = "";
  $("#inpImage").value = "";

  $$(".chip").forEach((b) => b.classList.remove("active"));
  $("#catText").textContent = "目前：未選";

  showImagePreviewFromBlob(null);
}

function $$ (sel) {
  return Array.from(document.querySelectorAll(sel));
}

// ---------- nav ----------
function showView(name) {
  const map = {
    wardrobe: "#viewWardrobe",
    mix: "#viewMix",
    settings: "#viewSettings",
  };
  Object.values(map).forEach((id) => $(id).classList.remove("active"));
  $(map[name]).classList.add("active");

  $$(".navBtn").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
}

// ---------- data & render ----------
function catLabel(cat) {
  const m = {
    top: "上衣",
    bottom: "下身",
    outer: "外套",
    shoes: "鞋子",
    accessory: "配件",
    inner: "內搭",
  };
  return m[cat] || "未選";
}

function itemMatchesFilter(item, filter) {
  if (filter === "all") return true;
  return item.category === filter;
}

function renderWardrobe() {
  const grid = $("#gridWardrobe");
  const empty = $("#emptyWardrobe");
  if (!grid || !empty) return;

  const items = state.items
    .filter((it) => itemMatchesFilter(it, state.filter))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  empty.style.display = state.items.length === 0 ? "block" : "none";

  grid.innerHTML = items.map((it) => {
    const title = escapeHtml(it.name || `單品 #${it.id}`);
    const sub = escapeHtml(it.aiDesc || it.note || "");
    return `
      <div class="card" data-id="${it.id}">
        <div class="thumb" data-id="${it.id}">
          <img data-img="${it.id}" alt="${title}" />
          <div class="badge">${escapeHtml(catLabel(it.category))}</div>
        </div>
        <div class="cardBody">
          <div class="cardTitle">${title}</div>
          <div class="cardSub">${sub}</div>
        </div>
      </div>
    `;
  }).join("");

  // Attach images from Blob
  for (const it of items) {
    const img = grid.querySelector(`img[data-img="${it.id}"]`);
    if (!img) continue;

    if (it.imageBlob) {
      const url = URL.createObjectURL(it.imageBlob);
      img.onload = () => URL.revokeObjectURL(url);
      img.src = url;
    } else {
      // fallback placeholder
      img.removeAttribute("src");
    }
  }

  // click handlers
  grid.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", async () => {
      const id = Number(card.dataset.id);
      await openEditItem(id);
    });
  });
}

async function loadItems() {
  state.items = await dbGetAllItems();
  renderWardrobe();
  renderMixSlotTexts();
}

async function openEditItem(id) {
  const item = await dbGetItem(id);
  if (!item) return;

  clearEditForm();
  state.editingId = item.id;
  state.editingImageBlob = item.imageBlob || null;
  state.editingCategory = item.category || null;

  $("#modalTitle").textContent = "編輯單品";
  $("#btnDelete").style.display = "inline-flex";

  $("#inpName").value = item.name || "";
  $("#inpNote").value = item.note || "";
  $("#inpAIDesc").value = item.aiDesc || "";

  if (item.category) setActiveCategory(item.category);
  showImagePreviewFromBlob(item.imageBlob || null);

  openModal();
}

async function saveItem() {
  const name = $("#inpName").value.trim();
  const note = $("#inpNote").value.trim();
  const aiDesc = $("#inpAIDesc").value.trim();

  const category = state.editingCategory;
  if (!category) {
    toast("請先選擇分類（上衣/下身/外套/鞋子/配件）");
    return;
  }

  const now = Date.now();
  const existing = state.editingId ? await dbGetItem(state.editingId) : null;

  const item = {
    id: existing?.id,
    name: name || existing?.name || "",
    category,
    note,
    aiDesc,
    imageBlob: state.editingImageBlob || existing?.imageBlob || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await dbPutItem(item);
  toast("已儲存");
  closeModal();
  await loadItems();
}

async function deleteItem() {
  if (!state.editingId) return;
  if (!confirm("確定要刪除這件單品嗎？")) return;
  await dbDeleteItem(state.editingId);
  toast("已刪除");
  closeModal();
  await loadItems();
}

// ---------- weather ----------
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

async function fetchWeather(lat, lon) {
  if (inflight) inflight.abort();
  inflight = new AbortController();

  const base = getWorkerBase();
  const url = `${base}/weather/now?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    signal: inflight.signal,
    cache: "no-store",
  });

  const jsonData = await res.json().catch(() => null);
  if (!res.ok || !jsonData || jsonData.ok !== true) {
    const msg = jsonData?.error || `Weather API error (${res.status})`;
    throw new Error(msg);
  }
  return jsonData;
}

function recommendOutfit(feelsC, precipMm, windMs) {
  const f = Number(feelsC);
  const p = Number(precipMm);
  const w = Number(windMs);

  const parts = [];
  let level = "";

  if (f <= 10) {
    level = "寒冷";
    parts.push("保暖內層（發熱衣/長袖）", "厚外套（羽絨/羊毛）", "長褲", "可加圍巾");
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

function renderWeather(w) {
  const temp = w.temperature;
  const feels = w.feels_like;
  const wind = w.wind_speed;
  const rain = w.precipitation;
  const unit = w.unit || "C";

  $("#tempText").textContent = `${temp}°${unit}`;
  $("#feelsText").textContent = `體感 ${feels}°${unit}`;
  $("#metaText").textContent = `風 ${wind} m/s · 降雨 ${rain} mm · 來源 ${w.provider}`;

  const rec = recommendOutfit(feels, rain, wind);
  $("#outfitHint").innerHTML = `
    <div class="hintTitle">今日體感：${escapeHtml(rec.level)}</div>
    <ul class="hintList">
      ${rec.parts.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}
    </ul>
  `;
}

async function refreshByGPS() {
  try {
    setLoadingWeather(true);

    const cached = readWeatherCache();
    if (cached) renderWeather(cached);

    const pos = await getCurrentPosition();
    const { latitude, longitude } = pos.coords;

    const w = await fetchWeather(latitude, longitude);
    writeWeatherCache(w);
    renderWeather(w);

    toast("天氣已更新");
  } catch (e) {
    toast(`更新失敗：${String(e?.message || e)}`);
  } finally {
    setLoadingWeather(false);
  }
}

// ---------- AI ----------
async function aiAnalyzeImage() {
  try {
    if (!state.editingImageBlob) {
      toast("請先選擇圖片");
      return;
    }
    const base = getWorkerBase();
    const url = `${base}/ai/wardrobe/analyze-image`;

    toast("AI 分析中…", 1200);

    const dataUrl = await blobToDataURL(state.editingImageBlob);
    // dataUrl: "data:image/jpeg;base64,...."
    const base64 = String(dataUrl).split(",")[1] || "";

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: base64,
        lang: "zh-Hant",
        // 你也可傳 user_hint 增加準確度
        user_hint: "請判斷顏色/材質/版型/長度/場合/季節，並生成一段自然中文描述。",
      }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.ok !== true) {
      const msg = json?.error || `AI error (${res.status})`;
      throw new Error(msg);
    }

    // 容錯解析：支援不同 worker 回傳欄位
    const result = json.result || json.data || json.output || json;

    // 你可以在 worker 統一成：{ ok:true, result:{ category, name, note, description } }
    const desc = result.description || result.aiDesc || result.text || "";
    const note = result.note || result.tags || "";
    const cat = result.category || null;
    const name = result.name || "";

    if (name && !$("#inpName").value.trim()) $("#inpName").value = name;
    if (desc) $("#inpAIDesc").value = desc;
    if (note && !$("#inpNote").value.trim()) $("#inpNote").value = String(note);

    if (cat && !state.editingCategory) setActiveCategory(cat);

    toast("AI 已填入建議（可再修改）");
  } catch (e) {
    toast(`AI 失敗：${String(e?.message || e)}`);
  }
}

async function aiAutofillByText() {
  try {
    const text = [
      $("#inpName").value.trim(),
      $("#inpNote").value.trim(),
      $("#inpAIDesc").value.trim(),
    ].filter(Boolean).join("，");

    if (!text) {
      toast("請先輸入一些文字，例如：橄欖綠 短袖 棉質 寬鬆 日常");
      return;
    }

    const base = getWorkerBase();
    const url = `${base}/ai/wardrobe/autofill`;

    toast("AI 補完中…", 1200);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang: "zh-Hant" }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.ok !== true) {
      const msg = json?.error || `AI error (${res.status})`;
      throw new Error(msg);
    }

    const result = json.result || json.data || json.output || json;
    const desc = result.description || result.aiDesc || result.text || "";
    const note = result.note || result.tags || "";
    const cat = result.category || null;
    const name = result.name || "";

    if (name && !$("#inpName").value.trim()) $("#inpName").value = name;
    if (desc) $("#inpAIDesc").value = desc;
    if (note && !$("#inpNote").value.trim()) $("#inpNote").value = String(note);
    if (cat && !state.editingCategory) setActiveCategory(cat);

    toast("AI 已補完（可再修改）");
  } catch (e) {
    toast(`AI 失敗：${String(e?.message || e)}`);
  }
}

// ---------- Mix / Picker ----------
function renderMixSlotTexts() {
  $("#slotInner").textContent = state.mix.inner?.name || "未選";
  $("#slotTop").textContent = state.mix.top?.name || "未選";
  $("#slotBottom").textContent = state.mix.bottom?.name || "未選";
  $("#slotOuter").textContent = state.mix.outer?.name || "未選";
  $("#slotShoes").textContent = state.mix.shoes?.name || "未選";
  $("#slotAccessory").textContent = state.mix.accessory?.name || "未選";
}

function slotToCategory(slot) {
  // 內搭也可用上衣資料，先用 top 類
  if (slot === "inner") return "top";
  return slot;
}

function openPickerForSlot(slot) {
  const category = slotToCategory(slot);
  $("#pickerTitle").textContent = `選擇${catLabel(slot)}`;
  $("#pickerHint").textContent = `類別：${catLabel(category)}`;

  const items = state.items
    .filter((it) => it.category === category)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const grid = $("#pickerGrid");
  grid.innerHTML = items.map((it) => {
    const title = escapeHtml(it.name || `單品 #${it.id}`);
    return `
      <div class="card" data-pick-id="${it.id}">
        <div class="thumb">
          <img data-pick-img="${it.id}" alt="${title}" />
          <div class="badge">${escapeHtml(catLabel(it.category))}</div>
        </div>
        <div class="cardBody">
          <div class="cardTitle">${title}</div>
          <div class="cardSub">${escapeHtml(it.aiDesc || it.note || "")}</div>
        </div>
      </div>
    `;
  }).join("");

  for (const it of items) {
    const img = grid.querySelector(`img[data-pick-img="${it.id}"]`);
    if (!img) continue;
    if (it.imageBlob) {
      const url = URL.createObjectURL(it.imageBlob);
      img.onload = () => URL.revokeObjectURL(url);
      img.src = url;
    }
  }

  grid.querySelectorAll("[data-pick-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const id = Number(card.dataset.pickId);
      const chosen = state.items.find((x) => x.id === id);
      state.mix[slot] = chosen || null;
      renderMixSlotTexts();
      closePicker();
    });
  });

  $("#btnPickNone").onclick = () => {
    state.mix[slot] = null;
    renderMixSlotTexts();
    closePicker();
  };

  openPicker();
}

async function composeMixCanvas() {
  const canvas = $("#mixCanvas");
  const ctx = canvas.getContext("2d");

  // background
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // title area
  ctx.fillStyle = "#111111";
  ctx.font = "bold 42px system-ui, -apple-system";
  ctx.fillText("今日穿搭示意", 42, 78);

  ctx.fillStyle = "#666";
  ctx.font = "bold 22px system-ui, -apple-system";
  ctx.fillText(new Date().toLocaleString("zh-Hant"), 42, 112);

  const slots = [
    ["內搭", state.mix.inner],
    ["上衣", state.mix.top],
    ["下身", state.mix.bottom],
    ["外套", state.mix.outer],
    ["鞋子", state.mix.shoes],
    ["配件", state.mix.accessory],
  ];

  // layout 2 columns
  const padding = 42;
  const gap = 24;
  const colW = (canvas.width - padding * 2 - gap) / 2;
  const rowH = 360;
  const topY = 150;

  // draw cards
  for (let i = 0; i < slots.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);

    const x = padding + col * (colW + gap);
    const y = topY + row * (rowH + gap);

    // card bg
    ctx.fillStyle = "#faf7f1";
    roundRect(ctx, x, y, colW, rowH, 26, true, false);

    // label
    ctx.fillStyle = "#111";
    ctx.font = "bold 28px system-ui, -apple-system";
    ctx.fillText(slots[i][0], x + 22, y + 44);

    const item = slots[i][1];
    if (!item) {
      ctx.fillStyle = "#999";
      ctx.font = "bold 22px system-ui, -apple-system";
      ctx.fillText("未選擇", x + 22, y + 88);
      continue;
    }

    ctx.fillStyle = "#333";
    ctx.font = "bold 22px system-ui, -apple-system";
    ctx.fillText(truncate(item.name || `#${item.id}`, 18), x + 22, y + 88);

    // draw image
    if (item.imageBlob) {
      const img = await blobToImage(item.imageBlob);
      const imgBoxX = x + 22;
      const imgBoxY = y + 110;
      const imgBoxW = colW - 44;
      const imgBoxH = rowH - 140;

      // cover draw
      drawCover(ctx, img, imgBoxX, imgBoxY, imgBoxW, imgBoxH, 20);
    }
  }

  toast("已合成示意圖（可截圖保存）");
}

function truncate(s, n) {
  const t = String(s ?? "");
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawCover(ctx, img, x, y, w, h, r = 0) {
  // clip rounded rect
  ctx.save();
  if (r > 0) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.clip();
  }

  const iw = img.width;
  const ih = img.height;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();

  // border
  ctx.strokeStyle = "rgba(0,0,0,.08)";
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, r, false, true);
}

// ---------- SW ----------
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch {}
}

// ---------- Install prompt ----------
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $("#btnInstall");
  if (btn) btn.style.display = "inline-flex";
});

async function promptInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("#btnInstall").style.display = "none";
}

// ---------- Settings status ----------
async function refreshStatus() {
  const base = getWorkerBase();
  $("#inpWorkerBase").value = base;

  try {
    const res = await fetch(`${base}/healthz`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    $("#preStatus").textContent = JSON.stringify(json || { ok: false }, null, 2);
  } catch (e) {
    $("#preStatus").textContent = `healthz 失敗：${String(e?.message || e)}`;
  }
}

// ---------- events ----------
function bindUI() {
  // bottom nav
  $$(".navBtn").forEach((b) => {
    b.addEventListener("click", () => showView(b.dataset.nav));
  });

  // segments filter
  $$(".segBtn").forEach((b) => {
    b.addEventListener("click", () => {
      $$(".segBtn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      state.filter = b.dataset.filter;
      renderWardrobe();
    });
  });

  // FAB
  $("#fabAdd").addEventListener("click", () => {
    clearEditForm();
    openModal();
  });

  // modal close
  $("#btnCloseModal").addEventListener("click", closeModal);
  $("#modalItem").addEventListener("click", (e) => {
    if (e.target.id === "modalItem") closeModal();
  });

  // picker close
  $("#btnClosePicker").addEventListener("click", closePicker);
  $("#modalPicker").addEventListener("click", (e) => {
    if (e.target.id === "modalPicker") closePicker();
  });

  // category chips
  $$(".chip").forEach((b) => {
    b.addEventListener("click", () => setActiveCategory(b.dataset.cat));
  });

  // image input
  $("#inpImage").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const blob = await compressImageToBlob(f);
    state.editingImageBlob = blob;
    showImagePreviewFromBlob(blob);
  });

  // save/delete
  $("#btnSave").addEventListener("click", saveItem);
  $("#btnDelete").addEventListener("click", deleteItem);

  // weather
  $("#btnLocate").addEventListener("click", refreshByGPS);

  // mix slots
  $$(".slot").forEach((b) => {
    b.addEventListener("click", () => openPickerForSlot(b.dataset.slot));
  });
  $("#btnClearMix").addEventListener("click", () => {
    state.mix = { inner:null, top:null, bottom:null, outer:null, shoes:null, accessory:null };
    renderMixSlotTexts();
    toast("已清空選擇");
  });
  $("#btnCompose").addEventListener("click", composeMixCanvas);

  // AI
  $("#btnAIAnalyze").addEventListener("click", aiAnalyzeImage);
  $("#btnAIText").addEventListener("click", aiAutofillByText);

  // install
  $("#btnInstall").addEventListener("click", promptInstall);

  // settings controls
  $("#inpWorkerBase").addEventListener("change", async (e) => {
    const v = String(e.target.value || "").trim().replace(/\/+$/, "");
    if (!v.startsWith("http")) {
      toast("Worker Base 格式不正確");
      e.target.value = getWorkerBase();
      return;
    }
    localStorage.setItem(LS_WORKER_BASE, v);
    toast("已更新 Worker Base");
    await refreshStatus();
  });

  $("#btnClearCache").addEventListener("click", () => {
    localStorage.removeItem(LS_WEATHER_KEY);
    toast("已清除天氣快取");
  });

  $("#btnClearDB").addEventListener("click", async () => {
    if (!confirm("確定要清空衣櫃資料？（不可復原）")) return;
    await dbClearItems();
    toast("已清空");
    await loadItems();
  });
}

// ---------- boot ----------
async function boot() {
  await registerSW();
  bindUI();

  await loadItems();

  // initial weather
  const cached = readWeatherCache();
  if (cached) renderWeather(cached);
  refreshByGPS();

  // settings status
  await refreshStatus();

  // initial canvas hint
  const c = $("#mixCanvas");
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#111";
  ctx.font = "bold 40px system-ui, -apple-system";
  ctx.fillText("合成示意圖會出現在這裡", 60, 140);
  ctx.fillStyle = "#666";
  ctx.font = "bold 22px system-ui, -apple-system";
  ctx.fillText("先選內搭/上衣/下身/外套/鞋子/配件", 60, 190);
}

document.addEventListener("DOMContentLoaded", boot);