const CATS = [
  { key: "all", label: "全部" },
  { key: "top", label: "上衣" },
  { key: "bottom", label: "下著" },
  { key: "inner", label: "內搭" },
  { key: "outer", label: "外套" },
  { key: "shoes", label: "鞋子" },
  { key: "accessory", label: "配件" },
];

const LS_KEY = "wardrobe-ai/items-v1";

let state = {
  page: "wardrobe",
  cat: "all",
  items: loadItems(),
};

const $ = (id) => document.getElementById(id);

init();

function init() {
  bindNav();
  renderChips();
  renderGrid();
  bindAddFlow();
  renderCount();
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

function renderGrid() {
  const grid = $("itemGrid");
  const list = state.cat === "all" ? state.items : state.items.filter((x) => x.category === state.cat);

  if (!list.length) {
    grid.innerHTML = `<div class="empty">尚無衣物，點右下角 + 新增</div>`;
    return;
  }

  grid.innerHTML = list
    .map(
      (it) => `
      <button class="card" data-id="${it.id}">
        <img src="${it.imageUrl}" alt="" />
        <div class="cardTitle">${escapeHtml(it.name)}</div>
        <div class="tag">${catLabel(it.category)}・${it.tempMin}~${it.tempMax}°C</div>
      </button>
    `
    )
    .join("");

  grid.querySelectorAll(".card").forEach((c) => {
    c.addEventListener("click", () => {
      const id = c.dataset.id;
      const item = state.items.find((x) => x.id === id);
      alert(`（下一步做編輯面板）\n${item.name}\n${catLabel(item.category)}・${item.tempMin}~${item.tempMax}°C`);
    });
  });
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

    // 先用 ObjectURL（關閉頁面會失效），下一步我們會改成存成 base64 或 IndexedDB
    const imageUrl = URL.createObjectURL(file);

    const category = state.cat === "all" ? "top" : state.cat;

    const item = {
      id: crypto.randomUUID(),
      name: `新衣物（示意）`,
      category,
      tempMin: 10,
      tempMax: 25,
      imageUrl,
      createdAt: Date.now(),
    };

    state.items.unshift(item);
    saveItems(state.items);
    renderCount();
    renderGrid();

    fileInput.value = "";
  });
}

function renderCount() {
  $("countText").textContent = `今天收集了 ${state.items.length} 件寶貝`;
}

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

function catLabel(key) {
  return CATS.find((c) => c.key === key)?.label || key;
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
