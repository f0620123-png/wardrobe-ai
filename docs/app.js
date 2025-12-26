/* docs/app.js (FULL)
   - Wardrobe CRUD (localStorage)
   - FAB menu: gallery / camera / quick add
   - Card click to edit / save / delete
   - Chip filter
   - Bottom tabs: wardrobe / outfit / settings
   - Outfit composer: select items -> canvas composite image
   - Weather module: GPS -> Worker /weather/now -> feels-like + outfit hints
*/

(() => {
  // =========================
  // Config
  // =========================
  const APP_VERSION = "app-v8"; // 你想強制刷新驗收可改這個
  const STORAGE_KEY = "wardrobe.items.v3";
  const STORAGE_UI_KEY = "wardrobe.ui.v1";

  const WORKER_BASE = "https://autumn-cell-d032.f0620123.workers.dev";
  const LS_WEATHER_KEY = "wardrobe.weather.cache.v1";
  const LS_WEATHER_TTL_MS = 10 * 60 * 1000; // 10 min

  const MAX_IMG_W = 900;  // 壓縮後最大寬
  const IMG_QUALITY = 0.82; // jpeg quality

  // =========================
  // DOM helpers
  // =========================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function safeText(el, txt) { if (el) el.textContent = txt; }
  function safeHtml(el, html) { if (el) el.innerHTML = html; }

  // Toast (global for weather embed)
  function toast(msg, ms = 2200) {
    const el = $("#toast");
    if (!el) { alert(msg); return; }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), ms);
  }
  window.toast = toast;

  // =========================
  // State
  // =========================
  let items = [];
  let activeFilter = "all";
  let activeTab = "wardrobe"; // wardrobe | outfit | settings
  let editingId = null;
  let menuOpen = false;

  // outfit composer state
  const outfitPick = {
    top: null,
    bottom: null,
    outer: null,
    shoes: null,
    accessory: null,
  };

  // Weather fetch inflight
  let inflightWeather = null;

  // =========================
  // Storage
  // =========================
  function loadItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(items)) items = [];
    } catch {
      items = [];
    }
  }

  function saveItems() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      toast("儲存失敗：localStorage 空間不足（可能照片太多）。");
    }
  }

  function loadUI() {
    try {
      const raw = localStorage.getItem(STORAGE_UI_KEY);
      if (!raw) return;
      const ui = JSON.parse(raw);
      if (ui?.activeFilter) activeFilter = ui.activeFilter;
      if (ui?.activeTab) activeTab = ui.activeTab;
    } catch {}
  }

  function saveUI() {
    try {
      localStorage.setItem(STORAGE_UI_KEY, JSON.stringify({ activeFilter, activeTab }));
    } catch {}
  }

  // =========================
  // Utils
  // =========================
  function uid() {
    return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }

  function catLabel(cat) {
    return ({
      top: "上衣",
      bottom: "下身",
      outer: "外套",
      shoes: "鞋子",
      accessory: "配件",
    }[cat] || "其他");
  }

  function placeholderForCat(cat) {
    // 可用你自己的 placeholder 圖，這裡用漸層底 + 文字
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#f2f2f2"/>
            <stop offset="1" stop-color="#e7e7e7"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
        <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
          font-size="44" fill="#999" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto">
          ${catLabel(cat)}
        </text>
      </svg>
    `)}`;
  }

  async function fileToDataURL(file) {
    const buf = await file.arrayBuffer();
    const blob = new Blob([buf], { type: file.type || "image/jpeg" });
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function compressImageDataURL(dataUrl) {
    // 將圖片壓成 JPEG（縮小尺寸）以降低 localStorage 壓力
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.width;
        const h = img.height;
        const scale = Math.min(1, MAX_IMG_W / w);
        const nw = Math.round(w * scale);
        const nh = Math.round(h * scale);

        const canvas = document.createElement("canvas");
        canvas.width = nw;
        canvas.height = nh;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, nw, nh);

        try {
          const out = canvas.toDataURL("image/jpeg", IMG_QUALITY);
          resolve(out);
        } catch {
          resolve(dataUrl); // fallback
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function pickFirstByCat(cat) {
    const list = items.filter(i => i.category === cat);
    return list.length ? list[0].id : null;
  }

  // =========================
  // Menu / Modal
  // =========================
  function openMenu() {
    menuOpen = true;
    const menu = $("#menu");
    if (menu) menu.style.display = "block";
  }

  function closeMenu() {
    menuOpen = false;
    const menu = $("#menu");
    if (menu) menu.style.display = "none";
  }

  function toggleMenu() {
    if (menuOpen) closeMenu();
    else openMenu();
  }

  function openModal(mode, item) {
    // mode: "add" | "edit"
    const modal = $("#modal");
    if (!modal) return;
    modal.style.display = "flex";

    const title = $("#modalTitle");
    const name = $("#itemName");
    const note = $("#itemNote");
    const del = $("#modalDelete");

    if (mode === "add") {
      editingId = null;
      safeText(title, "新增單品");
      if (name) name.value = "";
      if (note) note.value = "";
      setCategoryUI("top");
      if (del) del.style.display = "none";
    } else {
      editingId = item.id;
      safeText(title, "編輯單品");
      if (name) name.value = item.name || "";
      if (note) note.value = item.note || "";
      setCategoryUI(item.category || "top");
      if (del) del.style.display = "block";
    }
  }

  function closeModal() {
    const modal = $("#modal");
    if (modal) modal.style.display = "none";
  }

  function getSelectedCategory() {
    const btn = $("#catGrid .catBtn.on");
    return btn?.dataset?.cat || "top";
  }

  function setCategoryUI(cat) {
    $$("#catGrid .catBtn").forEach(b => b.classList.toggle("on", b.dataset.cat === cat));
  }

  // =========================
  // Render: Wardrobe list
  // =========================
  function filteredItems() {
    if (activeFilter === "all") return items.slice().sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
    return items
      .filter(i => i.category === activeFilter)
      .slice()
      .sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  }

  function renderGrid() {
    const grid = $("#grid");
    const empty = $("#empty");
    if (!grid) return;

    const list = filteredItems();
    grid.innerHTML = "";

    if (empty) empty.style.display = (list.length === 0) ? "block" : "none";

    list.forEach(item => {
      const btn = document.createElement("button");
      btn.className = "card";
      btn.type = "button";
      btn.dataset.id = item.id;

      const img = document.createElement("img");
      img.alt = item.name || "item";
      img.loading = "lazy";
      img.src = item.imageDataUrl || placeholderForCat(item.category);

      const title = document.createElement("div");
      title.className = "cardTitle";
      title.textContent = item.name || "(未命名單品)";

      const tag = document.createElement("div");
      tag.className = "tag";
      tag.textContent = catLabel(item.category);

      btn.appendChild(img);
      btn.appendChild(title);
      btn.appendChild(tag);

      btn.addEventListener("click", () => {
        const it = items.find(x => x.id === item.id);
        if (!it) return;
        openModal("edit", it);
      });

      grid.appendChild(btn);
    });
  }

  // =========================
  // Chips
  // =========================
  function bindChips() {
    $$(".chips .chip").forEach(chip => {
      chip.addEventListener("click", () => {
        $$(".chips .chip").forEach(c => c.classList.remove("on"));
        chip.classList.add("on");
        activeFilter = chip.dataset.filter || "all";
        saveUI();
        renderGrid();
      });
    });
    // apply initial
    const init = $(`.chips .chip[data-filter="${activeFilter}"]`);
    if (init) {
      $$(".chips .chip").forEach(c => c.classList.remove("on"));
      init.classList.add("on");
    }
  }

  // =========================
  // Bottom tabs
  // =========================
  function setTab(tab) {
    activeTab = tab;
    saveUI();

    // basic UX: show/hide sections
    // wardrobe: show chips + grid
    // outfit: show outfit composer section (we inject if not present)
    // settings: show settings section (inject)
    const chips = $(".chips");
    const gridWrap = $("#grid")?.parentElement; // section
    const header = $(".header");

    // Ensure sections exist
    ensureOutfitSection();
    ensureSettingsSection();

    const outfitSec = $("#outfitSection");
    const settingsSec = $("#settingsSection");

    if (tab === "wardrobe") {
      if (chips) chips.style.display = "flex";
      if (gridWrap) gridWrap.style.display = "block";
      if (outfitSec) outfitSec.style.display = "none";
      if (settingsSec) settingsSec.style.display = "none";
      if (header) header.style.display = "block";
    } else if (tab === "outfit") {
      if (chips) chips.style.display = "none";
      if (gridWrap) gridWrap.style.display = "none";
      if (outfitSec) outfitSec.style.display = "block";
      if (settingsSec) settingsSec.style.display = "none";
      if (header) header.style.display = "block";
      renderOutfitComposer();
    } else {
      if (chips) chips.style.display = "none";
      if (gridWrap) gridWrap.style.display = "none";
      if (outfitSec) outfitSec.style.display = "none";
      if (settingsSec) settingsSec.style.display = "block";
      if (header) header.style.display = "block";
    }

    // nav UI
    $$(".bottomNav button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  }

  function bindBottomNav() {
    $$(".bottomNav button").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        if (!tab) return;
        setTab(tab);
      });
    });
    setTab(activeTab);
  }

  // =========================
  // File inputs (gallery/camera)
  // =========================
  function ensureFileInputs() {
    if ($("#fileGallery")) return;

    const g = document.createElement("input");
    g.id = "fileGallery";
    g.type = "file";
    g.accept = "image/*";
    g.style.display = "none";

    const c = document.createElement("input");
    c.id = "fileCamera";
    c.type = "file";
    c.accept = "image/*";
    c.capture = "environment";
    c.style.display = "none";

    document.body.appendChild(g);
    document.body.appendChild(c);

    g.addEventListener("change", async () => {
      const file = g.files?.[0];
      g.value = "";
      if (!file) return;
      await addItemFromFile(file);
    });

    c.addEventListener("change", async () => {
      const file = c.files?.[0];
      c.value = "";
      if (!file) return;
      await addItemFromFile(file);
    });
  }

  async function addItemFromFile(file) {
    try {
      toast("處理圖片中…", 1200);
      let dataUrl = await fileToDataURL(file);
      dataUrl = await compressImageDataURL(dataUrl);

      const newItem = {
        id: uid(),
        name: file.name?.replace(/\.(jpg|jpeg|png|webp|heic|heif)$/i, "") || "新單品",
        note: "",
        category: "top",
        imageDataUrl: dataUrl,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      items.unshift(newItem);
      saveItems();
      renderGrid();
      toast("已新增單品");
      openModal("edit", newItem);
    } catch (e) {
      toast(`新增失敗：${String(e?.message || e)}`);
    }
  }

  // =========================
  // Quick add
  // =========================
  function quickAdd() {
    const samples = [
      { name: "白色短袖 T（示意）", category: "top", note: "棉質 / 日常", imageDataUrl: "" },
      { name: "深色牛仔褲（示意）", category: "bottom", note: "修身 / 通勤", imageDataUrl: "" },
      { name: "薄外套（示意）", category: "outer", note: "防風 / 早晚溫差", imageDataUrl: "" },
      { name: "白鞋（示意）", category: "shoes", note: "百搭", imageDataUrl: "" },
    ].map(s => ({
      id: uid(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...s
    }));

    items = [...samples, ...items];
    saveItems();
    renderGrid();
    toast("已快速加入示例單品");
  }

  // =========================
  // CRUD actions
  // =========================
  function saveFromModal() {
    const name = $("#itemName")?.value?.trim() || "";
    const note = $("#itemNote")?.value?.trim() || "";
    const cat = getSelectedCategory();

    if (!name) {
      toast("請輸入名稱");
      return;
    }

    if (!editingId) {
      // add new (no image)
      const it = {
        id: uid(),
        name,
        note,
        category: cat,
        imageDataUrl: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      items.unshift(it);
      saveItems();
      renderGrid();
      toast("已新增");
      closeModal();
      return;
    }

    const idx = items.findIndex(x => x.id === editingId);
    if (idx < 0) {
      toast("找不到該單品（可能已刪除）");
      closeModal();
      return;
    }

    items[idx] = {
      ...items[idx],
      name,
      note,
      category: cat,
      updatedAt: Date.now(),
    };
    saveItems();
    renderGrid();
    toast("已儲存");
    closeModal();
  }

  function deleteFromModal() {
    if (!editingId) return;
    const it = items.find(x => x.id === editingId);
    if (!it) { closeModal(); return; }

    const ok = confirm(`確定刪除「${it.name || "未命名"}」？`);
    if (!ok) return;

    items = items.filter(x => x.id !== editingId);
    saveItems();
    renderGrid();
    toast("已刪除");
    closeModal();
  }

  // =========================
  // Outfit composer (Canvas)
  // =========================
  function ensureOutfitSection() {
    if ($("#outfitSection")) return;

    const host = $("#app");
    if (!host) return;

    const sec = document.createElement("section");
    sec.id = "outfitSection";
    sec.style.display = "none";
    sec.style.marginTop = "14px";

    sec.innerHTML = `
      <div class="hintBox" style="margin-top:12px;">
        <div class="hintTitle">自選穿搭（示意合成圖）</div>
        <div style="color:var(--muted); font-weight:800; font-size:13px; margin-top:6px;">
          選擇上衣/下身/外套/鞋子/配件後，會合成一張示意圖（不需 AI key）。
        </div>

        <div id="outfitPickers" style="display:grid; grid-template-columns:1fr; gap:10px; margin-top:12px;"></div>

        <div style="margin-top:12px; display:flex; gap:10px;">
          <button class="btnSmall" id="btnOutfitAutoPick" type="button">自動挑一套（示意）</button>
          <button class="btnSmall" id="btnOutfitClear" type="button">清空選擇</button>
        </div>

        <div style="margin-top:12px;">
          <canvas id="outfitCanvas" width="900" height="1200" style="width:100%; border-radius:18px; border:1px solid var(--stroke); background:#fff;"></canvas>
        </div>

        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btnSmall" id="btnOutfitDownload" type="button">下載示意圖</button>
          <button class="btnSmall" id="btnOutfitCopy" type="button">複製圖片（iOS 可能不支援）</button>
        </div>
      </div>
    `;
    host.appendChild(sec);

    // Bind outfit controls once
    $("#btnOutfitAutoPick")?.addEventListener("click", () => {
      outfitPick.top = pickFirstByCat("top");
      outfitPick.bottom = pickFirstByCat("bottom");
      outfitPick.outer = pickFirstByCat("outer");
      outfitPick.shoes = pickFirstByCat("shoes");
      outfitPick.accessory = pickFirstByCat("accessory");
      renderOutfitComposer();
      toast("已自動挑選（示意）");
    });

    $("#btnOutfitClear")?.addEventListener("click", () => {
      outfitPick.top = outfitPick.bottom = outfitPick.outer = outfitPick.shoes = outfitPick.accessory = null;
      renderOutfitComposer();
      toast("已清空");
    });

    $("#btnOutfitDownload")?.addEventListener("click", () => {
      const canvas = $("#outfitCanvas");
      if (!canvas) return;
      const a = document.createElement("a");
      a.download = `outfit-${Date.now()}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    });

    $("#btnOutfitCopy")?.addEventListener("click", async () => {
      const canvas = $("#outfitCanvas");
      if (!canvas) return;
      try {
        if (!navigator.clipboard || !window.ClipboardItem) {
          toast("此瀏覽器不支援複製圖片");
          return;
        }
        const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("已複製圖片");
      } catch (e) {
        toast("複製失敗（iOS 常見限制）");
      }
    });
  }

  function ensureSettingsSection() {
    if ($("#settingsSection")) return;

    const host = $("#app");
    if (!host) return;

    const sec = document.createElement("section");
    sec.id = "settingsSection";
    sec.style.display = "none";
    sec.style.marginTop = "14px";

    sec.innerHTML = `
      <div class="hintBox" style="margin-top:12px;">
        <div class="hintTitle">設定 / 維護</div>

        <div style="margin-top:10px; color:var(--muted); font-weight:800; font-size:13px;">
          App 版本：${APP_VERSION}
        </div>

        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btnSmall" id="btnClearWeatherCache" type="button">清除天氣快取</button>
          <button class="btnSmall" id="btnExportData" type="button">匯出資料（JSON）</button>
          <button class="btnSmall" id="btnImportData" type="button">匯入資料（JSON）</button>
          <button class="btnSmall" id="btnClearAll" type="button">清除全部資料</button>
        </div>

        <input id="fileImportJson" type="file" accept="application/json" style="display:none;" />
      </div>
    `;
    host.appendChild(sec);

    $("#btnClearWeatherCache")?.addEventListener("click", () => {
      localStorage.removeItem(LS_WEATHER_KEY);
      toast("已清除天氣快取");
    });

    $("#btnExportData")?.addEventListener("click", () => {
      const data = { version: APP_VERSION, exportedAt: new Date().toISOString(), items };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.download = `wardrobe-export-${Date.now()}.json`;
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
    });

    $("#btnImportData")?.addEventListener("click", () => $("#fileImportJson")?.click());
    $("#fileImportJson")?.addEventListener("change", async (ev) => {
      const f = ev.target.files?.[0];
      ev.target.value = "";
      if (!f) return;

      try {
        const t = await f.text();
        const obj = JSON.parse(t);
        if (!obj?.items || !Array.isArray(obj.items)) throw new Error("格式不正確：找不到 items[]");

        // basic sanitize
        items = obj.items
          .filter(x => x && typeof x === "object" && x.id)
          .map(x => ({
            id: String(x.id),
            name: String(x.name || ""),
            note: String(x.note || ""),
            category: String(x.category || "top"),
            imageDataUrl: String(x.imageDataUrl || ""),
            createdAt: Number(x.createdAt || Date.now()),
            updatedAt: Number(x.updatedAt || Date.now()),
          }));

        saveItems();
        renderGrid();
        toast("匯入完成");
      } catch (e) {
        toast(`匯入失敗：${String(e?.message || e)}`);
      }
    });

    $("#btnClearAll")?.addEventListener("click", () => {
      const ok = confirm("確定清除全部資料？（包含單品與快取）");
      if (!ok) return;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LS_WEATHER_KEY);
      items = [];
      saveItems();
      renderGrid();
      toast("已清除全部資料");
    });
  }

  function renderOutfitComposer() {
    const pickers = $("#outfitPickers");
    const canvas = $("#outfitCanvas");
    if (!pickers || !canvas) return;

    // Build dropdowns
    const cats = ["top", "bottom", "outer", "shoes", "accessory"];

    pickers.innerHTML = cats.map(cat => {
      const opts = items
        .filter(i => i.category === cat)
        .sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0))
        .map(i => `<option value="${i.id}">${i.name || "(未命名)"}</option>`)
        .join("");

      const val = outfitPick[cat] || "";
      const emptyOpt = `<option value="">（不選）</option>`;
      return `
        <label style="display:flex; gap:10px; align-items:center;">
          <div style="width:64px; font-weight:900; color:#555;">${catLabel(cat)}</div>
          <select data-cat="${cat}" class="input" style="flex:1; padding:10px 12px;">
            ${emptyOpt}
            ${opts}
          </select>
        </label>
      `;
    }).join("");

    // bind selects
    $$("#outfitPickers select").forEach(sel => {
      const cat = sel.dataset.cat;
      sel.value = outfitPick[cat] || "";
      sel.addEventListener("change", () => {
        outfitPick[cat] = sel.value || null;
        drawOutfitCanvas();
      });
    });

    drawOutfitCanvas();
  }

  async function drawImageTo(ctx, src, x, y, w, h) {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, x, y, w, h);
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }

  async function drawOutfitCanvas() {
    const canvas = $("#outfitCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // title
    ctx.fillStyle = "#2b2b2b";
    ctx.font = "bold 44px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans TC";
    ctx.fillText("Outfit Preview", 48, 78);

    // meta line
    ctx.fillStyle = "#777";
    ctx.font = "800 22px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans TC";
    ctx.fillText(new Date().toLocaleString(), 48, 112);

    // layout blocks
    const blocks = [
      { cat: "outer", x: 60, y: 150, w: 780, h: 240 },
      { cat: "top", x: 60, y: 410, w: 780, h: 240 },
      { cat: "bottom", x: 60, y: 670, w: 780, h: 240 },
      { cat: "shoes", x: 60, y: 930, w: 380, h: 200 },
      { cat: "accessory", x: 460, y: 930, w: 380, h: 200 },
    ];

    // block frame
    ctx.strokeStyle = "#e8e1d8";
    ctx.lineWidth = 3;
    ctx.fillStyle = "rgba(0,0,0,0.02)";

    for (const b of blocks) {
      // rounded rect
      roundRect(ctx, b.x, b.y, b.w, b.h, 22);
      ctx.fill();
      ctx.stroke();

      // label
      ctx.fillStyle = "#555";
      ctx.font = "900 26px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans TC";
      ctx.fillText(catLabel(b.cat), b.x + 18, b.y + 42);

      // content
      const pickedId = outfitPick[b.cat];
      let src = placeholderForCat(b.cat);
      let name = "(未選擇)";

      if (pickedId) {
        const it = items.find(x => x.id === pickedId);
        if (it) {
          name = it.name || "(未命名)";
          src = it.imageDataUrl || placeholderForCat(b.cat);
        }
      }

      // name
      ctx.fillStyle = "#777";
      ctx.font = "800 22px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans TC";
      ctx.fillText(name, b.x + 18, b.y + 76);

      // image area
      const imgX = b.x + 18;
      const imgY = b.y + 92;
      const imgW = b.w - 36;
      const imgH = b.h - 110;

      await drawImageTo(ctx, src, imgX, imgY, imgW, imgH);
    }

    // footer
    ctx.fillStyle = "#999";
    ctx.font = "800 18px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans TC";
    ctx.fillText("Generated locally (Canvas).", 48, canvas.height - 28);
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

  // =========================
  // Weather Module (embed)
  // =========================
  function setWeatherLoading(isLoading) {
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
      if (!obj?.ts || !obj?.data) return null;
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

  async function fetchWeather(lat, lon) {
    if (inflightWeather) inflightWeather.abort();
    inflightWeather = new AbortController();

    const url = `${WORKER_BASE}/weather/now?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: inflightWeather.signal,
      cache: "no-store",
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) {
      const msg = data?.error || `Weather API error (${res.status})`;
      throw new Error(msg);
    }
    return data;
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

    safeText($("#tempText"), `${temp}°${unit}`);
    safeText($("#feelsText"), `體感 ${feels}°${unit}`);
    safeText($("#metaText"), `風 ${wind} m/s · 降雨 ${rain} mm · 來源 ${w.provider}`);

    const rec = recommendOutfit(feels, rain, wind);
    safeHtml(
      $("#outfitHint"),
      `
        <div class="hintTitle">今日體感：${rec.level}</div>
        <ul class="hintList">
          ${rec.parts.map(x => `<li>${x}</li>`).join("")}
        </ul>
      `
    );
  }

  async function refreshByGPS() {
    try {
      setWeatherLoading(true);

      const cached = readWeatherCache();
      if (cached) {
        renderWeather(cached);
        setWeatherLoading(false);
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
      setWeatherLoading(false);
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

  // =========================
  // Bind events
  // =========================
  function bindModal() {
    $("#modalClose")?.addEventListener("click", closeModal);
    $("#modal")?.addEventListener("click", (e) => {
      if (e.target && e.target.id === "modal") closeModal();
    });

    $("#modalSave")?.addEventListener("click", saveFromModal);
    $("#modalDelete")?.addEventListener("click", deleteFromModal);

    $$("#catGrid .catBtn").forEach(btn => {
      btn.addEventListener("click", () => setCategoryUI(btn.dataset.cat));
    });
  }

  function bindFABMenu() {
    $("#fab")?.addEventListener("click", toggleMenu);

    $("#menuClose")?.addEventListener("click", closeMenu);
    $("#menuPickPhoto")?.addEventListener("click", () => {
      closeMenu();
      $("#fileGallery")?.click();
    });
    $("#menuTakePhoto")?.addEventListener("click", () => {
      closeMenu();
      $("#fileCamera")?.click();
    });
    $("#menuQuickAdd")?.addEventListener("click", () => {
      closeMenu();
      quickAdd();
    });

    // click outside menu closes it
    document.addEventListener("click", (e) => {
      const menu = $("#menu");
      const fab = $("#fab");
      if (!menuOpen) return;
      if (menu?.contains(e.target)) return;
      if (fab?.contains(e.target)) return;
      closeMenu();
    });
  }

  function bindWeather() {
    $("#btnLocate")?.addEventListener("click", refreshByGPS);

    // render cache immediately
    const cached = readWeatherCache();
    if (cached) renderWeather(cached);

    // auto refresh once
    refreshByGPS();
  }

  // =========================
  // Boot
  // =========================
  function boot() {
    loadUI();
    loadItems();
    ensureFileInputs();

    bindChips();
    bindBottomNav();
    bindFABMenu();
    bindModal();
    bindWeather();

    renderGrid();

    // keep SW fresh
    checkSWUpdate();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();