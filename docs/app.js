/* docs/app.js
 * Wardrobe AI - pure static (GitHub Pages)
 * - localStorage persistence
 * - photo library / camera / file picker
 * - quick add base items
 * - edit / save / delete
 * - Auto infer color/material from title/description (heuristics)
 * - Service Worker update: auto + manual hard refresh (?update=1 / long-press title)
 */

(() => {
  "use strict";

  // ========= Config =========
  const STORAGE_KEY = "wardrobe_items_v1";
  const SW_VERSION = 8; // 有改 app.js / styles.css / index.html，建議 +1

  const CATEGORIES = [
    { key: "all", label: "全部" },
    { key: "top", label: "上衣" },
    { key: "bottom", label: "下著" },
    { key: "inner", label: "內搭" },
    { key: "outer", label: "外套" },
    { key: "shoes", label: "鞋子" },
    { key: "accessory", label: "配件" },
  ];

  const QUICK_BASE = [
    { title: "長袖打底（白）", category: "inner", tmin: 0, tmax: 18 },
    { title: "長袖打底（黑）", category: "inner", tmin: 0, tmax: 18 },
    { title: "短袖T恤（白）", category: "top", tmin: 18, tmax: 30 },
    { title: "短袖T恤（黑）", category: "top", tmin: 18, tmax: 30 },
    { title: "連帽外套（灰）", category: "outer", tmin: 10, tmax: 22 },
    { title: "牛仔外套", category: "outer", tmin: 12, tmax: 24 },
    { title: "牛仔寬褲", category: "bottom", tmin: 15, tmax: 30 },
    { title: "直筒牛仔褲", category: "bottom", tmin: 15, tmax: 30 },
  ];

  // 圖片壓縮上限（越小越順；大量衣物建議 768）
  const IMAGE_MAX = 768;
  const IMAGE_QUALITY = 0.80;

  // ========= Auto Infer Dictionaries =========
  // 顏色：由「更具體 → 更一般」排序，避免先命中「藍」而漏掉「海軍藍」
  const COLOR_PATTERNS = [
    { label: "海軍藍", re: /(海軍藍|海軍|navy)/i },
    { label: "深藍", re: /(深藍|靛藍|靛色|深藍色)/i },
    { label: "淺藍", re: /(淺藍|天藍|baby\s*blue)/i },
    { label: "藍", re: /(藍|blue)/i },

    { label: "軍綠", re: /(軍綠|軍綠色)/i },
    { label: "橄欖綠", re: /(橄欖綠|橄欖|olive)/i },
    { label: "墨綠", re: /(墨綠|深綠)/i },
    { label: "淺綠", re: /(淺綠|薄荷綠|mint)/i },
    { label: "綠", re: /(綠|green)/i },

    { label: "酒紅", re: /(酒紅|暗紅|burgundy|wine)/i },
    { label: "紅", re: /(紅|red)/i },
    { label: "粉", re: /(粉紅|粉|pink)/i },
    { label: "紫", re: /(紫|purple)/i },

    { label: "米色", re: /(米色|米白|beige)/i },
    { label: "奶油白", re: /(奶油白|奶油|cream)/i },
    { label: "卡其", re: /(卡其|khaki)/i },
    { label: "駝色", re: /(駝色|camel)/i },
    { label: "棕", re: /(咖啡|棕|brown)/i },

    { label: "黃", re: /(黃|yellow)/i },
    { label: "橘", re: /(橘|橙|orange)/i },

    { label: "深灰", re: /(深灰|鐵灰|炭灰|charcoal)/i },
    { label: "淺灰", re: /(淺灰|light\s*gray)/i },
    { label: "灰", re: /(灰|gray|grey)/i },

    { label: "黑", re: /(黑|black)/i },
    { label: "白", re: /(白|white)/i },
  ];

  const MATERIAL_PATTERNS = [
    { label: "牛仔", re: /(牛仔|丹寧|denim|jean)/i },
    { label: "棉", re: /(棉|純棉|cotton)/i },
    { label: "羊毛", re: /(羊毛|wool|merino)/i },
    { label: "羊絨", re: /(羊絨|cashmere)/i },
    { label: "羽絨", re: /(羽絨|down)/i },
    { label: "皮革", re: /(皮革|真皮|牛皮|羊皮|leather)/i },
    { label: "麂皮", re: /(麂皮|suede)/i },
    { label: "尼龍", re: /(尼龍|nylon)/i },
    { label: "聚酯", re: /(聚酯|polyester|poly)/i },
    { label: "針織", re: /(針織|knit)/i },
    { label: "毛呢", re: /(毛呢|呢料)/i },
    { label: "法蘭絨", re: /(法蘭絨|flannel)/i },
    { label: "防水/機能布", re: /(防水|gore\-tex|機能|hard\s*shell|soft\s*shell)/i },
    { label: "麻", re: /(麻|亞麻|linen)/i },
    { label: "絨", re: /(絨|刷毛|fleece|velvet)/i },
    { label: "毛圈", re: /(毛圈|terry)/i },
  ];

  // ========= State =========
  let items = loadItems();
  let filterCat = "all";
  let activeTab = "wardrobe"; // bottom nav

  // ========= DOM bootstrap =========
  const root = ensureSkeleton();
  const els = bindEls(root);

  // ========= Init =========
  renderAll();
  bindEvents();
  setupServiceWorker();
  setupHardRefreshHooks();

  // ========= UI / Render =========
  function renderAll() {
    renderHeaderCount();
    renderChips();
    renderContent();
    renderBottomNav();
  }

  function renderHeaderCount() {
    const n = items.length;
    els.sub.textContent = `今天收集了 ${n} 件寶貝`;
  }

  function renderChips() {
    els.chips.innerHTML = "";
    for (const c of CATEGORIES) {
      const b = document.createElement("button");
      b.className = "chip" + (filterCat === c.key ? " on" : "");
      b.type = "button";
      b.textContent = c.label;
      b.dataset.cat = c.key;
      els.chips.appendChild(b);
    }
  }

  function renderContent() {
    if (activeTab !== "wardrobe") {
      els.grid.innerHTML = "";
      els.empty.hidden = true;

      const holder = document.createElement("div");
      holder.className = "empty";
      holder.style.marginTop = "24px";
      holder.innerHTML =
        activeTab === "mix"
          ? "自選穿搭（下一步可加：從衣櫃挑上衣/下著/外套…）"
          : activeTab === "sense"
          ? "靈感（下一步可加：天氣卡片、風格 chips、推薦）"
          : "個人（下一步可加：備份/匯出/匯入/清除快取）";

      els.grid.appendChild(holder);
      return;
    }

    const shown = filterCat === "all" ? items : items.filter((x) => x.category === filterCat);
    els.grid.innerHTML = "";

    if (shown.length === 0) {
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;

    for (const it of shown) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card";
      card.dataset.id = it.id;

      const img = document.createElement("img");
      img.alt = it.title || "item";
      img.loading = "lazy";
      img.src = it.image || "";
      if (!it.image) img.style.background = "#f2f2f2";

      const title = document.createElement("div");
      title.className = "cardTitle";
      title.textContent = it.title || "未命名";

      const tag = document.createElement("div");
      tag.className = "tag";

      const catLabel = catLabelOf(it.category);
      const range = formatRange(it.tmin, it.tmax);

      // 顯示顏色/材質（如果沒填，就用推測結果顯示，但不會寫回 storage）
      const inferred = inferColorMaterial(it.title);
      const color = (it.color || "").trim() || inferred.color;
      const material = (it.material || "").trim() || inferred.material;

      const parts = [`${catLabel} · ${range}`];
      if (color) parts.push(color);
      if (material) parts.push(material);

      tag.textContent = parts.join(" · ");

      card.appendChild(img);
      card.appendChild(title);
      card.appendChild(tag);
      els.grid.appendChild(card);
    }
  }

  function renderBottomNav() {
    const btns = els.bottomNav.querySelectorAll("button[data-tab]");
    btns.forEach((b) => b.classList.toggle("on", b.dataset.tab === activeTab));
  }

  // ========= Events =========
  function bindEvents() {
    els.chips.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (!t.classList.contains("chip")) return;
      filterCat = t.dataset.cat || "all";
      renderChips();
      renderContent();
    });

    els.bottomNav.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const btn = t.closest("button[data-tab]");
      if (!btn) return;
      activeTab = btn.dataset.tab || "wardrobe";
      renderContent();
      renderBottomNav();
      closeMenu();
    });

    els.fab.addEventListener("click", () => toggleMenu());

    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const insideMenu = els.menu.contains(target) || els.fab.contains(target);
      if (!insideMenu) closeMenu();
    });

    els.grid.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const card = t.closest("button.card");
      if (!card) return;
      const id = card.dataset.id;
      const it = items.find((x) => x.id === id);
      if (!it) return;
      openEditModal(it);
    });

    els.btnLibrary.addEventListener("click", () => {
      closeMenu();
      els.fileLibrary.click();
    });

    els.btnCamera.addEventListener("click", () => {
      closeMenu();
      els.fileCamera.click();
    });

    els.btnFile.addEventListener("click", () => {
      closeMenu();
      els.fileAny.click();
    });

    els.btnQuick.addEventListener("click", () => {
      closeMenu();
      openQuickAddModal();
    });

    els.fileLibrary.addEventListener("change", async () => {
      const f = els.fileLibrary.files && els.fileLibrary.files[0];
      els.fileLibrary.value = "";
      if (!f) return;
      await addFromFile(f);
    });

    els.fileCamera.addEventListener("change", async () => {
      const f = els.fileCamera.files && els.fileCamera.files[0];
      els.fileCamera.value = "";
      if (!f) return;
      await addFromFile(f);
    });

    els.fileAny.addEventListener("change", async () => {
      const f = els.fileAny.files && els.fileAny.files[0];
      els.fileAny.value = "";
      if (!f) return;
      await addFromFile(f);
    });
  }

  // ========= Add / Edit =========
  async function addFromFile(file) {
    const dataUrl = await compressImageToDataUrl(file, IMAGE_MAX, IMAGE_QUALITY);
    const titleFromName = (file.name || "").replace(/\.[^/.]+$/, "").trim();

    const inferred = inferColorMaterial(titleFromName);

    const it = {
      id: uid(),
      title: titleFromName || "未命名",
      category: "top",
      tmin: 18,
      tmax: 30,
      color: inferred.color || "",
      material: inferred.material || "",
      image: dataUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    items.unshift(it);
    saveItems(items);

    renderAll();
    openEditModal(it);
  }

  function openEditModal(it) {
    closeMenu();
    els.modalTitle.textContent = "編輯單品";
    els.modal.hidden = false;

    // fill
    els.nameInput.value = it.title || "";
    els.tminInput.value = String(it.tmin ?? "");
    els.tmaxInput.value = String(it.tmax ?? "");
    els.colorInput.value = String(it.color || "");
    els.materialInput.value = String(it.material || "");
    renderCatGrid(it.category);

    // 初次打開：如果 color/material 空白 → 用推測值填入（可手改）
    const guessed = inferColorMaterial(els.nameInput.value);
    if (!els.colorInput.value.trim() && guessed.color) els.colorInput.value = guessed.color;
    if (!els.materialInput.value.trim() && guessed.material) els.materialInput.value = guessed.material;

    // 即時提示：使用者改名稱/描述時，自動更新「建議值」（只在欄位還空白時才填，避免覆蓋你手動輸入）
    els.nameInput.oninput = () => {
      const g = inferColorMaterial(els.nameInput.value);
      if (!els.colorInput.value.trim() && g.color) els.colorInput.value = g.color;
      if (!els.materialInput.value.trim() && g.material) els.materialInput.value = g.material;
    };

    // 手動一鍵重新辨識（不管目前有沒有內容都覆蓋）
    els.inferBtn.onclick = () => {
      const g = inferColorMaterial(els.nameInput.value);
      els.colorInput.value = g.color || "";
      els.materialInput.value = g.material || "";
    };

    const onClose = () => closeModal();
    els.modalClose.onclick = onClose;

    els.modal.onclick = (e) => {
      if (e.target === els.modal) closeModal();
    };

    els.saveBtn.textContent = "儲存修改";
    els.saveBtn.onclick = () => {
      const next = { ...it };
      next.title = (els.nameInput.value || "").trim() || "未命名";
      next.tmin = toNumOr(next.tmin, els.tminInput.value);
      next.tmax = toNumOr(next.tmax, els.tmaxInput.value);
      next.category = els.catGrid.dataset.selected || next.category;

      // 顏色/材質：允許你手動輸入；若留空就用推測值
      const g = inferColorMaterial(next.title);
      const c = (els.colorInput.value || "").trim();
      const m = (els.materialInput.value || "").trim();
      next.color = c || g.color || "";
      next.material = m || g.material || "";

      next.updatedAt = Date.now();

      items = items.map((x) => (x.id === it.id ? next : x));
      saveItems(items);
      closeModal();
      renderAll();
    };

    els.deleteBtn.hidden = false;
    els.deleteBtn.onclick = () => {
      const ok = confirm("確定要刪除這個單品嗎？");
      if (!ok) return;
      items = items.filter((x) => x.id !== it.id);
      saveItems(items);
      closeModal();
      renderAll();
    };

    document.body.style.overflow = "hidden";
  }

  function openQuickAddModal() {
    els.modalTitle.textContent = "⚡ 快速加入基礎單品";
    els.modal.hidden = false;
    els.deleteBtn.hidden = true;

    els.nameInput.value = "";
    els.tminInput.value = "";
    els.tmaxInput.value = "";
    els.colorInput.value = "";
    els.materialInput.value = "";
    els.nameInput.oninput = null;

    // 快速加入模式：隱藏顏色/材質輸入區，保留按鈕區
    els.extraBox.hidden = true;

    els.catGrid.innerHTML = "";
    els.catGrid.dataset.selected = "";

    const wrap = document.createElement("div");
    wrap.className = "catGrid";

    for (const q of QUICK_BASE) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "catBtn";
      b.textContent = q.title;
      b.onclick = () => {
        const inferred = inferColorMaterial(q.title);
        const it = {
          id: uid(),
          title: q.title,
          category: q.category,
          tmin: q.tmin,
          tmax: q.tmax,
          color: inferred.color || "",
          material: inferred.material || "",
          image: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        items.unshift(it);
        saveItems(items);
        closeModal();
        renderAll();
      };
      wrap.appendChild(b);
    }

    els.catGrid.appendChild(wrap);

    els.saveBtn.textContent = "關閉";
    els.saveBtn.onclick = () => closeModal();

    els.modalClose.onclick = () => closeModal();
    els.modal.onclick = (e) => {
      if (e.target === els.modal) closeModal();
    };

    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    els.modal.hidden = true;
    els.modal.onclick = null;
    els.modalClose.onclick = null;
    els.saveBtn.onclick = null;
    els.deleteBtn.onclick = null;
    els.inferBtn.onclick = null;
    els.nameInput.oninput = null;
    els.extraBox.hidden = false;
    document.body.style.overflow = "";
  }

  function renderCatGrid(selected) {
    els.catGrid.innerHTML = "";
    els.catGrid.dataset.selected = selected || "top";

    for (const c of CATEGORIES.filter((x) => x.key !== "all")) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "catBtn" + (c.key === selected ? " on" : "");
      b.textContent = c.label;
      b.onclick = () => {
        els.catGrid.dataset.selected = c.key;
        els.catGrid.querySelectorAll(".catBtn").forEach((n) => n.classList.remove("on"));
        b.classList.add("on");
      };
      els.catGrid.appendChild(b);
    }
  }

  // ========= Infer Logic =========
  function inferColorMaterial(text) {
    const t = normalize(text);

    const color = firstMatchLabel(COLOR_PATTERNS, t);
    const material = firstMatchLabel(MATERIAL_PATTERNS, t);

    return { color, material };
  }

  function firstMatchLabel(patterns, text) {
    for (const p of patterns) {
      if (p.re.test(text)) return p.label;
    }
    return "";
  }

  function normalize(s) {
    return String(s || "")
      .replace(/\s+/g, "")
      .replace(/[()（）【】\[\]{}]/g, "")
      .toLowerCase();
  }

  // ========= Menu =========
  function toggleMenu() {
    els.menu.hidden = !els.menu.hidden;
  }
  function closeMenu() {
    els.menu.hidden = true;
  }

  // ========= Storage =========
  function loadItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => x && typeof x === "object" && typeof x.id === "string")
        .map((x) => ({
          id: x.id,
          title: String(x.title || "未命名"),
          category: String(x.category || "top"),
          tmin: typeof x.tmin === "number" ? x.tmin : 18,
          tmax: typeof x.tmax === "number" ? x.tmax : 30,
          color: typeof x.color === "string" ? x.color : "",
          material: typeof x.material === "string" ? x.material : "",
          image: typeof x.image === "string" ? x.image : "",
          createdAt: typeof x.createdAt === "number" ? x.createdAt : Date.now(),
          updatedAt: typeof x.updatedAt === "number" ? x.updatedAt : Date.now(),
        }));
    } catch {
      return [];
    }
  }

  function saveItems(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      alert("儲存失敗：可能是圖片太多導致容量滿了。建議把圖片縮小或刪除部分單品。");
      console.error(e);
    }
  }

  // ========= Helpers =========
  function uid() {
    return "i_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }

  function catLabelOf(key) {
    return (CATEGORIES.find((c) => c.key === key) || CATEGORIES[1]).label;
  }

  function formatRange(tmin, tmax) {
    const a = typeof tmin === "number" ? tmin : 0;
    const b = typeof tmax === "number" ? tmax : 0;
    return `${a}–${b}°C`;
  }

  function toNumOr(fallback, v) {
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : fallback;
  }

  async function compressImageToDataUrl(file, maxSide, quality) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("FileReader error"));
      r.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Image load error"));
      im.src = dataUrl;
    });

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    const scale = Math.min(1, maxSide / Math.max(w, h));
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, nw, nh);

    return canvas.toDataURL("image/jpeg", quality);
  }

  // ========= Skeleton / DOM =========
  function ensureSkeleton() {
    let app = document.querySelector(".app");
    if (app) return app;

    app = document.createElement("div");
    app.className = "app";
    app.innerHTML = `
      <header class="header">
        <div class="brand">MY WARDROBE</div>
        <h1>我的衣櫃日記</h1>
        <div class="sub"></div>
      </header>

      <div class="chips"></div>

      <div class="grid"></div>
      <div class="empty" hidden>尚無衣物，點右下角 + 新增</div>

      <nav class="bottomNav">
        <button type="button" data-tab="wardrobe" class="on">衣櫃</button>
        <button type="button" data-tab="mix">自選</button>
        <button type="button" data-tab="sense">靈感</button>
        <button type="button" data-tab="profile">個人</button>
      </nav>

      <button class="fab" type="button">+</button>

      <div class="menu" hidden>
        <button type="button" data-action="library">照片圖庫</button>
        <button type="button" data-action="camera">拍照</button>
        <button type="button" data-action="file">選擇檔案</button>
        <button type="button" data-action="quick">⚡ 快速加入基礎單品</button>
      </div>

      <div class="modal" hidden>
        <div class="modalCard" role="dialog" aria-modal="true">
          <div class="modalHead">
            <div class="modalTitle">編輯單品</div>
            <button class="iconBtn" type="button" aria-label="Close">×</button>
          </div>

          <div class="field">
            <div class="label">名稱 / 描述</div>
            <input class="input" placeholder="例如：深灰色立領羽絨外套，輕巧保暖" />
          </div>

          <div class="field">
            <div class="label">適穿溫度範圍（°C）</div>
            <div class="row2">
              <input class="input" inputmode="numeric" placeholder="0" />
              <div class="dash">-</div>
              <input class="input" inputmode="numeric" placeholder="18" />
            </div>
          </div>

          <div class="field">
            <div class="label">修改分類</div>
            <div class="catGrid"></div>
          </div>

          <!-- 新增：顏色/材質（可手改；也可一鍵重新辨識） -->
          <div class="field extraBox">
            <div class="label">顏色 / 材質（可手動修改）</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <input class="input jsColor" placeholder="顏色（例：軍綠）" />
              <input class="input jsMaterial" placeholder="材質（例：牛仔/棉/羽絨）" />
            </div>
            <button class="catBtn" type="button" style="margin-top:10px;">自動重新辨識</button>
          </div>

          <button class="btnPrimary" type="button">儲存修改</button>
          <button class="btnDanger" type="button">刪除此單品</button>
        </div>
      </div>
    `;
    document.body.appendChild(app);
    return app;
  }

  function bindEls(app) {
    const header = app.querySelector(".header");
    const h1 = header.querySelector("h1");
    const sub = header.querySelector(".sub");

    const chips = app.querySelector(".chips");
    const grid = app.querySelector(".grid");
    const empty = app.querySelector(".empty");

    const bottomNav = app.querySelector(".bottomNav");
    const fab = app.querySelector(".fab");
    const menu = app.querySelector(".menu");

    const modal = app.querySelector(".modal");
    const modalCard = modal.querySelector(".modalCard");
    const modalTitle = modal.querySelector(".modalTitle");
    const modalClose = modal.querySelector(".iconBtn");

    const nameInput = modalCard.querySelectorAll(".input")[0];
    const tminInput = modalCard.querySelectorAll(".input")[1];
    const tmaxInput = modalCard.querySelectorAll(".input")[2];

    const catGrid = modalCard.querySelector(".catGrid");
    const saveBtn = modalCard.querySelector(".btnPrimary");
    const deleteBtn = modalCard.querySelector(".btnDanger");

    // 新增：顏色/材質
    const extraBox = modalCard.querySelector(".extraBox");
    const colorInput = modalCard.querySelector(".jsColor");
    const materialInput = modalCard.querySelector(".jsMaterial");
    const inferBtn = extraBox.querySelector("button");

    // menu buttons
    const btnLibrary = menu.querySelector('button[data-action="library"]');
    const btnCamera = menu.querySelector('button[data-action="camera"]');
    const btnFile = menu.querySelector('button[data-action="file"]');
    const btnQuick = menu.querySelector('button[data-action="quick"]');

    // hidden file inputs
    const fileLibrary = document.createElement("input");
    fileLibrary.type = "file";
    fileLibrary.accept = "image/*";
    fileLibrary.hidden = true;

    const fileCamera = document.createElement("input");
    fileCamera.type = "file";
    fileCamera.accept = "image/*";
    fileCamera.setAttribute("capture", "environment");
    fileCamera.hidden = true;

    const fileAny = document.createElement("input");
    fileAny.type = "file";
    fileAny.accept = "image/*";
    fileAny.hidden = true;

    document.body.appendChild(fileLibrary);
    document.body.appendChild(fileCamera);
    document.body.appendChild(fileAny);

    return {
      app,
      h1,
      sub,
      chips,
      grid,
      empty,
      bottomNav,
      fab,
      menu,
      modal,
      modalTitle,
      modalClose,
      nameInput,
      tminInput,
      tmaxInput,
      catGrid,
      saveBtn,
      deleteBtn,
      btnLibrary,
      btnCamera,
      btnFile,
      btnQuick,
      fileLibrary,
      fileCamera,
      fileAny,

      // new
      extraBox,
      colorInput,
      materialInput,
      inferBtn,
    };
  }

  // ========= Service Worker =========
  function setupServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const swUrl = `./sw.js?v=${SW_VERSION}`;

    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");

        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              location.reload();
            }
          });
        });
      })
      .catch(console.error);

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (window.__reloading__) return;
      window.__reloading__ = true;
      location.reload();
    });
  }

  // ========= Hard Refresh (manual) =========
  function setupHardRefreshHooks() {
    async function hardReload() {
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (e) {
        console.warn("hardReload failed", e);
      } finally {
        location.href = "./?v=" + Date.now();
      }
    }

    if (new URLSearchParams(location.search).get("update") === "1") {
      hardReload();
      return;
    }

    if (els.h1) {
      let timer = null;
      els.h1.addEventListener(
        "touchstart",
        () => {
          timer = setTimeout(hardReload, 3000);
        },
        { passive: true }
      );
      els.h1.addEventListener("touchend", () => clearTimeout(timer));
      els.h1.addEventListener("touchcancel", () => clearTimeout(timer));
    }
  }
})();