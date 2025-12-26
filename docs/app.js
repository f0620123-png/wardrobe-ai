import { ImageDB } from "./db.js";

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

const LS_KEY = "wardrobe-ai/items-v2"; // v2：imageUrl 改成 imageKey

let state = {
  page: "wardrobe",
  cat: "all",
  items: loadItems(),
  urlCache: new Map(), // imageKey -> objectURL
  editingId: null,
};

const $ = (id) => document.getElementById(id);

init();

function init() {
  bindNav();
  renderChips();
  renderCount();
  renderGrid();
  bindAddFlow();
  initEditModal();
}

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
}

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

  // 先畫 skeleton（避免等待圖片讀取造成空白）
  grid.innerHTML = list.map(it => `
    <button class="card" data-id="${it.id}">
      <img data-img="${it.imageKey}" alt="" />
      <div class="cardTitle">${escapeHtml(it.name)}</div>
      <div class="tag">${catLabel(it.category)}・${it.tempMin}~${it.tempMax}°C</div>
    </button>
  `).join("");

  // 綁定點擊 → 編輯
  grid.querySelectorAll(".card").forEach((c) => {
    c.addEventListener("click", () => openEdit(c.dataset.id));
  });

  // 逐張補上圖片
  const imgs = grid.querySelectorAll("img[data-img]");
  for (const img of imgs) {
    const key = img.getAttribute("data-img");
    const url = await getObjectUrl(key);
    if (url) img.src = url;
  }
}

function bindAddFlow() {
  const fab = $("fabAdd");
  const menu = $("addMenu");
  const fileInput = $("fileInput");
  const btnPick = $("btnPickPhoto");
  const btnClose = $("btnCloseMenu");

  fab.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
  });

  btnClose.addEventListener("click", () => {
    menu.hidden = true;
  });

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

    // 新增後直接打開編輯面板
    openEdit(item.id);

    fileInput.value = "";
  });
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
    if (e.target.id === "editModal") closeEdit(); // 點背景關閉
  });

  // 分類按鈕
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

  // 高亮分類
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

  // 基本防呆：min <= max
  const minV = Math.min(tempMin, tempMax);
  const maxV = Math.max(tempMin, tempMax);

  item.name = name;
  item.tempMin = minV;
  item.tempMax = maxV;
  item.category = category;

  saveItems(state.items);

  // 如果目前正在某分類，且分類改變，列表要重算
  renderCount();
  await renderGrid();
  closeEdit();
}

async function deleteEdit() {
  const id = state.editingId;
  const idx = state.items.findIndex(x => x.id === id);
  if (idx === -1) return;

  const item = state.items[idx];
  const ok = confirm("確定要刪除此單品？");
  if (!ok) return;

  // 刪圖片 Blob
  if (item.imageKey) {
    await ImageDB.del(item.imageKey);

    // revoke cache URL
    const url = state.urlCache.get(item.imageKey);
    if (url) URL.revokeObjectURL(url);
    state.urlCache.delete(item.imageKey);
  }

  state.items.splice(idx, 1);
  saveItems(state.items);

  renderCount();
  await renderGrid();
  closeEdit();
}

/* ===== Storage ===== */
function loadItems() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveItems(items) {
  localStorage.setItem(LS_KEY, JSON.stringify(items));
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