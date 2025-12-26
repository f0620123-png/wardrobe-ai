/* docs/app.js
   My Wardrobe - vanilla JS
   - localStorage persistence
   - FAB menu: Photo Library / Camera / Quick add
   - Card click -> edit modal (save/delete)
   - AI analyze color/material via Worker endpoint (vision + text)
   - Service Worker: force update / clear caches
*/

(() => {
  // ====== CONFIG ======
  // 重要：部署好 Worker 後，把這行改成你的 Worker URL
  // 例如: https://wardrobe-ai-proxy.yourname.workers.dev/analyze
  const AI_ENDPOINT = "https://YOUR-WORKER-DOMAIN.workers.dev/analyze";

  const LS_KEY_ITEMS = "wardrobe_items_v1";
  const LS_KEY_UI = "wardrobe_ui_v1";
  const APP_VERSION = "2025-12-26.1";

  const CATS = ["全部", "上衣", "下著", "內搭", "外套", "鞋子", "配件"];

  // 你截圖中「快速加入基礎單品」範例
  const QUICK_ITEMS = [
    { title: "長袖打底（白）", cat: "內搭", tMin: 10, tMax: 22 },
    { title: "長袖打底（黑）", cat: "內搭", tMin: 10, tMax: 22 },
    { title: "短袖T恤（白）", cat: "上衣", tMin: 22, tMax: 32 },
    { title: "短袖T恤（黑）", cat: "上衣", tMin: 22, tMax: 32 },
    { title: "連帽外套（灰）", cat: "外套", tMin: 12, tMax: 24 },
    { title: "牛仔外套", cat: "外套", tMin: 15, tMax: 26 },
    { title: "牛仔寬褲", cat: "下著", tMin: 10, tMax: 26 },
    { title: "直筒牛仔褲", cat: "下著", tMin: 10, tMax: 26 }
  ];

  // Fit / Length（你新截圖有這兩個欄位）
  const FIT_OPTS = ["", "Oversized", "Regular", "Slim", "Relaxed"];
  const LEN_OPTS = ["", "Cropped", "Hip-length", "Long", "Maxi"];

  // ====== STATE ======
  let state = {
    tab: "衣櫃",          // bottom nav
    cat: "全部",          // filter chip
    items: [],
    menuOpen: false,
    modal: null,          // { type, ... }
  };

  // ====== HELPERS ======
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  function uid() {
    return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }

  function clampNum(n, def = 0) {
    const x = Number(n);
    return Number.isFinite(x) ? x : def;
  }

  function loadItems() {
    try {
      const raw = localStorage.getItem(LS_KEY_ITEMS);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveItems(items) {
    localStorage.setItem(LS_KEY_ITEMS, JSON.stringify(items));
  }

  function loadUI() {
    try {
      const raw = localStorage.getItem(LS_KEY_UI);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }

  function saveUI(ui) {
    localStorage.setItem(LS_KEY_UI, JSON.stringify(ui));
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtTempRange(tMin, tMax) {
    const a = clampNum(tMin, 0);
    const b = clampNum(tMax, 0);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
    if (a === 0 && b === 0) return "";
    return `${a}–${b}°C`;
  }

  function todayCount() {
    // 以「今天新增」計算：createdAt 在同一天
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const start = new Date(y, m, d).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return state.items.filter(it => it.createdAt >= start && it.createdAt < end).length;
  }

  function filteredItems() {
    if (state.tab !== "衣櫃") return [];
    if (state.cat === "全部") return [...state.items].sort((a, b) => b.updatedAt - a.updatedAt);
    return state.items
      .filter(it => it.cat === state.cat)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // ====== SERVICE WORKER / FORCE REFRESH ======
  async function swRegister() {
    if (!("serviceWorker" in navigator)) return;

    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });

      // 若有 waiting 的新版 sw：提示更新
      if (reg.waiting) {
        // 自動切新版 + 刷新（避免你一直看到舊版）
        await swSkipWaiting(reg);
      }

      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", async () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            // 有新版完成安裝
            await swSkipWaiting(reg);
          }
        });
      });

      // controller change -> reload
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // 用 location.reload() 會受 cache 影響，改用 cache-bust
        const u = new URL(location.href);
        u.searchParams.set("_v", String(Date.now()));
        location.replace(u.toString());
      });
    } catch (e) {
      console.warn("SW register failed:", e);
    }
  }

  function swPost(msg) {
    if (!navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage(msg);
  }

  async function swSkipWaiting(reg) {
    try {
      reg.waiting?.postMessage({ type: "SKIP_WAITING" });
    } catch {}
  }

  async function forceRefreshHard() {
    // 1) 請 SW 清快取
    swPost({ type: "CLEAR_CACHES" });
    // 2) 清掉瀏覽器 HTTP cache 的影響：加 query 重新載入
    const u = new URL(location.href);
    u.searchParams.set("_hard", String(Date.now()));
    location.replace(u.toString());
  }

  // ====== AI CALL ======
  async function aiAnalyze({ imageDataUrl, text }) {
    // imageDataUrl: data:image/...;base64,...
    // text: optional description
    const payload = {
      image: imageDataUrl || null,
      text: text || ""
    };

    const res = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`AI 服務錯誤: ${res.status} ${msg}`.slice(0, 300));
    }
    return await res.json();
  }

  // ====== UI RENDER ======
  function render() {
    const root = document.getElementById("app") || document.body;

    // 一次性建立 layout（避免 UI 被舊 DOM / overlay 卡住）
    root.innerHTML = `
      <div class="app" id="appShell">
        ${renderHeader()}
        ${renderChips()}
        ${renderMain()}
      </div>
      ${renderFab()}
      ${renderBottomNav()}
      ${renderOverlays()}
    `;

    bindEvents();
  }

  function renderHeader() {
    return `
      <div class="header">
        <div class="brand">MY WARDROBE</div>
        <h1>我的衣櫃日記</h1>
        <div class="sub">今天收集了 <b>${todayCount()}</b> 件寶貝 <span style="opacity:.55;">v${escapeHtml(APP_VERSION)}</span></div>
      </div>
    `;
  }

  function renderChips() {
    if (state.tab !== "衣櫃") return "";
    const chips = CATS.map(cat => {
      const on = cat === state.cat ? "on" : "";
      return `<button class="chip ${on}" data-act="setCat" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`;
    }).join("");
    return `<div class="chips" aria-label="category chips">${chips}</div>`;
  }

  function renderMain() {
    if (state.tab !== "衣櫃") {
      // 先做簡單 placeholder（保留你底部四分頁 UI）
      const hint = state.tab === "自選"
        ? "這裡可以做「今日穿搭組合」或「一鍵推薦」功能（之後加）。"
        : state.tab === "靈感"
          ? "這裡可以做「穿搭靈感收藏」或「顏色/風格分類」功能（之後加）。"
          : "這裡可以做「匯出/匯入、強制更新、AI 設定」等功能（已預留按鈕）。";
      return `
        <div class="empty">
          <div style="font-weight:900; color:#333; margin-bottom:8px;">${escapeHtml(state.tab)}</div>
          <div>${escapeHtml(hint)}</div>
          ${state.tab === "個人" ? `
            <div style="margin-top:12px; display:grid; gap:10px;">
              <button class="btnPrimary" data-act="forceRefresh">強制更新（清快取）</button>
              <button class="btnDanger" data-act="wipeAll">清空所有資料（localStorage）</button>
            </div>
          ` : ""}
        </div>
      `;
    }

    const list = filteredItems();
    if (list.length === 0) {
      return `<div class="empty">尚無衣物，點右下角 + 新增</div>`;
    }

    return `
      <div class="grid">
        ${list.map(renderCard).join("")}
      </div>
    `;
  }

  function renderCard(it) {
    const img = it.imageDataUrl
      ? `<img src="${escapeHtml(it.imageDataUrl)}" alt="${escapeHtml(it.title)}">`
      : `<img alt="" src="" style="background:#f2f2f2;">`;

    const tag = `${escapeHtml(it.cat || "")}${fmtTempRange(it.tMin, it.tMax) ? ` · ${escapeHtml(fmtTempRange(it.tMin, it.tMax))}` : ""}`;

    // 顏色 / 材質（如果有）
    const cm = [
      it.color ? `顏色：${escapeHtml(it.color)}` : "",
      it.material ? `材質：${escapeHtml(it.material)}` : ""
    ].filter(Boolean).join(" · ");

    return `
      <button class="card" data-act="edit" data-id="${escapeHtml(it.id)}">
        ${img}
        <div class="cardTitle">${escapeHtml(it.title || "（未命名）")}</div>
        <div class="tag">${escapeHtml(tag || "未分類")}</div>
        ${cm ? `<div class="tag" style="margin-top:-6px;">${cm}</div>` : ""}
      </button>
    `;
  }

  function renderFab() {
    // FAB 只在「衣櫃」顯示（避免其他 tab 被遮）
    if (state.tab !== "衣櫃") return "";
    return `
      <button class="fab" data-act="toggleMenu" aria-label="add">+</button>
      ${state.menuOpen ? `
        <div class="menu" id="fabMenu">
          <button data-act="addPhoto">📷 照片圖庫</button>
          <button data-act="addCamera">📸 拍照</button>
          <button data-act="quickAdd">⚡ 快速加入基礎單品</button>
          <button class="danger" data-act="forceRefresh">強制更新（清快取）</button>
        </div>
      ` : ""}
      <input id="filePicker" type="file" accept="image/*" style="display:none" />
      <input id="cameraPicker" type="file" accept="image/*" capture="environment" style="display:none" />
    `;
  }

  function renderBottomNav() {
    const tabs = ["衣櫃", "自選", "靈感", "個人"];
    return `
      <div class="bottomNav" role="navigation" aria-label="bottom nav">
        ${tabs.map(t => `
          <button class="${t === state.tab ? "on" : ""}" data-act="setTab" data-tab="${escapeHtml(t)}">${escapeHtml(t)}</button>
        `).join("")}
      </div>
    `;
  }

  function renderOverlays() {
    // overlay / modal：永遠用「有就 render，沒有就不 render」避免 invisible div 擋住操作
    if (!state.modal) return "";

    if (state.modal.type === "quick") {
      return `
        <div class="modal" data-act="closeModal">
          <div class="modalCard" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
            <div class="modalHead">
              <div class="modalTitle">⚡ 快速加入基礎單品</div>
              <button class="iconBtn" data-act="closeModal">×</button>
            </div>
            <div class="empty" style="margin-top:0;">
              選擇
            </div>
            <div class="chips" style="padding-top:10px;">
              ${QUICK_ITEMS.map((q, idx) =>
                `<button class="chip" data-act="quickPick" data-idx="${idx}">${escapeHtml(q.title)}</button>`
              ).join("")}
            </div>
          </div>
        </div>
      `;
    }

    if (state.modal.type === "edit") {
      const it = state.modal.item;
      const img = it.imageDataUrl
        ? `<img src="${escapeHtml(it.imageDataUrl)}" alt="" style="width:100%; height:180px; object-fit:cover; border-radius:18px; border:1px solid #eee;" />`
        : `<div style="height:140px; border-radius:18px; background:#f3f3f3; display:flex; align-items:center; justify-content:center; color:#888; font-weight:800;">無照片</div>`;

      return `
        <div class="modal" data-act="closeModal">
          <div class="modalCard" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
            <div class="modalHead">
              <div class="modalTitle">編輯單品</div>
              <button class="iconBtn" data-act="closeModal">×</button>
            </div>

            ${img}

            <div class="field">
              <div class="label">名稱 / 描述</div>
              <input class="input" id="f_title" placeholder="例如：深灰色立領羽絨外套，輕巧保暖" value="${escapeHtml(it.title || "")}">
            </div>

            <div class="field">
              <div class="label">適穿溫度範圍（°C）</div>
              <div class="row2">
                <input class="input" id="f_tmin" inputmode="numeric" value="${escapeHtml(it.tMin ?? 0)}">
                <div class="dash">-</div>
                <input class="input" id="f_tmax" inputmode="numeric" value="${escapeHtml(it.tMax ?? 0)}">
              </div>
            </div>

            <div class="field">
              <div class="label">版型（FIT） / 長度（LENGTH）</div>
              <div class="row2" style="grid-template-columns:1fr 10px 1fr;">
                <select class="input" id="f_fit">
                  ${FIT_OPTS.map(v => `<option value="${escapeHtml(v)}" ${v === (it.fit || "") ? "selected" : ""}>${escapeHtml(v || "（未設定）")}</option>`).join("")}
                </select>
                <div></div>
                <select class="input" id="f_len">
                  ${LEN_OPTS.map(v => `<option value="${escapeHtml(v)}" ${v === (it.length || "") ? "selected" : ""}>${escapeHtml(v || "（未設定）")}</option>`).join("")}
                </select>
              </div>
            </div>

            <div class="field">
              <div class="label">AI 判斷（顏色 / 材質）</div>
              <div class="row2" style="grid-template-columns:1fr 10px 1fr;">
                <input class="input" id="f_color" placeholder="顏色（可手改）" value="${escapeHtml(it.color || "")}">
                <div></div>
                <input class="input" id="f_mat" placeholder="材質（可手改）" value="${escapeHtml(it.material || "")}">
              </div>
              <div style="display:grid; grid-template-columns:1fr; gap:10px; margin-top:10px;">
                <button class="btnPrimary" data-act="aiAnalyze">用 AI 自動判斷顏色/材質</button>
              </div>
              <div id="aiStatus" style="margin-top:8px; color:#777; font-weight:700;"></div>
            </div>

            <div class="field">
              <div class="label">修改分類</div>
              <div class="catGrid">
                ${CATS.filter(c => c !== "全部").map(c => `
                  <button class="catBtn ${c === it.cat ? "on" : ""}" data-act="pickCat" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>
                `).join("")}
              </div>
            </div>

            <button class="btnPrimary" data-act="saveItem">儲存修改</button>
            <button class="btnDanger" data-act="deleteItem">刪除此單品</button>

            <button class="chip" style="width:100%; margin-top:12px;" data-act="closeModal">取消</button>
          </div>
        </div>
      `;
    }

    return "";
  }

  // ====== EVENT BINDING ======
  function bindEvents() {
    document.body.onclick = async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) {
        // 點空白：如果 menu 開著就關掉
        if (state.menuOpen) {
          state.menuOpen = false;
          render();
        }
        return;
      }

      const act = btn.dataset.act;

      try {
        if (act === "setTab") {
          state.tab = btn.dataset.tab;
          state.menuOpen = false;
          saveUI({ ...loadUI(), tab: state.tab, cat: state.cat });
          render();
          return;
        }

        if (act === "setCat") {
          state.cat = btn.dataset.cat;
          saveUI({ ...loadUI(), tab: state.tab, cat: state.cat });
          render();
          return;
        }

        if (act === "toggleMenu") {
          state.menuOpen = !state.menuOpen;
          render();
          return;
        }

        if (act === "addPhoto") {
          state.menuOpen = false;
          render();
          $("#filePicker")?.click();
          return;
        }

        if (act === "addCamera") {
          state.menuOpen = false;
          render();
          $("#cameraPicker")?.click();
          return;
        }

        if (act === "quickAdd") {
          state.menuOpen = false;
          state.modal = { type: "quick" };
          render();
          return;
        }

        if (act === "quickPick") {
          const idx = Number(btn.dataset.idx);
          const q = QUICK_ITEMS[idx];
          if (!q) return;

          const now = Date.now();
          const item = {
            id: uid(),
            title: q.title,
            cat: q.cat,
            tMin: q.tMin ?? 0,
            tMax: q.tMax ?? 0,
            fit: "",
            length: "",
            color: "",
            material: "",
            imageDataUrl: "",
            createdAt: now,
            updatedAt: now
          };

          state.items.unshift(item);
          saveItems(state.items);
          state.modal = null;
          render();
          return;
        }

        if (act === "edit") {
          const id = btn.dataset.id;
          const it = state.items.find(x => x.id === id);
          if (!it) return;
          state.modal = { type: "edit", item: { ...it }, catPick: it.cat };
          state.menuOpen = false;
          render();
          return;
        }

        if (act === "closeModal") {
          state.modal = null;
          render();
          return;
        }

        if (act === "pickCat") {
          const cat = btn.dataset.cat;
          if (!state.modal || state.modal.type !== "edit") return;
          state.modal.item.cat = cat;
          render(); // 重新 render 讓按鈕 on 更新
          return;
        }

        if (act === "saveItem") {
          if (!state.modal || state.modal.type !== "edit") return;

          const it = state.modal.item;
          it.title = $("#f_title")?.value?.trim() || "";
          it.tMin = clampNum($("#f_tmin")?.value, 0);
          it.tMax = clampNum($("#f_tmax")?.value, 0);
          it.fit = $("#f_fit")?.value || "";
          it.length = $("#f_len")?.value || "";
          it.color = $("#f_color")?.value?.trim() || "";
          it.material = $("#f_mat")?.value?.trim() || "";
          it.updatedAt = Date.now();

          const idx = state.items.findIndex(x => x.id === it.id);
          if (idx >= 0) state.items[idx] = it;
          else state.items.unshift(it);

          saveItems(state.items);
          state.modal = null;
          render();
          return;
        }

        if (act === "deleteItem") {
          if (!state.modal || state.modal.type !== "edit") return;
          const id = state.modal.item.id;
          state.items = state.items.filter(x => x.id !== id);
          saveItems(state.items);
          state.modal = null;
          render();
          return;
        }

        if (act === "aiAnalyze") {
          if (!state.modal || state.modal.type !== "edit") return;
          const it = state.modal.item;

          const status = $("#aiStatus");
          if (status) status.textContent = "AI 分析中…";

          // 送：照片 + 文字（title）
          const result = await aiAnalyze({
            imageDataUrl: it.imageDataUrl || null,
            text: ($("#f_title")?.value || it.title || "").trim()
          });

          // 期望 result: { color, material, confidence, notes }
          const color = (result?.color || "").trim();
          const material = (result?.material || "").trim();

          if (color) $("#f_color").value = color;
          if (material) $("#f_mat").value = material;

          if (status) {
            const conf = result?.confidence != null ? `信心值：${result.confidence}` : "";
            const notes = result?.notes ? `（${result.notes}）` : "";
            status.textContent = ["完成", conf, notes].filter(Boolean).join(" ");
          }
          return;
        }

        if (act === "forceRefresh") {
          await forceRefreshHard();
          return;
        }

        if (act === "wipeAll") {
          // 清空 localStorage（保險：只清自己 key）
          localStorage.removeItem(LS_KEY_ITEMS);
          localStorage.removeItem(LS_KEY_UI);
          state.items = [];
          state.cat = "全部";
          state.tab = "衣櫃";
          state.modal = null;
          state.menuOpen = false;
          render();
          return;
        }
      } catch (err) {
        console.error(err);
        alert(String(err?.message || err));
      }
    };

    // file pickers
    const filePicker = $("#filePicker");
    if (filePicker && !filePicker._bound) {
      filePicker._bound = true;
      filePicker.addEventListener("change", async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        const dataUrl = await fileToDataUrl(f);

        const now = Date.now();
        const item = {
          id: uid(),
          title: "",
          cat: "上衣",
          tMin: 0,
          tMax: 0,
          fit: "",
          length: "",
          color: "",
          material: "",
          imageDataUrl: dataUrl,
          createdAt: now,
          updatedAt: now
        };
        state.items.unshift(item);
        saveItems(state.items);
        // 直接開編輯 modal
        state.modal = { type: "edit", item: { ...item } };
        render();
      });
    }

    const cameraPicker = $("#cameraPicker");
    if (cameraPicker && !cameraPicker._bound) {
      cameraPicker._bound = true;
      cameraPicker.addEventListener("change", async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        const dataUrl = await fileToDataUrl(f);

        const now = Date.now();
        const item = {
          id: uid(),
          title: "",
          cat: "上衣",
          tMin: 0,
          tMax: 0,
          fit: "",
          length: "",
          color: "",
          material: "",
          imageDataUrl: dataUrl,
          createdAt: now,
          updatedAt: now
        };
        state.items.unshift(item);
        saveItems(state.items);
        state.modal = { type: "edit", item: { ...item } };
        render();
      });
    }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // ====== INIT ======
  function init() {
    state.items = loadItems();

    const ui = loadUI();
    if (ui.tab && ["衣櫃", "自選", "靈感", "個人"].includes(ui.tab)) state.tab = ui.tab;
    if (ui.cat && CATS.includes(ui.cat)) state.cat = ui.cat;

    // SW
    swRegister();

    render();
  }

  init();
})();