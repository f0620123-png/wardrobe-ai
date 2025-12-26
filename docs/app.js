/* docs/app.js
 * Wardrobe AI (vanilla JS)
 * - localStorage persistence
 * - image picker / camera / quick add
 * - edit modal with AI color/material inference via Cloudflare Worker
 * - service worker update helpers (iOS-friendly)
 */

(() => {
  "use strict";

  // ====== Config ======
  const STORAGE_KEY = "wardrobe_items_v3";
  const SETTINGS_KEY = "wardrobe_settings_v2";

  // 你的 Worker 預設網址（可在「設定」裡改）
  const DEFAULT_AI_ENDPOINT = "https://autumn-cell-d032.f0620123.workers.dev";

  // 圖片送 AI 前最大邊長（越小越省、越快）
  const MAX_IMAGE_SIDE = 1024;
  const JPEG_QUALITY = 0.85;

  // Quick add presets
  const QUICK_PRESETS = [
    { name: "長袖打底（白）", cat: "內搭", tmin: 8, tmax: 20 },
    { name: "長袖打底（黑）", cat: "內搭", tmin: 8, tmax: 20 },
    { name: "短袖T恤（白）", cat: "上衣", tmin: 18, tmax: 32 },
    { name: "短袖T恤（黑）", cat: "上衣", tmin: 18, tmax: 32 },
    { name: "連帽外套（灰）", cat: "外套", tmin: 10, tmax: 22 },
    { name: "牛仔外套", cat: "外套", tmin: 12, tmax: 26 },
    { name: "牛仔寬褲", cat: "下著", tmin: 10, tmax: 28 },
    { name: "直筒牛仔褲", cat: "下著", tmin: 10, tmax: 28 },
  ];

  const CATS = ["全部", "上衣", "下著", "內搭", "外套", "鞋子", "配件", "其他"];

  // ====== State ======
  let items = [];
  let activeCat = "全部";
  let activeTab = "衣櫃"; // 保留（你底部 nav 用得到）
  let ui = {};
  let settings = loadSettings();

  // ====== Boot ======
  document.addEventListener("DOMContentLoaded", () => {
    ensureDOM();
    wireEvents();
    items = loadItems();
    renderAll();

    // Service Worker
    setupServiceWorker();

    // 初次顯示 endpoint
    updateEndpointBadge();
  });

  // ====== DOM bootstrap (若你的 index.html 已有就會直接用) ======
  function ensureDOM() {
    const $ = (s) => document.querySelector(s);

    ui.app = $(".app") || document.body;

    ui.headerBrand = $(".header .brand");
    ui.headerTitle = $(".header h1");
    ui.headerSub = $(".header .sub");

    ui.chips = $(".chips");
    ui.grid = $(".grid");
    ui.empty = $(".empty");

    ui.bottomNav = $(".bottomNav");
    ui.fab = $(".fab");
    ui.menu = $(".menu");

    // 若 chips/grid 不存在，直接建立（避免「功能都在但介面跑掉/不能點」時 JS 掛掉）
    if (!ui.chips) {
      ui.chips = document.createElement("div");
      ui.chips.className = "chips";
      ui.app.appendChild(ui.chips);
    }
    if (!ui.grid) {
      ui.grid = document.createElement("div");
      ui.grid.className = "grid";
      ui.app.appendChild(ui.grid);
    }
    if (!ui.empty) {
      ui.empty = document.createElement("div");
      ui.empty.className = "empty";
      ui.empty.style.display = "none";
      ui.app.appendChild(ui.empty);
    }

    if (!ui.fab) {
      ui.fab = document.createElement("button");
      ui.fab.className = "fab";
      ui.fab.type = "button";
      ui.fab.textContent = "+";
      document.body.appendChild(ui.fab);
    }

    if (!ui.menu) {
      ui.menu = document.createElement("div");
      ui.menu.className = "menu";
      ui.menu.hidden = true;
      ui.menu.innerHTML = `
        <button data-act="pick">照片圖庫</button>
        <button data-act="camera">拍照</button>
        <button data-act="quick">⚡ 快速加入基礎單品</button>
        <button class="danger" data-act="settings">設定 / 更新</button>
      `;
      document.body.appendChild(ui.menu);
    }

    // chips render
    ui.chips.innerHTML = "";
    CATS.forEach((cat) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (cat === activeCat ? " on" : "");
      b.textContent = cat;
      b.dataset.cat = cat;
      ui.chips.appendChild(b);
    });

    // empty text default
    ui.empty.textContent = "尚無衣物，點右下角 + 新增";
  }

  // ====== Events ======
  function wireEvents() {
    // Chips filter
    ui.chips.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      activeCat = btn.dataset.cat || "全部";
      [...ui.chips.querySelectorAll(".chip")].forEach((c) =>
        c.classList.toggle("on", c.dataset.cat === activeCat)
      );
      renderGrid();
    });

    // FAB menu
    ui.fab.addEventListener("click", () => {
      ui.menu.hidden = !ui.menu.hidden;
    });

    // Close menu on outside click
    document.addEventListener("click", (e) => {
      if (ui.menu.hidden) return;
      const inMenu = e.target.closest(".menu");
      const inFab = e.target.closest(".fab");
      if (!inMenu && !inFab) ui.menu.hidden = true;
    });

    // Menu actions
    ui.menu.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      ui.menu.hidden = true;

      const act = btn.dataset.act;
      if (act === "pick") return pickImage(false);
      if (act === "camera") return pickImage(true);
      if (act === "quick") return openQuickAddSheet();
      if (act === "settings") return openSettingsSheet();
    });

    // Card click -> edit
    ui.grid.addEventListener("click", (e) => {
      const card = e.target.closest(".card");
      if (!card) return;
      const id = card.dataset.id;
      const item = items.find((x) => x.id === id);
      if (!item) return;
      openEditModal(item);
    });
  }

  // ====== Storage ======
  function loadItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveItems() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    renderHeaderCount();
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const s = raw ? JSON.parse(raw) : {};
      return {
        aiEndpoint: s.aiEndpoint || DEFAULT_AI_ENDPOINT,
      };
    } catch {
      return { aiEndpoint: DEFAULT_AI_ENDPOINT };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    updateEndpointBadge();
  }

  // ====== Render ======
  function renderAll() {
    renderHeaderCount();
    renderGrid();
  }

  function renderHeaderCount() {
    const count = items.length;
    if (ui.headerSub) ui.headerSub.textContent = `今天收集了 ${count} 件寶貝`;
  }

  function renderGrid() {
    ui.grid.innerHTML = "";

    const list =
      activeCat === "全部"
        ? items
        : items.filter((x) => (x.cat || "其他") === activeCat);

    if (list.length === 0) {
      ui.empty.style.display = "block";
      return;
    }
    ui.empty.style.display = "none";

    // 最新在前（你覺得需要也可改成 id/名稱排序）
    const sorted = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    for (const it of sorted) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card";
      card.dataset.id = it.id;

      const img = document.createElement("img");
      img.alt = it.name || "item";
      img.loading = "lazy";
      img.decoding = "async";
      img.src = it.imageDataUrl || "";
      if (!it.imageDataUrl) img.style.background = "#f2f2f2";

      const title = document.createElement("div");
      title.className = "cardTitle";
      title.textContent = it.name || "（未命名）";

      const tag = document.createElement("div");
      tag.className = "tag";
      const tempText =
        isNum(it.tmin) && isNum(it.tmax) ? `${it.tmin}–${it.tmax}°C` : "未設定溫度";
      const catText = it.cat || "其他";

      // 顏色/材質顯示（若有）
      const cm = [];
      if (it.color?.name) cm.push(it.color.name);
      if (it.material?.name) cm.push(it.material.name);

      tag.textContent = `${catText} · ${tempText}${cm.length ? " · " + cm.join(" / ") : ""}`;

      card.appendChild(img);
      card.appendChild(title);
      card.appendChild(tag);
      ui.grid.appendChild(card);
    }
  }

  // ====== Add item ======
  async function pickImage(useCamera) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (useCamera) input.capture = "environment";

    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;

      const resizedDataUrl = await fileToResizedDataUrl(file, MAX_IMAGE_SIDE, JPEG_QUALITY);

      const it = {
        id: cryptoId(),
        name: "",
        cat: "上衣",
        tmin: null,
        tmax: null,
        imageDataUrl: resizedDataUrl,
        color: null,
        material: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      items.unshift(it);
      saveItems();
      renderGrid();

      openEditModal(it);
    });

    input.click();
  }

  function openQuickAddSheet() {
    const modal = createModal({
      title: "⚡ 快速加入基礎單品",
      body: () => {
        const wrap = document.createElement("div");
        wrap.style.display = "grid";
        wrap.style.gridTemplateColumns = "repeat(2, 1fr)";
        wrap.style.gap = "10px";

        QUICK_PRESETS.forEach((p) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "catBtn";
          b.textContent = p.name;
          b.addEventListener("click", () => {
            const it = {
              id: cryptoId(),
              name: p.name,
              cat: p.cat,
              tmin: p.tmin,
              tmax: p.tmax,
              imageDataUrl: "",
              color: null,
              material: null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            items.unshift(it);
            saveItems();
            renderGrid();
            closeModal(modal);
            openEditModal(it);
          });
          wrap.appendChild(b);
        });

        return wrap;
      },
      footerButtons: [
        { text: "取消", kind: "ghost", onClick: (m) => closeModal(m) },
      ],
    });

    document.body.appendChild(modal);
  }

  // ====== Edit modal ======
  function openEditModal(it) {
    const modal = createModal({
      title: "編輯單品",
      body: () => buildEditForm(it, modal),
      footerButtons: [], // inside form
    });
    document.body.appendChild(modal);
  }

  function buildEditForm(it, modal) {
    const container = document.createElement("div");

    // Name
    container.appendChild(fieldLabel("名稱 / 描述"));
    const nameInput = document.createElement("input");
    nameInput.className = "input";
    nameInput.placeholder = "例如：深灰色立領羽絨外套，輕巧保暖";
    nameInput.value = it.name || "";
    container.appendChild(nameInput);

    // Temp range
    container.appendChild(fieldLabel("適穿溫度範圍（°C）"));
    const row = document.createElement("div");
    row.className = "row2";
    const tmin = document.createElement("input");
    tmin.className = "input";
    tmin.inputMode = "numeric";
    tmin.placeholder = "0";
    tmin.value = isNum(it.tmin) ? String(it.tmin) : "";
    const dash = document.createElement("div");
    dash.className = "dash";
    dash.textContent = "-";
    const tmax = document.createElement("input");
    tmax.className = "input";
    tmax.inputMode = "numeric";
    tmax.placeholder = "18";
    tmax.value = isNum(it.tmax) ? String(it.tmax) : "";
    row.appendChild(tmin);
    row.appendChild(dash);
    row.appendChild(tmax);
    container.appendChild(row);

    // AI inferred
    const aiBlock = document.createElement("div");
    aiBlock.style.marginTop = "12px";

    const aiTitle = document.createElement("div");
    aiTitle.className = "label";
    aiTitle.textContent = "AI 判斷（顏色 / 材質）";
    aiBlock.appendChild(aiTitle);

    const aiRow = document.createElement("div");
    aiRow.style.display = "grid";
    aiRow.style.gridTemplateColumns = "1fr 1fr";
    aiRow.style.gap = "10px";

    const colorInput = document.createElement("input");
    colorInput.className = "input";
    colorInput.placeholder = "顏色（例如：墨綠 / #2F4F3E）";
    colorInput.value = it.color?.name
      ? `${it.color.name}${it.color.hex ? " / " + it.color.hex : ""}`
      : "";

    const materialInput = document.createElement("input");
    materialInput.className = "input";
    materialInput.placeholder = "材質（例如：棉 / 牛仔 / 羊毛）";
    materialInput.value = it.material?.name || "";

    aiRow.appendChild(colorInput);
    aiRow.appendChild(materialInput);
    aiBlock.appendChild(aiRow);

    const aiBtn = document.createElement("button");
    aiBtn.type = "button";
    aiBtn.className = "btnPrimary";
    aiBtn.style.marginTop = "12px";
    aiBtn.textContent = "AI 自動判斷顏色與材質";
    aiBlock.appendChild(aiBtn);

    const aiHint = document.createElement("div");
    aiHint.style.marginTop = "8px";
    aiHint.style.color = "#666";
    aiHint.style.fontSize = "12px";
    aiHint.textContent =
      "會用你目前的「描述」+（若有）照片做判斷；若不確定會降低信心值。";
    aiBlock.appendChild(aiHint);

    const aiStatus = document.createElement("div");
    aiStatus.style.marginTop = "8px";
    aiStatus.style.color = "#666";
    aiStatus.style.fontSize = "12px";
    aiBlock.appendChild(aiStatus);

    container.appendChild(aiBlock);

    // Category
    container.appendChild(fieldLabel("修改分類"));
    const catGrid = document.createElement("div");
    catGrid.className = "catGrid";
    const cats = ["上衣", "下著", "內搭", "外套", "鞋子", "配件", "其他"];
    let catVal = it.cat || "其他";
    cats.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "catBtn" + (catVal === c ? " on" : "");
      b.textContent = c;
      b.addEventListener("click", () => {
        catVal = c;
        [...catGrid.querySelectorAll(".catBtn")].forEach((x) =>
          x.classList.toggle("on", x.textContent === c)
        );
      });
      catGrid.appendChild(b);
    });
    container.appendChild(catGrid);

    // Buttons
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btnPrimary";
    saveBtn.textContent = "儲存修改";

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btnDanger";
    delBtn.textContent = "刪除此單品";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "catBtn";
    cancelBtn.style.width = "100%";
    cancelBtn.style.marginTop = "10px";
    cancelBtn.textContent = "取消";

    container.appendChild(saveBtn);
    container.appendChild(delBtn);
    container.appendChild(cancelBtn);

    // AI click
    aiBtn.addEventListener("click", async () => {
      aiStatus.textContent = "AI 分析中…";
      aiBtn.disabled = true;

      try {
        const payload = {
          text: nameInput.value.trim(),
          imageDataUrl: it.imageDataUrl || null,
        };

        const res = await fetch(joinUrl(settings.aiEndpoint, "/analyze"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const t = await safeText(res);
          throw new Error(`AI 服務錯誤：${res.status} ${t || ""}`.trim());
        }

        const data = await res.json();

        // 期望 data.result 為 JSON
        const r = data?.result || data;

        // color
        if (r?.color?.name || r?.color_name) {
          const cname = r.color?.name || r.color_name;
          const chex = r.color?.hex || r.color_hex || "";
          it.color = { name: cname, hex: chex || "" };
          colorInput.value = `${cname}${chex ? " / " + chex : ""}`;
        }

        // material
        if (r?.material?.name || r?.material_name) {
          const mname = r.material?.name || r.material_name;
          it.material = { name: mname };
          materialInput.value = mname;
        }

        const conf = r?.confidence ?? r?.conf ?? null;
        const note = r?.notes || r?.comment || "";
        aiStatus.textContent = `完成${conf != null ? `（信心 ${Math.round(conf * 100)}%）` : ""}${note ? "：" + note : ""}`;
      } catch (err) {
        aiStatus.textContent = (err && err.message) ? err.message : "AI 分析失敗";
      } finally {
        aiBtn.disabled = false;
      }
    });

    // Save
    saveBtn.addEventListener("click", () => {
      it.name = nameInput.value.trim();
      it.tmin = parseNumOrNull(tmin.value);
      it.tmax = parseNumOrNull(tmax.value);
      it.cat = catVal;

      // allow manual override
      const cText = colorInput.value.trim();
      if (cText) {
        const parts = cText.split("/").map((s) => s.trim());
        it.color = { name: parts[0], hex: parts[1] || (it.color?.hex || "") };
      }
      const mText = materialInput.value.trim();
      if (mText) it.material = { name: mText };

      it.updatedAt = Date.now();
      saveItems();
      renderGrid();
      closeModal(modal);
    });

    // Delete
    delBtn.addEventListener("click", () => {
      items = items.filter((x) => x.id !== it.id);
      saveItems();
      renderGrid();
      closeModal(modal);
    });

    // Cancel
    cancelBtn.addEventListener("click", () => closeModal(modal));

    return container;
  }

  // ====== Settings / Update sheet ======
  function openSettingsSheet() {
    const modal = createModal({
      title: "設定 / 更新",
      body: () => {
        const wrap = document.createElement("div");

        wrap.appendChild(fieldLabel("AI 服務（Cloudflare Worker）"));
        const endpoint = document.createElement("input");
        endpoint.className = "input";
        endpoint.placeholder = "例如：https://xxx.yyy.workers.dev";
        endpoint.value = settings.aiEndpoint || DEFAULT_AI_ENDPOINT;
        wrap.appendChild(endpoint);

        const save = document.createElement("button");
        save.type = "button";
        save.className = "btnPrimary";
        save.textContent = "儲存設定";
        wrap.appendChild(save);

        const hr = document.createElement("div");
        hr.style.height = "12px";
        wrap.appendChild(hr);

        const updateBtn = document.createElement("button");
        updateBtn.type = "button";
        updateBtn.className = "catBtn";
        updateBtn.style.width = "100%";
        updateBtn.textContent = "強制檢查更新（Service Worker）";
        wrap.appendChild(updateBtn);

        const hardBtn = document.createElement("button");
        hardBtn.type = "button";
        hardBtn.className = "btnDanger";
        hardBtn.textContent = "強制清除快取並重載（解決卡頓/更新卡住）";
        wrap.appendChild(hardBtn);

        const msg = document.createElement("div");
        msg.style.marginTop = "8px";
        msg.style.fontSize = "12px";
        msg.style.color = "#666";
        wrap.appendChild(msg);

        save.addEventListener("click", () => {
          settings.aiEndpoint = endpoint.value.trim() || DEFAULT_AI_ENDPOINT;
          saveSettings();
          msg.textContent = "已儲存";
        });

        updateBtn.addEventListener("click", async () => {
          msg.textContent = "檢查更新中…";
          const ok = await swCheckAndUpdate();
          msg.textContent = ok ? "已觸發更新（若有新版會自動重載）" : "未偵測到更新或瀏覽器不支援";
        });

        hardBtn.addEventListener("click", async () => {
          msg.textContent = "清除中…";
          await hardReload();
        });

        return wrap;
      },
      footerButtons: [{ text: "關閉", kind: "ghost", onClick: (m) => closeModal(m) }],
    });

    document.body.appendChild(modal);
  }

  function updateEndpointBadge() {
    // 非必要，只是方便你確認 endpoint；若 header 不存在就略過
    if (!ui.headerBrand) return;
    // 不動你的 UI 風格，只在 title attribute 放資訊
    ui.headerBrand.title = `AI Endpoint: ${settings.aiEndpoint}`;
  }

  // ====== Modal helper ======
  function createModal({ title, body, footerButtons }) {
    const overlay = document.createElement("div");
    overlay.className = "modal";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal(overlay);
    });

    const card = document.createElement("div");
    card.className = "modalCard";

    const head = document.createElement("div");
    head.className = "modalHead";

    const h = document.createElement("div");
    h.className = "modalTitle";
    h.textContent = title || "";

    const x = document.createElement("button");
    x.type = "button";
    x.className = "iconBtn";
    x.textContent = "×";
    x.addEventListener("click", () => closeModal(overlay));

    head.appendChild(h);
    head.appendChild(x);

    const content = document.createElement("div");
    content.appendChild(typeof body === "function" ? body() : body);

    card.appendChild(head);
    card.appendChild(content);

    if (footerButtons && footerButtons.length) {
      const foot = document.createElement("div");
      foot.style.marginTop = "12px";
      foot.style.display = "grid";
      foot.style.gap = "10px";
      footerButtons.forEach((b) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = b.kind === "primary" ? "btnPrimary" : "catBtn";
        btn.style.width = "100%";
        btn.textContent = b.text;
        btn.addEventListener("click", () => b.onClick && b.onClick(overlay));
        foot.appendChild(btn);
      });
      card.appendChild(foot);
    }

    overlay.appendChild(card);
    return overlay;
  }

  function closeModal(modalEl) {
    if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
  }

  function fieldLabel(text) {
    const l = document.createElement("div");
    l.className = "label";
    l.textContent = text;
    return l;
  }

  // ====== Image resize ======
  async function fileToResizedDataUrl(file, maxSide, quality) {
    const img = await readFileAsImage(file);
    const { w, h } = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, maxSide);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: false });

    // draw
    ctx.drawImage(img, 0, 0, w, h);

    // jpeg for size
    return canvas.toDataURL("image/jpeg", quality);
  }

  function fitSize(w, h, maxSide) {
    if (!w || !h) return { w: maxSide, h: maxSide };
    const max = Math.max(w, h);
    if (max <= maxSide) return { w, h };
    const scale = maxSide / max;
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
  }

  function readFileAsImage(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("讀取圖片失敗"));
      fr.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("解析圖片失敗"));
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  // ====== Service Worker: register + update ======
  async function setupServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });

      // 若已有 waiting，提示直接更新（iOS 常卡）
      if (reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      // 當新 SW 安裝完成 -> 直接啟用並 reload
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            sw.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // 新 SW 接管後重載
        window.location.reload();
      });

      // 進站時自動檢查一次（不會太頻繁）
      setTimeout(() => swCheckAndUpdate(), 1200);
    } catch {
      // ignore
    }
  }

  async function swCheckAndUpdate() {
    if (!("serviceWorker" in navigator)) return false;
    try {
      const reg = await navigator.serviceWorker.getRegistration("./");
      if (!reg) return false;

      // 強制抓最新 sw.js（避免 cache）
      await fetch("./sw.js", { cache: "no-store" });

      await reg.update();
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      return true;
    } catch {
      return false;
    }
  }

  async function hardReload() {
    // 清 caches + unregister SW
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {}

    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {}

    // 重新載入（加 cache bust）
    const u = new URL(location.href);
    u.searchParams.set("_", String(Date.now()));
    location.href = u.toString();
  }

  // ====== Utils ======
  function cryptoId() {
    // Safari 也可用
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function parseNumOrNull(v) {
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  }

  function isNum(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  function joinUrl(base, path) {
    const b = (base || "").replace(/\/+$/, "");
    const p = (path || "").startsWith("/") ? path : "/" + path;
    return b + p;
  }

  async function safeText(res) {
    try {
      return await res.text();
    } catch {
      return "";
    }
  }
})();