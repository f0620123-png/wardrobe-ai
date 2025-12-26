import { ImageDB } from "./db.js";
// 驗收用：強制註銷 Service Worker，避免舊版快取
(async () => {
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
  }
})();
const CATS = [
  { key: "all", label: "全部" },
  { key: "top", label: "上衣" },
  { key: "bottom", label: "下著" },
  { key: "inner", label: "內搭" },
  { key: "outer", label: "外套" },
  { key: "shoes", label: "鞋子" },
  { key: "accessory", label: "配件" },
];

const EDIT_CATS = CATS.filter(c => c.key !== "all");

const LS_ITEMS = "wardrobe-ai/items-v2";
const LS_OUTFITS = "wardrobe-ai/outfits-v1";

const BASIC_ITEMS = [
  { name: "長袖打底（白）", category: "inner", color: "#f4f4f4", tempMin: 8, tempMax: 22 },
  { name: "長袖打底（黑）", category: "inner", color: "#2b2b2b", tempMin: 8, tempMax: 22 },
  { name: "短袖T恤（白）", category: "top", color: "#ffffff", tempMin: 18, tempMax: 32 },
  { name: "短袖T恤（黑）", category: "top", color: "#2b2b2b", tempMin: 18, tempMax: 32 },
  { name: "連帽外套（灰）", category: "outer", color: "#9aa0a6", tempMin: 10, tempMax: 22 },
  { name: "牛仔外套", category: "outer", color: "#5b8bd6", tempMin: 10, tempMax: 22 },
  { name: "牛仔寬褲", category: "bottom", color: "#86b6ff", tempMin: 12, tempMax: 26 },
  { name: "直筒牛仔褲", category: "bottom", color: "#3f7fe0", tempMin: 10, tempMax: 24 },
];

let state = {
  page: "wardrobe",
  cat: "all",
  items: loadItems(),
  outfits: loadOutfits(),
  urlCache: new Map(), // imageKey -> objectURL
  editingId: null,

  // mix
  mix: {
    pickingCat: null,
    selection: {
      inner: null, top: null, bottom: null, outer: null, shoes: null, accessory: null
    }
  }
};

const $ = (id) => document.getElementById(id);

init();

function init() {
  bindNav();
  renderChips();
  renderCount();
  renderGrid();
  bindAddFlow();
  bindQuickFlow();
  initEditModal();
  initMix();
}

/* ===== Nav ===== */
function bindNav() {
  document.querySelectorAll(".bottomNav button").forEach((btn) => {
    btn.addEventListener("click", () => goto(btn.dataset.nav));
  });
}
function goto(page) {
  state.page = page;
  document.querySelectorAll(".page").forEach((p) => (p.hidden = p.dataset.page !== page));
  document.querySelectorAll(".bottomNav button").forEach((b) =>
    b.classList.toggle("on", b.dataset.nav === page)
  );

  if (page === "mix") renderMix(); // 進入自選頁就刷新縮圖
}

/* ===== Wardrobe chips/grid ===== */
function renderChips() {
  const wrap = $("catChips");
  wrap.innerHTML = CATS.map(
    (c) => `<button class="chip ${state.cat === c.key ? "on" : ""}" data-cat="${c.key}">${c.label}</button>`
  ).join("");

  wrap.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      state.cat = b.dataset.cat;
      renderChips();
      renderGrid();
    });
  });
}
function renderCount() {
  $("countText").textContent = `今天收集了 ${state.items.length} 件寶貝`;
}

async function renderGrid() {
  const grid = $("itemGrid");
  const list = state.cat === "all" ? state.items : state.items.filter((x) => x.category === state.cat);

  if (!list.length) {
    grid.innerHTML = `<div class="empty">尚無衣物，點右下角 + 新增</div>`;
    return;
  }

  grid.innerHTML = list.map(it => `
    <button class="card" data-id="${it.id}">
      <img data-img="${it.imageKey}" alt="" />
      <div class="cardTitle">${escapeHtml(it.name)}</div>
      <div class="tag">${catLabel(it.category)}・${it.tempMin}~${it.tempMax}°C</div>
    </button>
  `).join("");

  grid.querySelectorAll(".card").forEach((c) => {
    c.addEventListener("click", () => openEdit(c.dataset.id));
  });

  const imgs = grid.querySelectorAll("img[data-img]");
  for (const img of imgs) {
    const key = img.getAttribute("data-img");
    const url = await getObjectUrl(key);
    if (url) img.src = url;
  }
}

/* ===== Add photo flow ===== */
function bindAddFlow() {
  const fab = $("fabAdd");
  const menu = $("addMenu");
  const fileInput = $("fileInput");
  const btnPick = $("btnPickPhoto");
  const btnClose = $("btnCloseMenu");

  fab.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
  });
  btnClose.addEventListener("click", () => (menu.hidden = true));
  btnPick.addEventListener("click", () => {
    menu.hidden = true;
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const category = state.cat === "all" ? "top" : state.cat;
    const imageKey = crypto.randomUUID();
    await ImageDB.put(imageKey, file);

    const item = {
      id: crypto.randomUUID(),
      name: "新衣物（請編輯名稱）",
      category,
      tempMin: 10,
      tempMax: 25,
      imageKey,
      createdAt: Date.now(),
    };

    state.items.unshift(item);
    saveItems(state.items);
    renderCount();
    await renderGrid();
    openEdit(item.id);

    fileInput.value = "";
  });
}

/* ===== Quick add ===== */
function bindQuickFlow() {
  const fabQuick = $("fabQuick");
  const modal = $("quickModal");
  const grid = $("quickGrid");

  fabQuick.addEventListener("click", () => {
    // render
    grid.innerHTML = BASIC_ITEMS.map((x, i) => `
      <button class="quickItem" data-i="${i}">
        <span class="dot" style="background:${x.color}"></span>
        <span>${escapeHtml(x.name)}</span>
      </button>
    `).join("");

    grid.querySelectorAll(".quickItem").forEach(btn => {
      btn.addEventListener("click", async () => {
        const i = parseInt(btn.dataset.i, 10);
        const x = BASIC_ITEMS[i];
        await addBasicItem(x);
        modal.hidden = true;
      });
    });

    modal.hidden = false;
  });

  $("btnQuickClose").addEventListener("click", () => (modal.hidden = true));
  modal.addEventListener("click", (e) => {
    if (e.target.id === "quickModal") modal.hidden = true;
  });
}

async function addBasicItem(x) {
  // 生成一張簡單 SVG 圓點示意圖（可持久存）
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <circle cx="300" cy="300" r="210" fill="${x.color}"/>
    <text x="300" y="520" text-anchor="middle" font-size="28" font-family="system-ui, -apple-system" fill="#444">${escapeXml(x.name)}</text>
  </svg>`.trim();

  const blob = new Blob([svg], { type: "image/svg+xml" });
  const imageKey = crypto.randomUUID();
  await ImageDB.put(imageKey, blob);

  const item = {
    id: crypto.randomUUID(),
    name: x.name,
    category: x.category,
    tempMin: x.tempMin,
    tempMax: x.tempMax,
    imageKey,
    createdAt: Date.now(),
  };

  state.items.unshift(item);
  saveItems(state.items);
  renderCount();
  await renderGrid();
  openEdit(item.id);
}

/* ===== Image URL Cache ===== */
async function getObjectUrl(imageKey) {
  if (!imageKey) return "";
  if (state.urlCache.has(imageKey)) return state.urlCache.get(imageKey);

  const blob = await ImageDB.get(imageKey);
  if (!blob) return "";

  const url = URL.createObjectURL(blob);
  state.urlCache.set(imageKey, url);
  return url;
}

/* ===== Edit Modal ===== */
function initEditModal() {
  const grid = $("editCatGrid");
  grid.innerHTML = EDIT_CATS.map(c => `<button class="catBtn" data-cat="${c.key}">${c.label}</button>`).join("");

  $("btnEditClose").addEventListener("click", closeEdit);
  $("editModal").addEventListener("click", (e) => {
    if (e.target.id === "editModal") closeEdit();
  });

  grid.querySelectorAll(".catBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      grid.querySelectorAll(".catBtn").forEach(b => b.classList.remove("on"));
      btn.classList.add("on");
    });
  });

  $("btnEditSave").addEventListener("click", saveEdit);
  $("btnEditDelete").addEventListener("click", deleteEdit);
}

function openEdit(id) {
  const item = state.items.find(x => x.id === id);
  if (!item) return;

  state.editingId = id;

  $("editName").value = item.name ?? "";
  $("editTempMin").value = String(item.tempMin ?? "");
  $("editTempMax").value = String(item.tempMax ?? "");

  const grid = $("editCatGrid");
  grid.querySelectorAll(".catBtn").forEach(b => {
    b.classList.toggle("on", b.dataset.cat === item.category);
  });

  $("editModal").hidden = false;
}
function closeEdit() {
  $("editModal").hidden = true;
  state.editingId = null;
}
function readSelectedCategory() {
  const on = $("editCatGrid").querySelector(".catBtn.on");
  return on ? on.dataset.cat : "top";
}
async function saveEdit() {
  const id = state.editingId;
  const item = state.items.find(x => x.id === id);
  if (!item) return;

  const name = $("editName").value.trim() || "未命名單品";
  const tempMin = toInt($("editTempMin").value, 10);
  const tempMax = toInt($("editTempMax").value, 25);
  const category = readSelectedCategory();

  const minV = Math.min(tempMin, tempMax);
  const maxV = Math.max(tempMin, tempMax);

  item.name = name;
  item.tempMin = minV;
  item.tempMax = maxV;
  item.category = category;

  saveItems(state.items);
  renderCount();
  await renderGrid();
  toast("已儲存修改");
  closeEdit();
}
async function deleteEdit() {
  const id = state.editingId;
  const idx = state.items.findIndex(x => x.id === id);
  if (idx === -1) return;

  const item = state.items[idx];
  const ok = confirm("確定要刪除此單品？");
  if (!ok) return;

  if (item.imageKey) {
    await ImageDB.del(item.imageKey);
    const url = state.urlCache.get(item.imageKey);
    if (url) URL.revokeObjectURL(url);
    state.urlCache.delete(item.imageKey);
  }

  state.items.splice(idx, 1);
  saveItems(state.items);

  renderCount();
  await renderGrid();
  toast("已刪除");
  closeEdit();
}

/* ===== Mix & Match ===== */
function initMix() {
  $("mixGrid").querySelectorAll(".slot").forEach(btn => {
    btn.addEventListener("click", () => openPickSheet(btn.dataset.slot));
  });

  $("btnPickClose").addEventListener("click", closePickSheet);
  $("pickSheet").addEventListener("click", (e) => {
    if (e.target.id === "pickSheet") closePickSheet();
  });

  $("btnPickNone").addEventListener("click", () => {
    const cat = state.mix.pickingCat;
    if (!cat) return;
    state.mix.selection[cat] = null;
    closePickSheet();
    renderMix();
  });

  $("btnSaveOutfit").addEventListener("click", () => saveOutfit());
}

function openPickSheet(cat) {
  state.mix.pickingCat = cat;
  $("pickTitle").textContent = `選擇${catLabel(cat)}`;

  // 過濾該分類衣物（依 createdAt 新到舊）
  const list = state.items
    .filter(x => x.category === cat)
    .sort((a,b) => (b.createdAt||0) - (a.createdAt||0));

  const wrap = $("pickList");
  if (!list.length) {
    wrap.innerHTML = `<div class="empty">此分類尚無衣物，先去「衣櫃」新增或用 ⚡ 快速加入</div>`;
  } else {
    wrap.innerHTML = list.map(it => `
      <button class="pickRow" data-id="${it.id}">
        <img data-img="${it.imageKey}" alt="" />
        <div class="pickMeta">
          <div class="pickName">${escapeHtml(it.name)}</div>
          <div class="pickSub">${it.tempMin}~${it.tempMax}°C</div>
        </div>
      </button>
    `).join("");

    wrap.querySelectorAll(".pickRow").forEach(row => {
      row.addEventListener("click", () => {
        state.mix.selection[cat] = row.dataset.id;
        closePickSheet();
        renderMix();
      });
    });

    // 補圖
    (async () => {
      const imgs = wrap.querySelectorAll("img[data-img]");
      for (const img of imgs) {
        const url = await getObjectUrl(img.getAttribute("data-img"));
        if (url) img.src = url;
      }
    })();
  }

  $("pickSheet").hidden = false;
}

function closePickSheet() {
  $("pickSheet").hidden = true;
  state.mix.pickingCat = null;
}

async function renderMix() {
  // 每個槽位顯示選到的縮圖
  const cats = ["inner","top","bottom","outer","shoes","accessory"];
  for (const c of cats) {
    const id = state.mix.selection[c];
    const box = document.querySelector(`.slotThumb[data-thumb="${c}"]`);
    box.innerHTML = "";

    if (!id) continue;
    const item = state.items.find(x => x.id === id);
    if (!item) continue;

    const img = document.createElement("img");
    img.alt = "";
    img.src = await getObjectUrl(item.imageKey);
    box.appendChild(img);
  }
}

function saveOutfit() {
  const outfit = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    selection: { ...state.mix.selection }
  };
  state.outfits.unshift(outfit);
  saveOutfits(state.outfits);
  toast("穿搭已儲存");
}

/* ===== Storage ===== */
function loadItems() {
  try {
    const raw = localStorage.getItem(LS_ITEMS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveItems(items) {
  localStorage.setItem(LS_ITEMS, JSON.stringify(items));
}
function loadOutfits() {
  try {
    const raw = localStorage.getItem(LS_OUTFITS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveOutfits(list) {
  localStorage.setItem(LS_OUTFITS, JSON.stringify(list));
}

/* ===== Utils ===== */
function catLabel(key) {
  return CATS.find((c) => c.key === key)?.label || key;
}
function toInt(v, fallback) {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}
function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (m) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  }[m]));
}
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 1400);
}