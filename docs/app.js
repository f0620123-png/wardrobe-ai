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
  const wind = w.wind_speed;
  const rain = w.precipitation;
  const unit = w.unit || "C";

  setText("#tempText", `${temp}°${unit}`);
  setText("#feelsText", `體感 ${feels}°${unit}`);
  setText("#metaText", `風 ${wind} m/s · 降雨 ${rain} mm · 來源 ${w.provider}`);

  const rec = recommendOutfit(feels, rain, wind);
  setHtml("#outfitHint", `
    <div class="hintTitle">今日體感：${rec.level}</div>
    <ul class="hintList">
      ${rec.parts.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}
    </ul>
  `);
}

// ---------- main flow (weather) ----------
async function refreshByGPS() {
  try {
    setLoading(true);

    const cached = readWeatherCache();
    if (cached) {
      renderWeather(cached);
      setLoading(false);
      toast("已顯示快取天氣，背景更新中…", 1600);
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

// ---------- service worker ----------
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
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
async function clearCachesOnly() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    toast("已清除快取，請重新整理", 2000);
  } catch {
    toast("清除快取失敗");
  }
}

// ---------- routing ----------
function showPage(name) {
  const map = {
    wardrobe: "#pageWardrobe",
    mix: "#pageMix",
    settings: "#pageSettings",
  };
  $$(".page").forEach(p => p.classList.remove("active"));
  const sel = map[name] || map.wardrobe;
  const page = $(sel);
  if (page) page.classList.add("active");

  $$(".navBtn").forEach(b => b.classList.toggle("active", b.dataset.nav === name));
}

// ---------- Wardrobe state ----------
const CAT_LABEL = {
  inner: "內搭",
  top: "上衣",
  bottom: "下身",
  outer: "外套",
  shoes: "鞋子",
  accessory: "配件",
};

let state = {
  items: [],
  filter: "all",
  editingId: null,
  pickSlot: null,
  mix: { inner:null, top:null, bottom:null, outer:null, shoes:null, accessory:null }
};

// ---------- render wardrobe ----------
function renderWardrobe() {
  const grid = $("#wardrobeGrid");
  const empty = $("#emptyWardrobe");
  if (!grid) return;

  const list = state.items.filter(it => {
    if (state.filter === "all") return true;
    return it.cat === state.filter;
  });

  setText("#countText", String(state.items.length));

  if (list.length === 0) {
    grid.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  grid.innerHTML = list.map(it => {
    const name = it.name?.trim() || "未命名";
    const tag = CAT_LABEL[it.cat] || "未分類";
    const hasImg = !!(it.imageDataUrl && String(it.imageDataUrl).startsWith("data:"));
    return `
      <article class="itemCard" data-id="${escapeAttr(it.id)}">
        <div class="itemImgWrap">
          ${hasImg
            ? `<img loading="lazy" alt="${escapeAttr(name)}" src="${escapeAttr(it.imageDataUrl)}" />`
            : `<div class="noImg">No Image</div>`
          }
        </div>
        <div class="itemBody">
          <div class="itemName">${escapeHtml(name)}</div>
          <div class="itemTag">${escapeHtml(tag)}</div>
        </div>
      </article>
    `;
  }).join("");

  // click open edit
  $$("#wardrobeGrid .itemCard").forEach(card => {
    card.addEventListener("click", () => openEditModal(card.dataset.id));
  });
}

// ---------- modal controls ----------
function openModal() {
  $("#modalMask").style.display = "block";
  $("#itemModal").style.display = "block";
  document.body.style.overflow = "hidden";
}
function closeModal() {
  $("#modalMask").style.display = "none";
  $("#itemModal").style.display = "none";
  document.body.style.overflow = "";
  state.editingId = null;
  resetModalFields();
}

function openPicker() {
  $("#pickerMask").style.display = "block";
  $("#pickerModal").style.display = "block";
  document.body.style.overflow = "hidden";
}
function closePicker() {
  $("#pickerMask").style.display = "none";
  $("#pickerModal").style.display = "none";
  document.body.style.overflow = "";
  state.pickSlot = null;
}

// ---------- image handling ----------
async function fileToDataUrl(file, maxSide = 1100, quality = 0.88) {
  // 轉 DataURL，並做簡單縮圖（避免太大）
  const img = await loadImageFromFile(file);
  const { w, h } = fitContain(img.width, img.height, maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  // 優先 jpeg（容量小），但若原圖 png/透明也可改成 png
  const mime = "image/jpeg";
  const dataUrl = canvas.toDataURL(mime, quality);
  return dataUrl;
}
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("圖片讀取失敗")); };
    img.src = url;
  });
}
function fitContain(w, h, maxSide) {
  if (w <= maxSide && h <= maxSide) return { w, h };
  const r = w / h;
  if (w >= h) return { w: maxSide, h: Math.round(maxSide / r) };
  return { w: Math.round(maxSide * r), h: maxSide };
}

// ---------- AI (default auto-run) ----------
async function aiAnalyzeImage(dataUrl) {
  const base = getWorkerBase();
  const url = `${base}/ai/wardrobe/analyze-image`;
  const payload = {
    image: dataUrl,
    lang: "zh-TW",
    // 你 Worker 若有用到 prompt，可吃這個：
    prompt: "請判斷這件衣服的類別（內搭/上衣/下身/外套/鞋子/配件），並用一段話描述顏色、材質、版型、厚薄與適合穿搭情境。最後給一個簡短名稱。請用繁體中文。"
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const j = await res.json().catch(() => null);
  if (!res.ok || !j || j.ok !== true) {
    const msg = j?.error || `AI 解析失敗 (${res.status})`;
    throw new Error(msg);
  }
  return j;
}

async function aiAutofillText(text) {
  const base = getWorkerBase();
  const url = `${base}/ai/wardrobe/autofill`;
  const payload = { text };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const j = await res.json().catch(() => null);
  if (!res.ok || !j || j.ok !== true) {
    const msg = j?.error || `AI 補全失敗 (${res.status})`;
    throw new Error(msg);
  }
  return j;
}

function normalizeAiResult(aiJson) {
  // 容錯：不同版本 Worker 回傳欄位可能不同
  // 期待：name / category(cat) / description(text) 類
  const out = {
    name: "",
    cat: "",
    desc: ""
  };

  const obj = aiJson?.data || aiJson?.result || aiJson;

  // name
  out.name = obj?.name || obj?.title || obj?.item_name || "";

  // cat
  const rawCat = obj?.cat || obj?.category || obj?.type || "";
  out.cat = mapCat(rawCat);

  // desc
  out.desc =
    obj?.description ||
    obj?.desc ||
    obj?.note ||
    obj?.text ||
    obj?.analysis ||
    "";

  // 有些 Worker 直接回文字：{ ok:true, text:"..." }
  if (!out.desc && typeof aiJson?.text === "string") out.desc = aiJson.text;

  return out;
}

function mapCat(x) {
  const s = String(x || "").toLowerCase();

  // 直接是我們內部代碼
  if (["inner","top","bottom","outer","shoes","accessory"].includes(s)) return s;

  // 中文/英文容錯
  if (s.includes("內")) return "inner";
  if (s.includes("上")) return "top";
  if (s.includes("下")) return "bottom";
  if (s.includes("外")) return "outer";
  if (s.includes("鞋")) return "shoes";
  if (s.includes("配")) return "accessory";

  if (s.includes("inner")) return "inner";
  if (s.includes("top") || s.includes("shirt") || s.includes("tee")) return "top";
  if (s.includes("bottom") || s.includes("pants") || s.includes("skirt")) return "bottom";
  if (s.includes("outer") || s.includes("jacket") || s.includes("coat")) return "outer";
  if (s.includes("shoe") || s.includes("sneaker")) return "shoes";
  if (s.includes("access")) return "accessory";

  return ""; // unknown
}

// ---------- modal fields ----------
function resetModalFields() {
  $("#itemName").value = "";
  $("#itemNote").value = "";
  $("#itemAiNote").value = "";
  $("#itemImage").value = "";
  $("#aiState").textContent = "AI：尚未分析";
  setPreview("", false);
  setCatActive("");
}

function setPreview(dataUrl, hasImg) {
  const img = $("#itemPreview");
  const ph = $("#previewPlaceholder");
  if (hasImg && dataUrl) {
    img.src = dataUrl;
    img.style.display = "block";
    ph.style.display = "none";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
    ph.style.display = "grid";
  }
}

function setCatActive(cat) {
  $$(".catBtn").forEach(b => b.classList.toggle("active", b.dataset.cat === cat));
  $("#itemModal").dataset.cat = cat || "";
}

function getCatActive() {
  return $("#itemModal").dataset.cat || "";
}

// ---------- open add / edit ----------
function openAddModal() {
  state.editingId = null;
  $("#modalTitle").textContent = "新增單品";
  $("#btnDeleteItem").style.display = "none";
  resetModalFields();
  openModal();
}

async function openEditModal(id) {
  const it = await WardrobeDB.getItem(id);
  if (!it) return;

  state.editingId = id;
  $("#modalTitle").textContent = "編輯單品";
  $("#btnDeleteItem").style.display = "block";

  $("#itemName").value = it.name || "";
  $("#itemNote").value = it.note || "";
  $("#itemAiNote").value = it.aiNote || "";
  setCatActive(it.cat || "");
  setPreview(it.imageDataUrl || "", !!it.imageDataUrl);

  $("#aiState").textContent = it.aiNote ? "AI：已填入（可編輯）" : "AI：尚未分析";
  openModal();
}

// ---------- save/delete ----------
async function saveItem() {
  const name = $("#itemName").value.trim();
  const note = $("#itemNote").value.trim();
  const aiNote = $("#itemAiNote").value.trim();
  const cat = getCatActive() || "top";

  const existing = state.editingId ? await WardrobeDB.getItem(state.editingId) : null;

  const item = {
    id: existing?.id,
    createdAt: existing?.createdAt,
    imageDataUrl: existing?.imageDataUrl || "",
    name,
    note,
    aiNote,
    cat,
  };

  const saved = await WardrobeDB.upsertItem(item);
  await reloadItems();

  closeModal();
  toast("已儲存");
  return saved;
}

async function deleteCurrentItem() {
  if (!state.editingId) return;
  const ok = confirm("確定要刪除這個單品？");
  if (!ok) return;

  await WardrobeDB.deleteItem(state.editingId);
  await reloadItems();
  closeModal();
  toast("已刪除");
}

// ---------- wardrobe load ----------
async function reloadItems() {
  state.items = await WardrobeDB.listItems();
  renderWardrobe();
}

// ---------- filter chips ----------
function bindFilters() {
  $$("#filterRow .chip").forEach(ch => {
    ch.addEventListener("click", () => {
      $$("#filterRow .chip").forEach(x => x.classList.remove("active"));
      ch.classList.add("active");
      state.filter = ch.dataset.filter;
      renderWardrobe();
    });
  });
}

// ---------- FAB add (fix iOS click issue) ----------
function bindFab() {
  const fab = $("#fabAdd");
  if (!fab) return;

  // click
  fab.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openAddModal();
  });

  // iOS Safari：有些情境 click 不觸發，補 touchstart
  fab.addEventListener("touchstart", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openAddModal();
  }, { passive: false });
}

// ---------- image select & AI auto-run ----------
async function onPickImage(file) {
  if (!file) return;

  $("#aiState").textContent = "AI：分析中…";
  toast("圖片處理中…", 1200);

  try {
    const dataUrl = await fileToDataUrl(file);
    setPreview(dataUrl, true);

    // 先暫存到現有 item（避免中途關掉）
    const existing = state.editingId ? await WardrobeDB.getItem(state.editingId) : null;
    const draft = {
      id: existing?.id,
      createdAt: existing?.createdAt,
      name: $("#itemName").value.trim(),
      note: $("#itemNote").value.trim(),
      aiNote: $("#itemAiNote").value.trim(),
      cat: getCatActive() || existing?.cat || "top",
      imageDataUrl: dataUrl,
    };
    const savedDraft = await WardrobeDB.upsertItem(draft);
    state.editingId = savedDraft.id; // 若原本是新增，這裡會拿到 id，避免圖片丟失
    $("#btnDeleteItem").style.display = "block";

    // === Auto AI ===
    let ai;
    try {
      ai = await aiAnalyzeImage(dataUrl);
    } catch (err) {
      $("#aiState").textContent = `AI：失敗（${String(err?.message || err)}）`;
      toast("AI 解析失敗（可能是 Worker 配額/上游限制）");
      await reloadItems();
      return;
    }

    const n = normalizeAiResult(ai);
    if (n.name && !$("#itemName").value.trim()) $("#itemName").value = n.name;
    if (n.cat) setCatActive(n.cat);

    // AI 描述放到 aiNote（可編輯）
    if (n.desc) $("#itemAiNote").value = n.desc;

    $("#aiState").textContent = "AI：已完成（可編輯）";

    // 保存一次
    await WardrobeDB.upsertItem({
      id: state.editingId,
      name: $("#itemName").value.trim(),
      note: $("#itemNote").value.trim(),
      aiNote: $("#itemAiNote").value.trim(),
      cat: getCatActive() || "top",
      imageDataUrl: dataUrl,
    });

    await reloadItems();
    toast("AI 已填入完成");
  } catch (e) {
    $("#aiState").textContent = "AI：尚未分析";
    toast(`圖片處理失敗：${String(e?.message || e)}`);
  }
}

async function removeImage() {
  const it = state.editingId ? await WardrobeDB.getItem(state.editingId) : null;
  setPreview("", false);
  $("#itemImage").value = "";
  if (it) {
    await WardrobeDB.upsertItem({ ...it, imageDataUrl: "" });
    await reloadItems();
  }
  toast("已移除圖片");
}

// ---------- Mix (picker) ----------
function bindMix() {
  $("#btnMixClear").addEventListener("click", () => {
    state.mix = { inner:null, top:null, bottom:null, outer:null, shoes:null, accessory:null };
    renderMixSlots();
    toast("已清空");
  });

  $$(".slotBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const slot = btn.dataset.pick;
      openPickForSlot(slot);
    });
  });

  $("#btnCompose").addEventListener("click", composeOutfit);
}

function renderMixSlots() {
  for (const k of Object.keys(state.mix)) {
    const id = state.mix[k];
    const it = id ? state.items.find(x => x.id === id) : null;
    setText(`#slotText_${k}`, it ? (it.name?.trim() || "未命名") : "未選擇");
  }
}

function openPickForSlot(slot) {
  state.pickSlot = slot;
  $("#pickerTitle").textContent = `選擇${CAT_LABEL[slot] || "單品"}`;

  const list = state.items.filter(it => it.cat === slot);
  const grid = $("#pickerGrid");
  const empty = $("#pickerEmpty");

  if (!grid) return;
  if (list.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
  } else {
    empty.style.display = "none";
    grid.innerHTML = list.map(it => {
      const name = it.name?.trim() || "未命名";
      const hasImg = !!(it.imageDataUrl && String(it.imageDataUrl).startsWith("data:"));
      return `
        <article class="itemCard" data-pickid="${escapeAttr(it.id)}">
          <div class="itemImgWrap">
            ${hasImg ? `<img loading="lazy" src="${escapeAttr(it.imageDataUrl)}" alt="${escapeAttr(name)}" />`
                    : `<div class="noImg">No Image</div>`}
          </div>
          <div class="itemBody">
            <div class="itemName">${escapeHtml(name)}</div>
            <div class="itemTag">${escapeHtml(CAT_LABEL[it.cat] || "未分類")}</div>
          </div>
        </article>
      `;
    }).join("");

    $$("#pickerGrid .itemCard").forEach(card => {
      card.addEventListener("click", () => {
        const id = card.dataset.pickid;
        state.mix[slot] = id;
        renderMixSlots();
        closePicker();
      });
    });
  }

  openPicker();
}

async function composeOutfit() {
  // 簡單合成：把已選的單品圖片依序貼到 canvas（示意）
  const picks = ["inner","top","bottom","outer","shoes","accessory"]
    .map(k => state.mix[k])
    .filter(Boolean)
    .map(id => state.items.find(x => x.id === id))
    .filter(Boolean);

  if (picks.length === 0) {
    toast("請先選擇至少一件單品");
    return;
  }

  const canvas = $("#composeCanvas");
  const ph = $("#composePlaceholder");
  const ctx = canvas.getContext("2d");

  // 白底
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // 標題
  ctx.fillStyle = "#111827";
  ctx.font = "bold 34px system-ui, -apple-system";
  ctx.fillText("MIX & MATCH", 36, 58);

  // 逐張貼圖（簡易 grid）
  const cols = 2;
  const gap = 18;
  const cellW = (canvas.width - 36*2 - gap) / cols;
  const cellH = 260;

  let i = 0;
  for (const it of picks) {
    const x = 36 + (i % cols) * (cellW + gap);
    const y = 86 + Math.floor(i / cols) * (cellH + gap);

    // 卡片底
    roundRect(ctx, x, y, cellW, cellH, 18, "#f3f4f6");

    // 圖
    if (it.imageDataUrl) {
      try {
        const img = await loadImageFromDataUrl(it.imageDataUrl);
        // contain
        const pad = 12;
        const boxW = cellW - pad*2;
        const boxH = 170;
        const fit = containRect(img.width, img.height, boxW, boxH);
        ctx.drawImage(img, x + pad + fit.dx, y + pad + fit.dy, fit.dw, fit.dh);
      } catch {}
    }

    // 文字
    ctx.fillStyle = "#111827";
    ctx.font = "bold 20px system-ui, -apple-system";
    ctx.fillText((it.name?.trim() || "未命名").slice(0, 14), x + 14, y + 210);

    ctx.fillStyle = "#6b7280";
    ctx.font = "bold 16px system-ui, -apple-system";
    ctx.fillText(CAT_LABEL[it.cat] || "未分類", x + 14, y + 236);

    i++;
  }

  ph.style.display = "none";
  canvas.style.display = "block";
  toast("已合成（可長按另存）");
}

function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}
function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("圖片載入失敗"));
    img.src = dataUrl;
  });
}
function containRect(w, h, boxW, boxH) {
  const r = w / h;
  let dw = boxW, dh = boxH;
  if (dw / dh > r) dw = dh * r;
  else dh = dw / r;
  const dx = (boxW - dw) / 2;
  const dy = (boxH - dh) / 2;
  return { dw, dh, dx, dy };
}

// ---------- Settings ----------
function bindSettings() {
  const input = $("#workerBase");
  const saved = localStorage.getItem(LS_WORKER_BASE) || DEFAULT_WORKER_BASE;
  input.value = saved;

  $("#btnSaveWorker").addEventListener("click", () => {
    const v = input.value.trim().replace(/\/+$/,"");
    if (!v.startsWith("http")) return toast("請輸入有效的 https://xxxxx.workers.dev");
    localStorage.setItem(LS_WORKER_BASE, v);
    toast("已儲存 Worker Base");
  });

  $("#btnTestHealth").addEventListener("click", async () => {
    const base = getWorkerBase();
    try {
      $("#healthStatus").textContent = "測試中…";
      const res = await fetch(`${base}/healthz`, { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || j.ok !== true) throw new Error(j?.error || "healthz 失敗");
      $("#healthStatus").textContent = `OK · ${j.service || ""} · ${j.version || ""} · ${j.weather_provider || ""}`;
      toast("healthz OK");
    } catch (e) {
      $("#healthStatus").textContent = `失敗：${String(e?.message || e)}`;
      toast("healthz 失敗");
    }
  });

  $("#btnClearCaches").addEventListener("click", async () => {
    const ok = confirm("確定清除瀏覽器快取？（不會刪衣櫃資料）");
    if (!ok) return;
    await clearCachesOnly();
  });

  $("#btnShowUpdateTip").addEventListener("click", () => {
    alert("若更新後畫面不對：\n1) 右上角更新\n2) 網址加 ?update=999\n3) iOS Safari 清除本網站資料");
  });
}

// ---------- update param handling ----------
async function handleUpdateParam() {
  const qs = new URLSearchParams(location.search);
  const u = qs.get("update");
  if (!u) return;

  // update=1：嘗試更新 SW
  if (u === "1") {
    await checkSWUpdate();
    return;
  }

  // update=999：強制清 cache + 更新 SW（不動 IndexedDB 衣櫃）
  if (u === "999") {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      await clearCachesOnly();
      toast("已強制更新，請重新整理", 2200);
    } catch {}
  }
}

// ---------- escape helpers ----------
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// ---------- boot ----------
async function boot() {
  // DB legacy import first
  await WardrobeDB.importLegacyOnce();
  await reloadItems();
  renderMixSlots();

  // Bind navigation
  $$(".navBtn").forEach(btn => {
    btn.addEventListener("click", () => showPage(btn.dataset.nav));
  });

  // Top refresh
  $("#btnRefresh").addEventListener("click", async () => {
    await checkSWUpdate();
    await reloadItems();
    toast("已更新");
  });

  // Weather bind
  $("#btnLocate").addEventListener("click", refreshByGPS);

  // Filters
  bindFilters();

  // FAB (fix)
  bindFab();

  // Modal binds
  $("#btnCloseModal").addEventListener("click", closeModal);
  $("#modalMask").addEventListener("click", closeModal);

  $("#btnSaveItem").addEventListener("click", async () => {
    // 若沒填 AI note，但有文字備註，試著自動補
    const aiNote = $("#itemAiNote").value.trim();
    const note = $("#itemNote").value.trim();
    if (!aiNote && note) {
      $("#aiState").textContent = "AI：補全中…";
      try {
        const j = await aiAutofillText(note);
        const n = normalizeAiResult(j);
        if (n.desc) $("#itemAiNote").value = n.desc;
        if (n.name && !$("#itemName").value.trim()) $("#itemName").value = n.name;
        if (n.cat) setCatActive(n.cat);
        $("#aiState").textContent = "AI：已完成（可編輯）";
      } catch (e) {
        $("#aiState").textContent = "AI：補全失敗（可忽略）";
      }
    }

    await saveItem();
  });

  $("#btnDeleteItem").addEventListener("click", deleteCurrentItem);

  // Category btns
  $$(".catBtn").forEach(b => {
    b.addEventListener("click", () => setCatActive(b.dataset.cat));
  });

  // Image input
  $("#itemImage").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) await onPickImage(file);
  });
  $("#btnRemoveImage").addEventListener("click", removeImage);

  // Picker binds
  $("#btnClosePicker").addEventListener("click", closePicker);
  $("#pickerMask").addEventListener("click", closePicker);

  // Mix binds
  bindMix();

  // Settings binds
  bindSettings();

  // init weather cache render
  const cached = readWeatherCache();
  if (cached) renderWeather(cached);

  // auto refresh weather once
  refreshByGPS();

  // SW
  await registerSW();
  await checkSWUpdate();

  // update param
  await handleUpdateParam();
}

document.addEventListener("DOMContentLoaded", boot);