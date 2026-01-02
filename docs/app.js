/* docs/app.js */

const LS_WEATHER_KEY = "wardrobe.weather.cache.v2";
const LS_WEATHER_TTL_MS = 10 * 60 * 1000; // 10 min
const LS_WORKER_BASE = "wardrobe.worker.base.v1";

const DEFAULT_WORKER_BASE = "https://autumn-cell-d032.f0620123.workers.dev";

let WORKER_BASE = DEFAULT_WORKER_BASE;

let inflight = null; // AbortController for weather
let allItems = [];
let currentFilter = "all";

let modalMode = "new"; // new | edit
let editingId = null;
let previewUrl = null;
let editImageBlob = null;

const mixState = {
  inner: null,
  top: null,
  bottom: null,
  outer: null,
  shoes: null,
  accessory: null,
};

const $ = (sel) => document.querySelector(sel);

function toast(msg, ms = 2200) {
  const el = $("#toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), ms);
}

function qs(name) {
  try { return new URL(location.href).searchParams.get(name); } catch { return null; }
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

function setText(sel, text) {
  const el = $(sel);
  if (el) el.textContent = text;
}
function setHtml(sel, html) {
  const el = $(sel);
  if (el) el.innerHTML = html;
}

function catLabel(cat) {
  return (
    { top: "上衣", bottom: "下身", outer: "外套", shoes: "鞋子", accessory: "配件", inner: "內搭" }[cat] || "未分類"
  );
}

function openModal(id = null) {
  const m = $("#itemModal");
  if (!m) return;
  m.classList.add("show");
  m.setAttribute("aria-hidden", "false");

  $("#aiBox").style.display = "none";
  $("#aiOut").innerHTML = "";

  if (id) {
    modalMode = "edit";
    editingId = id;
    $("#modalTitle").textContent = "編輯單品";
    $("#btnDeleteItem").style.display = "inline-flex";
    loadItemIntoModal(id);
  } else {
    modalMode = "new";
    editingId = null;
    $("#modalTitle").textContent = "新增單品";
    $("#btnDeleteItem").style.display = "none";
    resetModalFields();
  }
}

function closeModal() {
  const m = $("#itemModal");
  if (!m) return;
  m.classList.remove("show");
  m.setAttribute("aria-hidden", "true");
  resetModalFields();
}

function resetModalFields() {
  $("#itemName").value = "";
  $("#itemNote").value = "";
  setCategorySeg("top");

  editImageBlob = null;
  const img = $("#itemPreview");
  const empty = $("#previewEmpty");
  img.style.display = "none";
  empty.style.display = "block";

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  $("#fileInput").value = "";
}

function setCategorySeg(cat) {
  const btns = [...document.querySelectorAll("#catSeg .segBtn")];
  btns.forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
  $("#catSeg").dataset.value = cat;
}
function getCategorySeg() {
  return $("#catSeg").dataset.value || "top";
}

async function loadItemIntoModal(id) {
  const item = await window.WardrobeDB.getItem(id);
  if (!item) {
    toast("找不到該單品");
    closeModal();
    return;
  }

  $("#itemName").value = item.name || "";
  $("#itemNote").value = item.note || "";
  setCategorySeg(item.category || "top");
  editImageBlob = item.imageBlob || null;

  renderPreviewFromBlob(editImageBlob);
}

function renderPreviewFromBlob(blob) {
  const img = $("#itemPreview");
  const empty = $("#previewEmpty");

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  if (!blob) {
    img.style.display = "none";
    empty.style.display = "block";
    return;
  }

  previewUrl = URL.createObjectURL(blob);
  img.src = previewUrl;
  img.onload = () => {
    img.style.display = "block";
    empty.style.display = "none";
  };
}

function openPickModal(slotKey) {
  const m = $("#pickModal");
  if (!m) return;
  m.classList.add("show");
  m.setAttribute("aria-hidden", "false");

  const title = $("#pickTitle");
  title.textContent = `選擇${catLabel(slotKey)}`;

  // map slot to category
  const catMap = {
    inner: "top", // 先用上衣當內搭來源（你後面可另做「內搭」分類）
    top: "top",
    bottom: "bottom",
    outer: "outer",
    shoes: "shoes",
    accessory: "accessory",
  };
  const wantCat = catMap[slotKey];

  const list = allItems.filter((x) => x.category === wantCat);
  const grid = $("#pickGrid");
  grid.innerHTML = "";

  if (!list.length) {
    grid.innerHTML = `<div class="hintEmpty">這個分類目前沒有單品，先去衣櫃新增。</div>`;
    return;
  }

  for (const it of list) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="thumb"><div class="noimg">載入中…</div></div>
      <div class="cardBody">
        <div class="cardTitle">${escapeHtml(it.name || "未命名")}</div>
        <div class="cardMeta"><span class="badge">${catLabel(it.category)}</span></div>
      </div>
    `;
    card.addEventListener("click", async () => {
      mixState[slotKey] = it.id;
      $("#slot-" + slotKey).textContent = it.name || "已選";
      closePickModal();
      toast("已選擇：" + (it.name || "單品"), 1200);
    });
    grid.appendChild(card);

    // thumb
    const thumb = card.querySelector(".thumb");
    const blob = it.imageBlob || null;
    if (!blob) {
      thumb.innerHTML = `<div class="noimg">無圖片</div>`;
    } else {
      const url = URL.createObjectURL(blob);
      thumb.innerHTML = `<img alt="thumb">`;
      const img = thumb.querySelector("img");
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);
      img.onerror = () => URL.revokeObjectURL(url);
    }
  }
}

function closePickModal() {
  const m = $("#pickModal");
  if (!m) return;
  m.classList.remove("show");
  m.setAttribute("aria-hidden", "true");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- weather ---------- */
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

  const url = `${WORKER_BASE}/weather/now?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;

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
    parts.push("保暖內層（發熱衣/長袖）", "厚外套（羽絨/羊毛）", "長褲", "可加圍巾/帽");
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
    parts.push("無袖/短袖", "輕薄透氣", "防曬（帽/袖套/薄外套）");
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

  setText("#tempText", `${temp}°${unit}`);
  setText("#feelsText", `體感 ${feels}°${unit}`);
  setText("#metaText", `風 ${wind} m/s · 降雨 ${rain} mm · 來源 ${w.provider}`);

  const rec = recommendOutfit(feels, rain, wind);
  setHtml(
    "#outfitHint",
    `
      <div class="hintTitle">今日體感：${rec.level}</div>
      <ul class="hintList">
        ${rec.parts.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}
      </ul>
    `
  );
}

async function refreshByGPS() {
  try {
    setLoading(true);

    const cached = readWeatherCache();
    if (cached) {
      renderWeather(cached);
      setLoading(false);
      toast("已顯示快取天氣，背景更新中…", 1400);
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

/* ---------- AI analyze (optional) ---------- */
async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function aiAnalyzeImage() {
  try {
    if (!editImageBlob) return toast("先選擇圖片");
    $("#aiBox").style.display = "none";
    $("#aiOut").innerHTML = "";

    toast("AI 分析中…", 1200);

    const b64 = await blobToBase64(editImageBlob);
    const res = await fetch(`${WORKER_BASE}/ai/wardrobe/analyze-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: b64,
        // 你也可以把目前已填文字傳上去，讓 AI 更準
        text_hint: `${$("#itemName").value || ""} ${$("#itemNote").value || ""}`.trim(),
        locale: "zh-TW",
      }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) {
      throw new Error(data?.error || `AI error (${res.status})`);
    }

    // 期望回傳：
    // data.description: 一段完整描述
    // data.fields: { color, material, fit, length, occasion, season, category? }
    const desc = data.description || "";
    const fields = data.fields || {};

    // 類別若有回來就套用
    if (fields.category && ["top","bottom","outer","shoes","accessory"].includes(fields.category)) {
      setCategorySeg(fields.category);
    }

    // 備註自動補上（不覆蓋使用者已輸入的內容；改成 append）
    const note = $("#itemNote").value || "";
    const lines = [];
    if (fields.color) lines.push(`顏色：${fields.color}`);
    if (fields.material) lines.push(`材質：${fields.material}`);
    if (fields.fit) lines.push(`版型：${fields.fit}`);
    if (fields.length) lines.push(`長度：${fields.length}`);
    if (fields.occasion) lines.push(`場合：${fields.occasion}`);
    if (fields.season) lines.push(`季節：${fields.season}`);

    const toAppend = lines.length ? lines.join(" / ") : "";
    if (toAppend && !note.includes(toAppend)) {
      $("#itemNote").value = note ? (note + "\n" + toAppend) : toAppend;
    }

    $("#aiOut").innerHTML = `
      <div style="font-weight:900;margin-bottom:6px;">AI 描述</div>
      <div style="line-height:1.6;margin-bottom:10px;">${escapeHtml(desc)}</div>
      <div style="font-weight:900;margin-bottom:6px;">解析欄位</div>
      <div style="line-height:1.6;">
        ${Object.entries(fields).map(([k,v]) => `<div><b>${escapeHtml(k)}</b>：${escapeHtml(v)}</div>`).join("")}
      </div>
    `;
    $("#aiBox").style.display = "block";

    toast("AI 分析完成");
  } catch (e) {
    toast(`AI 失敗：${String(e?.message || e)}`);
  }
}

/* ---------- Closet render ---------- */
async function loadAndRender() {
  allItems = await window.WardrobeDB.listItems();
  renderCloset();
  syncMixSlotLabels();
}

function renderCloset() {
  const grid = $("#closetGrid");
  grid.innerHTML = "";

  const list = allItems.filter((it) => currentFilter === "all" ? true : it.category === currentFilter);

  if (!list.length) {
    grid.innerHTML = `<div class="hintEmpty">目前沒有單品。點右下角「＋」新增。</div>`;
    return;
  }

  for (const it of list) {
    const card = document.createElement("div");
    card.className = "card";
    card.addEventListener("click", () => openModal(it.id));

    card.innerHTML = `
      <div class="thumb"><div class="noimg">載入中…</div></div>
      <div class="cardBody">
        <div class="cardTitle">${escapeHtml(it.name || "未命名")}</div>
        <div class="cardMeta">
          <span class="badge">${catLabel(it.category)}</span>
        </div>
      </div>
    `;

    grid.appendChild(card);

    const thumb = card.querySelector(".thumb");
    const blob = it.imageBlob || null;
    if (!blob) {
      thumb.innerHTML = `<div class="noimg">無圖片</div>`;
    } else {
      const url = URL.createObjectURL(blob);
      thumb.innerHTML = `<img alt="thumb">`;
      const img = thumb.querySelector("img");
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);
      img.onerror = () => URL.revokeObjectURL(url);
    }
  }
}

/* ---------- Save / Delete ---------- */
async function saveItem() {
  try {
    const name = $("#itemName").value.trim() || "未命名";
    const category = getCategorySeg();
    const note = $("#itemNote").value.trim();

    if (!editImageBlob && modalMode === "new") {
      // 允許無圖，但提醒
      toast("提醒：你還沒選圖片（可先存）", 1500);
    }

    const now = Date.now();
    const id = modalMode === "edit" ? editingId : `it_${now}_${Math.random().toString(16).slice(2)}`;

    const prev = modalMode === "edit" ? (await window.WardrobeDB.getItem(id)) : null;

    const item = {
      id,
      name,
      category,
      note,
      imageBlob: editImageBlob || prev?.imageBlob || null,
      createdAt: prev?.createdAt || now,
      updatedAt: now,
    };

    await window.WardrobeDB.putItem(item);

    toast("已儲存");
    closeModal();
    await loadAndRender();
  } catch (e) {
    toast(`儲存失敗：${String(e?.message || e)}`);
  }
}

async function removeItem() {
  if (!editingId) return;
  if (!confirm("確定要刪除此單品？")) return;
  try {
    await window.WardrobeDB.deleteItem(editingId);

    // 若該單品被選入穿搭，也順便清掉
    for (const k of Object.keys(mixState)) {
      if (mixState[k] === editingId) mixState[k] = null;
    }

    toast("已刪除");
    closeModal();
    await loadAndRender();
  } catch (e) {
    toast(`刪除失敗：${String(e?.message || e)}`);
  }
}

/* ---------- Mix compose ---------- */
function syncMixSlotLabels() {
  for (const k of Object.keys(mixState)) {
    const id = mixState[k];
    const el = $("#slot-" + k);
    if (!el) continue;
    if (!id) { el.textContent = "未選"; continue; }
    const it = allItems.find((x) => x.id === id);
    el.textContent = it?.name || "已選";
  }
}

async function drawCompose() {
  const canvas = $("#composeCanvas");
  const ctx = canvas.getContext("2d");

  // background
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // title
  ctx.fillStyle = "#111111";
  ctx.font = "bold 40px system-ui";
  ctx.fillText("MIX & MATCH · Outfit", 36, 64);

  // weather small
  const cached = readWeatherCache();
  if (cached) {
    ctx.font = "600 22px system-ui";
    ctx.fillStyle = "#555";
    ctx.fillText(
      `體感 ${cached.feels_like}°${cached.unit || "C"} · 風 ${cached.wind_speed} m/s · 雨 ${cached.precipitation} mm`,
      36, 104
    );
  }

  // layout 2 columns
  const slots = [
    ["inner","內搭"],
    ["top","上衣"],
    ["bottom","下身"],
    ["outer","外套"],
    ["shoes","鞋子"],
    ["accessory","配件"],
  ];

  const boxW = (canvas.width - 36*2 - 18) / 2;
  const boxH = (canvas.height - 140 - 36 - 18*2) / 3;

  let i = 0;
  for (let r=0; r<3; r++){
    for (let c=0; c<2; c++){
      const x = 36 + c*(boxW+18);
      const y = 140 + r*(boxH+18);

      // frame
      ctx.fillStyle = "#FAFAFA";
      ctx.strokeStyle = "rgba(0,0,0,.12)";
      roundRect(ctx, x, y, boxW, boxH, 22, true, true);

      const [key,label] = slots[i++];
      ctx.fillStyle = "#333";
      ctx.font = "bold 22px system-ui";
      ctx.fillText(label, x+18, y+34);

      const id = mixState[key];
      const it = id ? allItems.find((z)=>z.id===id) : null;

      if (!it || !it.imageBlob) {
        ctx.fillStyle = "#999";
        ctx.font = "700 18px system-ui";
        ctx.fillText("未選擇", x+18, y+70);
        continue;
      }

      // draw image
      const img = await blobToImage(it.imageBlob);
      const imgAreaX = x + 14;
      const imgAreaY = y + 56;
      const imgAreaW = boxW - 28;
      const imgAreaH = boxH - 70;

      drawContain(ctx, img, imgAreaX, imgAreaY, imgAreaW, imgAreaH);

      // name
      ctx.fillStyle = "#444";
      ctx.font = "700 16px system-ui";
      ctx.fillText(trunc(it.name || "", 22), x+18, y+boxH-16);
    }
  }

  toast("合成完成（可匯出 PNG）", 1400);
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function trunc(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n-1) + "…" : s;
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function drawContain(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.min(w/iw, h/ih);
  const nw = iw*s, nh = ih*s;
  const nx = x + (w - nw)/2;
  const ny = y + (h - nh)/2;
  ctx.drawImage(img, nx, ny, nw, nh);
}

function exportPNG() {
  const canvas = $("#composeCanvas");
  const a = document.createElement("a");
  a.download = `wardrobe-outfit-${Date.now()}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

/* ---------- Settings + SW ---------- */
async function checkSWUpdate(force = false) {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    await reg.update();
    if (force) {
      // best effort: ask SW to skipWaiting by reloading
      location.reload();
    }
  } catch {}
}

async function clearSiteCachesAndReload() {
  try {
    // unregister SW
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    // clear CacheStorage
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {}
  location.href = "./?update=1&t=" + Date.now();
}

async function testHealthz() {
  try {
    const out = $("#healthOut");
    out.textContent = "連線中…";
    const res = await fetch(`${WORKER_BASE}/healthz`, { cache: "no-store" });
    const j = await res.json().catch(() => null);
    out.textContent = JSON.stringify(j, null, 2);
    toast("已測試");
  } catch (e) {
    $("#healthOut").textContent = String(e?.message || e);
    toast("測試失敗");
  }
}

/* ---------- Seed demo ---------- */
async function seedDemo() {
  if (!confirm("要建立示範資料嗎？（不會覆蓋你現有資料）")) return;
  const now = Date.now();
  const demo = [
    { name: "示範：黑色外套", category: "outer", note: "示範資料（可刪）" },
    { name: "示範：白色上衣", category: "top", note: "示範資料（可刪）" },
    { name: "示範：深色長褲", category: "bottom", note: "示範資料（可刪）" },
  ];
  for (let i=0;i<demo.length;i++){
    await window.WardrobeDB.putItem({
      id: `demo_${now}_${i}`,
      ...demo[i],
      imageBlob: null,
      createdAt: now+i,
      updatedAt: now+i,
    });
  }
  toast("示範資料已建立");
  await loadAndRender();
}

/* ---------- Tabs ---------- */
function setTab(tab) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("#page-closet").classList.toggle("active", tab === "closet");
  $("#page-mix").classList.toggle("active", tab === "mix");
  $("#page-settings").classList.toggle("active", tab === "settings");
}

/* ---------- Boot ---------- */
async function boot() {
  // worker base from storage
  const saved = localStorage.getItem(LS_WORKER_BASE);
  WORKER_BASE = saved || DEFAULT_WORKER_BASE;
  $("#workerBase").value = WORKER_BASE;

  // bind tabs
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // bind chips
  document.querySelectorAll("#filterChips .chip").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#filterChips .chip").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      currentFilter = b.dataset.filter;
      renderCloset();
    });
  });

  // buttons
  $("#btnAddItem").addEventListener("click", () => openModal());
  $("#btnCloseModal").addEventListener("click", closeModal);
  $("#btnSaveItem").addEventListener("click", saveItem);
  $("#btnDeleteItem").addEventListener("click", removeItem);

  $("#btnClosePick").addEventListener("click", closePickModal);

  document.querySelectorAll(".modalMask").forEach((m) =>
    m.addEventListener("click", (e) => {
      if (e.target?.dataset?.close) {
        closeModal();
        closePickModal();
      }
    })
  );

  // category seg
  document.querySelectorAll("#catSeg .segBtn").forEach((b) => {
    b.addEventListener("click", () => setCategorySeg(b.dataset.cat));
  });

  // file input
  $("#fileInput").addEventListener("change", async (e) => {
    try {
      const f = e.target.files?.[0];
      if (!f) return;
      const blob = await window.WardrobeDB.fileToJpegBlob(f);
      editImageBlob = blob;
      renderPreviewFromBlob(editImageBlob);

      // name default
      if (!$("#itemName").value.trim()) $("#itemName").value = f.name.replace(/\.[^.]+$/, "");
      toast("圖片已載入", 1200);
    } catch (err) {
      toast("圖片載入失敗");
    }
  });

  // AI analyze
  $("#btnAIAnalyze").addEventListener("click", aiAnalyzeImage);

  // weather
  $("#btnLocate").addEventListener("click", refreshByGPS);
  $("#btnRefreshRules").addEventListener("click", () => {
    const cached = readWeatherCache();
    if (cached) renderWeather(cached);
    else toast("尚無天氣資料，請先定位");
  });

  // mix slot click
  document.querySelectorAll(".slot").forEach((b) => {
    b.addEventListener("click", () => openPickModal(b.dataset.slot));
  });
  $("#btnCompose").addEventListener("click", drawCompose);
  $("#btnExport").addEventListener("click", exportPNG);
  $("#btnClearMix").addEventListener("click", () => {
    for (const k of Object.keys(mixState)) mixState[k] = null;
    syncMixSlotLabels();
    toast("已清空");
  });

  // settings
  $("#workerBase").addEventListener("change", () => {
    const v = $("#workerBase").value.trim();
    if (!v) return;
    WORKER_BASE = v.replace(/\/+$/,"");
    localStorage.setItem(LS_WORKER_BASE, WORKER_BASE);
    toast("已更新 Worker Base");
  });

  $("#btnHealth").addEventListener("click", testHealthz);
  $("#btnClearCache").addEventListener("click", clearSiteCachesAndReload);
  $("#btnSeed").addEventListener("click", seedDemo);

  // register SW
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js?v=5", { scope: "./" });
    } catch {}
  }

  // if update=1 => hard refresh caches
  if (qs("update") === "1") {
    // 主動更新 SW，並在下一次重新載入後穩定
    try { await checkSWUpdate(false); } catch {}
  }

  // initial render
  await loadAndRender();

  // weather cache fast
  const cached = readWeatherCache();
  if (cached) renderWeather(cached);

  // auto refresh once
  refreshByGPS().catch(()=>{});
}

document.addEventListener("DOMContentLoaded", boot);