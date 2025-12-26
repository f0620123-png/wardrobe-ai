/* docs/app.js
 * Wardrobe AI - GitHub Pages static
 * Features:
 * - localStorage persistence
 * - add photo (library/camera/file) + quick add base items
 * - edit/save/delete
 * - "AI" (offline) auto-detect color & material from description (keyword heuristics)
 * - Service Worker update + hard refresh hooks (?update=1 / long-press title)
 */

(() => {
  "use strict";

  // ========= Config =========
  const STORAGE_KEY = "wardrobe_items_v2"; // v2: add color/material
  const SW_VERSION = 8; // 改檔案就 +1，更新更快

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

  // Image compression (smaller => smoother)
  const IMAGE_MAX = 768;
  const IMAGE_QUALITY = 0.8;

  // ========= AI Heuristics Dictionaries =========
  // 顏色：用「同義詞 → 主要色」方式
  const COLOR_PATTERNS = [
    { re: /(黑|墨黑|烏黑)/, color: "黑" },
    { re: /(白|米白|象牙白|奶白)/, color: "白" },
    { re: /(灰|深灰|淺灰|銀灰|炭灰)/, color: "灰" },
    { re: /(藍|深藍|淺藍|海軍藍|寶藍|牛仔藍|靛藍)/, color: "藍" },
    { re: /(綠|墨綠|軍綠|橄欖綠|草綠|薄荷綠)/, color: "綠" },
    { re: /(紅|酒紅|磚紅|暗紅)/, color: "紅" },
    { re: /(棕|咖啡|咖啡色|巧克力|駝色)/, color: "棕" },
    { re: /(卡其|米色|杏色|奶油色|沙色|淺棕)/, color: "卡其/米" },
    { re: /(黃|芥末黃)/, color: "黃" },
    { re: /(橘|橙)/, color: "橘" },
    { re: /(粉|玫瑰粉|蜜桃粉)/, color: "粉" },
    { re: /(紫|薰衣草紫)/, color: "紫" },
  ];

  // 材質：抓常見詞；可同時抓多個（用 / 串起來）
  const MATERIAL_PATTERNS = [
    { re: /(棉|純棉|棉質|棉料)/, material: "棉" },
    { re: /(麻|亞麻|苧麻)/, material: "麻" },
    { re: /(羊毛|毛呢|呢料|wool)/i, material: "羊毛" },
    { re: /(羊絨|cashmere)/i, material: "羊絨" },
    { re: /(聚酯|polyester|滌綸)/i, material: "聚酯" },
    { re: /(尼龍|nylon)/i, material: "尼龍" },
    { re: /(彈性|彈力|spandex|elastane|萊卡)/i, material: "彈性纖維" },
    { re: /(牛仔|丹寧|denim)/i, material: "丹寧" },
    { re: /(皮革|真皮|牛皮|羊皮|皮料)/, material: "皮革" },
    { re: /(PU|人造皮)/i, material: "PU/人造皮" },
    { re: /(羽絨|down)/i, material: "羽絨" },
    { re: /(針織|knit)/i, material: "針織" },
    { re: /(絲|真絲|silk)/i, material: "絲" },
  ];

  // ========= State =========
  let items = loadItems();
  let filterCat = "all";
  let activeTab = "wardrobe";

  // ========= DOM =========
  const root = ensureSkeleton();
  const els = bindEls(root);

  // ========= Init =========
  renderAll();
  bindEvents();
  setupServiceWorker();
  setupHardRefreshHooks();

  // ========= Render =========
  function renderAll() {
    els.sub.textContent = `今天收集了 ${items.length} 件寶貝`;
    renderChips();
    renderContent();
    renderBottomNav();
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
          ? "自選穿搭（可加：從衣櫃挑上衣/下著/外套…）"
          : activeTab === "sense"
          ? "靈感（可加：天氣卡片、風格 chips、推薦）"
          : "個人（可加：匯出/匯入、清除快取、備份）";
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
      const range = `${it.tmin ?? 0}–${it.tmax ?? 0}°C`;
      const extra = compactExtra(it.color, it.material);
      tag.textContent = extra ? `${catLabel} · ${range} · ${extra}` : `${catLabel} · ${range}`;

      card.appendChild(img);
      card.appendChild(title);
      card.appendChild(tag);
      els.grid.appendChild(card);
    }
  }

  function compactExtra(color, material) {
    const c = (color || "").trim();
    const m = (material || "").trim();
    if (!c && !m) return "";
    if (c && m) return `${c}/${m}`;
    return c || m;
  }

  function renderBottomNav() {
    els.bottomNav.querySelectorAll("button[data-tab]").forEach((b) => {
      b.classList.toggle("on", b.dataset.tab === activeTab);
    });
  }

  // ========= Events =========
  function bindEvents() {
    els.chips.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.classList.contains("chip")) return;
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

    els.fab.addEventListener("click", toggleMenu);

    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const inside = els.menu.contains(target) || els.fab.contains(target);
      if (!inside) closeMenu();
    });

    els.grid.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const card = t.closest("button.card");
      if (!card) return;
      const it = items.find((x) => x.id === card.dataset.id);
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

    const it = {
      id: uid(),
      title: titleFromName || "未命名",
      category: "top",
      tmin: 18,
      tmax: 30,
      color: "",
      material: "",
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

    // 自動推斷（若尚未有值）—用 title 當描述來源
    const inferred = inferColorMaterial(it.title || "");
    const initColor = (it.color || "").trim() || inferred.color;
    const initMaterial = (it.material || "").trim() || inferred.material;

    // fill
    els.nameInput.value = it.title || "";
    els.tminInput.value = String(it.tmin ?? "");
    els.tmaxInput.value = String(it.tmax ?? "");
    els.colorInput.value = initColor || "";
    els.materialInput.value = initMaterial || "";
    renderCatGrid(it.category);

    // debounce auto-infer when name changes
    let timer = null;
    const onNameInput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const text = (els.nameInput.value || "").trim();
        const r = inferColorMaterial(text);
        // 只在欄位空白時自動寫入，避免你手動改後又被覆蓋
        if (!els.colorInput.value.trim() && r.color) els.colorInput.value = r.color;
        if (!els.materialInput.value.trim() && r.material) els.materialInput.value = r.material;
      }, 300);
    };
    els.nameInput.addEventListener("input", onNameInput, { passive: true });
    els.__detachNameInfer = () => els.nameInput.removeEventListener("input", onNameInput);

    // AI button (manual)
    els.aiBtn.onclick = () => {
      const text = (els.nameInput.value || "").trim();
      const r = inferColorMaterial(text);
      els.colorInput.value = r.color || els.colorInput.value;
      els.materialInput.value = r.material || els.materialInput.value;
    };

    // close
    els.modalClose.onclick = () => closeModal();

    // click backdrop closes
    els.modal.onclick = (e) => {
      if (e.target === els.modal) closeModal();
    };

    // save
    els.saveBtn.textContent = "儲存修改";
    els.saveBtn.onclick = () => {
      const next = { ...it };
      next.title = (els.nameInput.value || "").trim() || "未命名";
      next.tmin = toNumOr(next.tmin, els.tminInput.value);
      next.tmax = toNumOr(next.tmax, els.tmaxInput.value);
      next.category = els.catGrid.dataset.selected || next.category;
      next.color = (els.colorInput.value || "").trim();
      next.material = (els.materialInput.value || "").trim();
      next.updatedAt = Date.now();

      items = items.map((x) => (x.id === it.id ? next : x));
      saveItems(items);

      closeModal();
      renderAll();
    };

    // delete
    els.deleteBtn.hidden = false;
    els.deleteBtn.onclick = () => {
      if (!confirm("確定要刪除這個單品嗎？")) return;
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

    // hide normal fields (用簡單方式：把輸入區塊隱藏)
    els.formWrap.hidden = true;
    els.quickWrap.hidden = false;
    els.quickWrap.innerHTML = "";

    const grid = document.createElement("div");
    grid.className = "catGrid";

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
          color: inferred.color,
          material: inferred.material,
          image: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        items.unshift(it);
        saveItems(items);
        closeModal();
        renderAll();
      };
      grid.appendChild(b);
    }

    els.quickWrap.appendChild(grid);

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
    els.aiBtn.onclick = null;

    // restore form
    els.formWrap.hidden = false;
    els.quickWrap.hidden = true;

    // detach name infer
    if (els.__detachNameInfer) {
      els.__detachNameInfer();
      els.__detachNameInfer = null;
    }

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

  // ========= Offline "AI" =========
  function inferColorMaterial(text) {
    const s = String(text || "").trim();
    if (!s) return { color: "", material: "" };

    let color = "";
    for (const p of COLOR_PATTERNS) {
      if (p.re.test(s)) {
        color = p.color;
        break;
      }
    }

    const mats = [];
    for (const p of MATERIAL_PATTERNS) {
      if (p.re.test(s)) mats.push(p.material);
    }
    // 去重
    const uniq = [...new Set(mats)];
    const material = uniq.slice(0, 2).join("/"); // 最多顯示 2 個，避免太長

    return { color, material };
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
    // 兼容舊版 key
    const candidates = [STORAGE_KEY, "wardrobe_items_v1"];
    for (const key of candidates) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) continue;

        const cleaned = arr
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

        // 若讀到的是舊 key，順便升級寫入新 key
        if (key !== STORAGE_KEY) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
          } catch {}
        }
        return cleaned;
      } catch {
        // try next
      }
    }
    return [];
  }

  function saveItems(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      alert("儲存失敗：可能是圖片太多導致容量滿了。建議刪除部分照片或降低圖片尺寸。");
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

          <div class="formWrap">
            <div class="field">
              <div class="labelRow">
                <div class="label">名稱 / 描述</div>
                <button class="miniBtn" type="button">AI 自動判斷</button>
              </div>
              <input class="input" placeholder="例如：橄欖綠休閒Polo短袖上衣，棉質面料" />
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
              <div class="label">顏色 / 材質</div>
              <div class="row2">
                <input class="input" placeholder="顏色（例如：綠）" />
                <div class="dash">·</div>
                <input class="input" placeholder="材質（例如：棉）" />
              </div>
            </div>

            <div class="field">
              <div class="label">修改分類</div>
              <div class="catGrid"></div>
            </div>
          </div>

          <div class="quickWrap" hidden></div>

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

    const formWrap = modalCard.querySelector(".formWrap");
    const quickWrap = modalCard.querySelector(".quickWrap");

    const inputs = modalCard.querySelectorAll(".input");
    const nameInput = inputs[0];
    const tminInput = inputs[1];
    const tmaxInput = inputs[2];
    const colorInput = inputs[3];
    const materialInput = inputs[4];

    const aiBtn = modalCard.querySelector(".miniBtn");

    const catGrid = modalCard.querySelector(".catGrid");
    const saveBtn = modalCard.querySelector(".btnPrimary");
    const deleteBtn = modalCard.querySelector(".btnDanger");

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
      formWrap,
      quickWrap,
      nameInput,
      tminInput,
      tmaxInput,
      colorInput,
      materialInput,
      aiBtn,
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
      __detachNameInfer: null,
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

  // ========= Hard Refresh =========
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

    // 長按標題 3 秒強制更新
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