// ========= Utilities =========
const $ = (id) => document.getElementById(id);
const uid = () => crypto.randomUUID();

const CATS = [
  "全部","上衣","下著","內搭","外套","鞋子","配件","連身","背心","襪子"
];

const QUICK_PRESETS = [
  { name:"長袖打底（白）", cat:"內搭", dot:"#f5f5f5" },
  { name:"長袖打底（黑）", cat:"內搭", dot:"#222222" },
  { name:"短袖T恤（白）", cat:"上衣", dot:"#f5f5f5" },
  { name:"短袖T恤（黑）", cat:"上衣", dot:"#222222" },
  { name:"連帽外套（灰）", cat:"外套", dot:"#9aa0a6" },
  { name:"牛仔外套", cat:"外套", dot:"#6aa6ff" },
  { name:"牛仔寬褲", cat:"下著", dot:"#8bbcff" },
  { name:"直筒牛仔褲", cat:"下著", dot:"#3f7cff" },
];

// ========= IndexedDB =========
const DB_NAME = "wardrobe_ai_db";
const DB_VER = 1;
const STORE = "items";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    const req = st.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDel(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ========= State =========
const state = {
  tab: "wardrobe",
  filterCat: "全部",
  items: [],
  urlCache: new Map(), // id -> objectURL
  editingId: null,
  editingCat: "上衣",
  pendingImageBlob: null,

  mix: {
    pickingCat: null,
    picks: {
      內搭: null,
      上衣: null,
      下著: null,
      外套: null,
      背心: null,
      鞋子: null,
      襪子: null,
      配件: null,
    }
  }
};

// ========= Overlay Manager (核心：避免三層疊開卡頓) =========
function setOverlay(on) {
  document.documentElement.classList.toggle("noScroll", on);
  document.body.classList.toggle("noScroll", on);
}

// 一律先關所有 overlay，再開新的（保證只會有一層）
function closeAllOverlays() {
  $("addMenu").hidden = true;
  $("editModal").hidden = true;
  $("quickModal").hidden = true;
  $("pickMask").hidden = true;
  $("pickSheet").hidden = true;

  state.editingId = null;
  state.mix.pickingCat = null;

  setOverlay(false);
}

// ========= Image URL helper =========
function getItemURL(item) {
  if (!item?.imageBlob) return null;
  if (state.urlCache.has(item.id)) return state.urlCache.get(item.id);
  const url = URL.createObjectURL(item.imageBlob);
  state.urlCache.set(item.id, url);
  return url;
}

function revokeItemURL(id) {
  const url = state.urlCache.get(id);
  if (url) URL.revokeObjectURL(url);
  state.urlCache.delete(id);
}

window.addEventListener("beforeunload", () => {
  for (const url of state.urlCache.values()) URL.revokeObjectURL(url);
  state.urlCache.clear();
});

// ========= Render =========
function render() {
  const app = $("app");
  app.innerHTML = "";

  if (state.tab === "wardrobe") renderWardrobe(app);
  if (state.tab === "mix") renderMix(app);
  if (state.tab === "inspo") renderInspo(app);
  if (state.tab === "me") renderMe(app);

  syncBottomNav();
}

function headerBlock(title, sub) {
  const wrap = document.createElement("div");
  wrap.className = "header";
  wrap.innerHTML = `
    <div class="brand">MY WARDROBE</div>
    <h1>${title}</h1>
    <div class="sub">${sub}</div>
  `;
  return wrap;
}

function renderWardrobe(app) {
  const cnt = state.items.length;
  app.appendChild(headerBlock("我的衣櫃日記", `今天收集了 ${cnt} 件寶貝`));

  // chips
  const chips = document.createElement("div");
  chips.className = "chips";
  for (const c of ["全部","上衣","下著","內搭","外套","鞋子","配件"]) {
    const b = document.createElement("button");
    b.className = "chip" + (state.filterCat === c ? " on" : "");
    b.textContent = c;
    b.addEventListener("click", () => {
      state.filterCat = c;
      render();
    });
    chips.appendChild(b);
  }
  app.appendChild(chips);

  const filtered = state.filterCat === "全部"
    ? state.items
    : state.items.filter(it => it.category === state.filterCat);

  if (filtered.length === 0) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "尚無衣物，點右下角 + 新增";
    app.appendChild(e);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "grid";

  for (const it of filtered.slice().sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0))) {
    const card = document.createElement("button");
    card.className = "card";
    card.type = "button";

    const url = getItemURL(it);
    const img = url ? `<img src="${url}" alt="">` : `<img alt="">`;

    const tempTxt = (it.tempMin != null && it.tempMax != null)
      ? `${it.tempMin}–${it.tempMax}°C`
      : "未設定溫度";

    card.innerHTML = `
      ${img}
      <div class="cardTitle">${escapeHtml(it.title || "(未命名)")}</div>
      <div class="tag">上衣架 · ${it.category} · ${tempTxt}</div>
    `;
    card.addEventListener("click", () => openEdit(it.id));
    grid.appendChild(card);
  }

  app.appendChild(grid);
}

function renderMix(app) {
  app.appendChild(headerBlock("自選穿搭", "點選格子，從衣櫃挑選單品"));

  const title = document.createElement("div");
  title.className = "mixTitle";
  title.innerHTML = `<h2>Mix & Match</h2>`;
  app.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "mixGrid";

  const slots = [
    { cat:"內搭", cls:"slotSmall" },
    { cat:"上衣", cls:"slotSmall" },
    { cat:"下著", cls:"slotSmall" },
    { cat:"外套", cls:"slotSmall" },
    { cat:"背心", cls:"slotSmall" },
    { cat:"鞋子", cls:"slotSmall" },
    { cat:"襪子", cls:"slotSmall" },
    { cat:"配件", cls:"slotWide" },
  ];

  for (const s of slots) {
    const chosenId = state.mix.picks[s.cat];
    const chosen = chosenId ? state.items.find(x => x.id === chosenId) : null;

    const btn = document.createElement("button");
    btn.className = "slot " + (s.cls || "") + (chosen ? " on" : "");
    btn.type = "button";

    if (!chosen) {
      btn.innerHTML = `<span>${s.cat}</span>`;
    } else {
      btn.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:10px; align-items:center;">
          <span class="slotBadge">${s.cat}</span>
          <div style="font-weight:900; color:#111;">${escapeHtml(chosen.title || "(未命名)")}</div>
        </div>
      `;
    }

    btn.addEventListener("click", () => openPickSheet(s.cat));
    grid.appendChild(btn);
  }

  app.appendChild(grid);

  const cta = document.createElement("button");
  cta.className = "btnPrimary";
  cta.textContent = "✨ 虛擬試穿（示意）";
  cta.addEventListener("click", () => {
    closeAllOverlays();
    alert("目前此純 GitHub Pages 版本先提供衣櫃＋自選搭配。\n\n若要做 AI 全身虛擬試穿，需要後端代理（或使用者自行輸入 API Key）。");
  });
  app.appendChild(cta);
}

function renderInspo(app) {
  app.appendChild(headerBlock("穿搭靈感", "此頁先保留為擴充（天氣推薦/AI 示意圖）"));
  const box = document.createElement("div");
  box.className = "empty";
  box.textContent = "先把衣櫃與自選流程穩住，再接天氣推薦與 AI 生成。";
  app.appendChild(box);
}

function renderMe(app) {
  app.appendChild(headerBlock("個人", "本機資料（IndexedDB）儲存在你的裝置"));
  const box = document.createElement("div");
  box.className = "empty";
  box.innerHTML = `
    <div style="font-weight:900; color:#444; margin-bottom:8px;">小提醒</div>
    <div style="line-height:1.6; text-align:left;">
      1) 若你之前啟用過 Service Worker（sw.js），請刪一次網站資料。<br/>
      2) 本專案目前為純前端，AI 生成/試穿需後端或本機輸入 Key（不建議公開）。<br/>
      3) 卡頓主要已由「禁止 overlay 疊開」處理。
    </div>
  `;
  app.appendChild(box);

  const clearBtn = document.createElement("button");
  clearBtn.className = "btnDanger";
  clearBtn.textContent = "清空所有衣櫃資料（本機）";
  clearBtn.addEventListener("click", async () => {
    const ok = confirm("確定清空所有衣物？此動作不可復原。");
    if (!ok) return;
    // delete all
    for (const it of state.items) revokeItemURL(it.id);
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    state.items = [];
    render();
  });
  app.appendChild(clearBtn);
}

function syncBottomNav() {
  const map = {
    wardrobe: $("tabWardrobe"),
    mix: $("tabMix"),
    inspo: $("tabInspo"),
    me: $("tabMe")
  };
  for (const [k, btn] of Object.entries(map)) {
    btn.classList.toggle("on", state.tab === k);
  }
}

// ========= Actions: Add / Edit =========
function openAddMenu() {
  closeAllOverlays();
  $("addMenu").hidden = false;
  setOverlay(true);
}

function closeAddMenu() {
  $("addMenu").hidden = true;
  setOverlay(false);
}

function setCatButtons(current) {
  const grid = $("catGrid");
  grid.innerHTML = "";
  for (const c of CATS.filter(x => x !== "全部")) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "catBtn" + (current === c ? " on" : "");
    b.textContent = c;
    b.addEventListener("click", () => {
      state.editingCat = c;
      setCatButtons(c);
    });
    grid.appendChild(b);
  }
}

function openEdit(id) {
  closeAllOverlays();

  const it = state.items.find(x => x.id === id);
  if (!it) return;

  state.editingId = id;
  state.editingCat = it.category || "上衣";
  state.pendingImageBlob = it.imageBlob || null;

  $("inTitle").value = it.title || "";
  $("inMin").value = it.tempMin ?? "";
  $("inMax").value = it.tempMax ?? "";
  setCatButtons(state.editingCat);

  $("editModal").hidden = false;
  setOverlay(true);
}

function closeEdit() {
  $("editModal").hidden = true;
  state.editingId = null;
  state.pendingImageBlob = null;
  setOverlay(false);
}

async function saveEdit() {
  const id = state.editingId;
  if (!id) return;

  const it = state.items.find(x => x.id === id);
  if (!it) return;

  it.title = ($("inTitle").value || "").trim();
  it.category = state.editingCat;

  const min = parseInt(($("inMin").value || "").trim(), 10);
  const max = parseInt(($("inMax").value || "").trim(), 10);
  it.tempMin = Number.isFinite(min) ? min : null;
  it.tempMax = Number.isFinite(max) ? max : null;

  if (state.pendingImageBlob) it.imageBlob = state.pendingImageBlob;

  it.updatedAt = Date.now();

  await dbPut(it);
  await loadItems();

  closeEdit();
  render();
}

async function deleteEdit() {
  const id = state.editingId;
  if (!id) return;
  const ok = confirm("確定刪除此單品？");
  if (!ok) return;

  await dbDel(id);
  revokeItemURL(id);
  await loadItems();

  closeEdit();
  render();
}

// ========= File add =========
async function handlePickedFile(file) {
  if (!file) return;

  // 新增一筆 item，並直接進入編輯
  const id = uid();
  const item = {
    id,
    title: "",
    category: "上衣",
    tempMin: null,
    tempMax: null,
    imageBlob: file,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await dbPut(item);
  await loadItems();

  closeAddMenu();
  openEdit(id);
  render();
}

// ========= Quick Add =========
function openQuick() {
  closeAllOverlays();
  // build quick grid
  const g = $("quickGrid");
  g.innerHTML = "";
  for (const p of QUICK_PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "quickBtn";
    b.innerHTML = `
      <div class="quickDot" style="background:${p.dot}"></div>
      <div>${escapeHtml(p.name)}</div>
    `;
    b.addEventListener("click", async () => {
      const id = uid();
      const item = {
        id,
        title: p.name,
        category: p.cat,
        tempMin: null,
        tempMax: null,
        imageBlob: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await dbPut(item);
      await loadItems();
      $("quickModal").hidden = true;
      setOverlay(false);
      openEdit(id);
      render();
    });
    g.appendChild(b);
  }

  $("quickModal").hidden = false;
  setOverlay(true);
}

function closeQuick() {
  $("quickModal").hidden = true;
  setOverlay(false);
}

// ========= Pick Sheet =========
function openPickSheet(cat) {
  closeAllOverlays();

  state.mix.pickingCat = cat;
  $("pickTitle").textContent = `選擇${cat}`;
  $("pickBody").innerHTML = "";

  // allow "none"
  const none = document.createElement("button");
  none.type = "button";
  none.className = "pickRow";
  none.innerHTML = `
    <div class="pickThumb"></div>
    <div class="pickMeta">
      <div class="pickName">不選擇此項</div>
      <div class="pickSub">留空</div>
    </div>
  `;
  none.addEventListener("click", () => {
    state.mix.picks[cat] = null;
    closePickSheet();
    render();
  });
  $("pickBody").appendChild(none);

  const list = state.items
    .filter(it => it.category === cat)
    .sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));

  for (const it of list) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "pickRow";

    const url = getItemURL(it);
    const thumb = url
      ? `<img src="${url}" alt="">`
      : "";

    const tempTxt = (it.tempMin != null && it.tempMax != null)
      ? `${it.tempMin}–${it.tempMax}°C`
      : "未設定溫度";

    row.innerHTML = `
      <div class="pickThumb">${thumb}</div>
      <div class="pickMeta">
        <div class="pickName">${escapeHtml(it.title || "(未命名)")}</div>
        <div class="pickSub">${it.category} · ${tempTxt}</div>
      </div>
    `;
    row.addEventListener("click", () => {
      state.mix.picks[cat] = it.id;
      closePickSheet();
      render();
    });
    $("pickBody").appendChild(row);
  }

  $("pickMask").hidden = false;
  $("pickSheet").hidden = false;
  setOverlay(true);
}

function closePickSheet() {
  $("pickMask").hidden = true;
  $("pickSheet").hidden = true;
  state.mix.pickingCat = null;
  setOverlay(false);
}

// ========= Load =========
async function loadItems() {
  state.items = await dbAll();
}

// ========= Events =========
function bind() {
  // tabs
  $("tabWardrobe").addEventListener("click", () => { closeAllOverlays(); state.tab="wardrobe"; render(); });
  $("tabMix").addEventListener("click", () => { closeAllOverlays(); state.tab="mix"; render(); });
  $("tabInspo").addEventListener("click", () => { closeAllOverlays(); state.tab="inspo"; render(); });
  $("tabMe").addEventListener("click", () => { closeAllOverlays(); state.tab="me"; render(); });

  // fab/menu
  $("fabAdd").addEventListener("click", () => {
    if (!$("addMenu").hidden) closeAddMenu();
    else openAddMenu();
  });
  $("fabQuick").addEventListener("click", () => openQuick());

  // menu actions -> file input
  $("btnPickPhoto").addEventListener("click", () => { $("filePicker").click(); });
  $("btnPickFile").addEventListener("click", () => { $("filePicker").click(); });
  $("btnCamera").addEventListener("click", () => { $("cameraPicker").click(); });

  $("filePicker").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    await handlePickedFile(f || null);
  });
  $("cameraPicker").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    await handlePickedFile(f || null);
  });

  // click outside menu closes it
  document.addEventListener("click", (e) => {
    const menu = $("addMenu");
    const fab = $("fabAdd");
    if (menu.hidden) return;
    const inside = menu.contains(e.target) || fab.contains(e.target);
    if (!inside) closeAddMenu();
  });

  // edit modal
  $("btnCloseEdit").addEventListener("click", () => closeEdit());
  $("btnSaveEdit").addEventListener("click", () => saveEdit());
  $("btnDeleteEdit").addEventListener("click", () => deleteEdit());

  // quick modal
  $("btnCloseQuick").addEventListener("click", () => closeQuick());

  // sheet
  $("btnClosePick").addEventListener("click", () => closePickSheet());
  $("pickMask").addEventListener("click", () => closePickSheet());

  // Esc
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllOverlays();
  });
}

// ========= Security/HTML helper =========
function escapeHtml(s) {
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ========= Init =========
(async function init(){
  bind();
  await loadItems();
  render();
})();