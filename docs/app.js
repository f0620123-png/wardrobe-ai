/* docs/app.js
 * Wardrobe AI - pure static (GitHub Pages)
 * - localStorage persistence
 * - photo library / camera / file picker
 * - quick add base items
 * - edit / save / delete
 * - Service Worker update: auto + manual hard refresh (?update=1 / long-press title)
 */

(() => {
  "use strict";

  // ========= Config =========
  const STORAGE_KEY = "wardrobe_items_v1";
  const SW_VERSION = 7; // 每次你更新 app.js / styles.css / index.html，都可把這個 +1，加速「驗收」更新

  const CATEGORIES = [
    { key: "all", label: "全部" },
    { key: "top", label: "上衣" },
    { key: "bottom", label: "下著" },
    { key: "inner", label: "內搭" },
    { key: "outer", label: "外套" },
    { key: "shoes", label: "鞋子" },
    { key: "accessory", label: "配件" },
  ];

  // 你截圖裡的「快速加入基礎單品」
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
    // 只有衣櫃頁面顯示 grid，其他頁面先顯示空白/占位（不影響你現有功能核心）
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
      if (!it.image) {
        // 無圖時給淡灰底（避免破圖）
        img.style.background = "#f2f2f2";
      }

      const title = document.createElement("div");
      title.className = "cardTitle";
      title.textContent = it.title || "未命名";

      const tag = document.createElement("div");
      tag.className = "tag";
      const catLabel = catLabelOf(it.category);
      const range = formatRange(it.tmin, it.tmax);
      tag.textContent = `${catLabel} · ${range}`;

      card.appendChild(img);
      card.appendChild(title);
      card.appendChild(tag);
      els.grid.appendChild(card);
    }
  }

  function renderBottomNav() {
    const btns = els.bottomNav.querySelectorAll("button[data-tab]");
    btns.forEach((b) => {
      b.classList.toggle("on", b.dataset.tab === activeTab);
    });
  }

  // ========= Events =========
  function bindEvents() {
    // chips
    els.chips.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (!t.classList.contains("chip")) return;
      filterCat = t.dataset.cat || "all";
      renderChips();
      renderContent();
    });

    // bottom nav
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

    // fab menu toggle
    els.fab.addEventListener("click", () => {
      toggleMenu();
    });

    // clicking outside closes menu
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const insideMenu = els.menu.contains(target) || els.fab.contains(target);
      if (!insideMenu) closeMenu();
    });

    // grid card click -> edit
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

    // menu actions
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

    // file inputs
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
      image: dataUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    items.unshift(it);
    saveItems(items);

    // 立即打開編輯
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
    renderCatGrid(it.category);

    // actions
    const onClose = () => closeModal();
    els.modalClose.onclick = onClose;

    // 點背景關閉（點卡片本體不關）
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

    // 防止 iOS 點擊 input 時，背景被捲動（小幅改善卡頓感）
    document.body.style.overflow = "hidden";
  }

  function openQuickAddModal() {
    els.modalTitle.textContent = "⚡ 快速加入基礎單品";
    els.modal.hidden = false;
    els.deleteBtn.hidden = true;

    // 清空表單區（用 catGrid 當按鈕區）
    els.nameInput.value = "";
    els.tminInput.value = "";
    els.tmaxInput.value = "";
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
        const it = {
          id: uid(),
          title: q.title,
          category: q.category,
          tmin: q.tmin,
          tmax: q.tmax,
          image: "", // 無圖
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
    els.saveBtn.onclick = () => {
      closeModal();
    };

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
        // toggle style
        els.catGrid.querySelectorAll(".catBtn").forEach((n) => n.classList.remove("on"));
        b.classList.add("on");
      };
      els.catGrid.appendChild(b);
    }
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
      // 基本清洗
      return arr
        .filter((x) => x && typeof x === "object" && typeof x.id === "string")
        .map((x) => ({
          id: x.id,
          title: String(x.title || "未命名"),
          category: String(x.category || "top"),
          tmin: typeof x.tmin === "number" ? x.tmin : 18,
          tmax: typeof x.tmax === "number" ? x.tmax : 30,
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
    // 讀檔
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("FileReader error"));
      r.readAsDataURL(file);
    });

    // 建 img
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Image load error"));
      im.src = dataUrl;
    });

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    // 算縮放
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, nw, nh);

    // 輸出 jpeg
    return canvas.toDataURL("image/jpeg", quality);
  }

  // ========= Skeleton / DOM =========
  function ensureSkeleton() {
    let app = document.querySelector(".app");
    if (app) return app;

    // 若你的 index.html 已經有架構，也沒關係；此段只在缺 skeleton 時自動補
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
    };
  }

  // ========= Service Worker =========
  function setupServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    // 有些 iOS 會卡 SW；加版本參數讓更新更確定
    const swUrl = `./sw.js?v=${SW_VERSION}`;

    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        // 若已存在 waiting 版本，叫它立刻生效
        if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");

        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            // 新 SW 安裝完成，且已有舊 SW 控制中 -> 直接重整套用新版本
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              location.reload();
            }
          });
        });
      })
      .catch(console.error);

    // 若 SW 控制權變更，保險再 reload 一次
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // 避免多次 reload
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
        // 加時間戳避免被快取
        location.href = "./?v=" + Date.now();
      }
    }

    // ?update=1 直接強制更新
    if (new URLSearchParams(location.search).get("update") === "1") {
      hardReload();
      return;
    }

    // 長按標題 3 秒強制更新（驗收用）
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