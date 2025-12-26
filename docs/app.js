/* docs/app.js
 * 功能：
 * - 衣櫃：新增/編輯/刪除（localStorage）
 * - AI：照片一鍵填完整（顏色/材質/版型/長度/場合/季節）→ Worker /analyze
 * - 自選穿搭：選單品 → 合成「示意圖」（Canvas 拼貼）→ 產出可存的 PNG DataURL
 * - 位置/體感溫度：navigator.geolocation → Worker /weather → 顯示溫度/體感
 * - AI 推薦穿搭：依體感溫度 + 場合/風格 → Worker /recommend → 自動填入自選穿搭槽位
 *
 * 你只要確認：
 * - Worker URL 正確（DEFAULT_AI_ENDPOINT）
 * - Cloudflare Worker 的 ALLOW_ORIGINS 有包含你的 GitHub Pages origin（不含路徑）
 */

(() => {
  "use strict";

  // ====== 你的 Cloudflare Worker 網址 ======
  const DEFAULT_AI_ENDPOINT = "https://autumn-cell-d032.f0620123.workers.dev";

  // ====== Storage Keys ======
  const LS_KEY_ITEMS = "wardrobe_items_v2";
  const LS_KEY_PREFS = "wardrobe_prefs_v2";
  const LS_KEY_MIX = "wardrobe_mix_v1";

  // ====== Enums ======
  const CATEGORIES = [
    { key: "all", label: "全部" },
    { key: "inner", label: "內搭" },
    { key: "tops", label: "上衣" },
    { key: "bottoms", label: "下著" },
    { key: "outer", label: "外套" },
    { key: "shoes", label: "鞋子" },
    { key: "accessory", label: "配件" },
  ];

  const FITS = ["Slim", "Regular", "Relaxed", "Oversized"];
  const LENGTHS = ["Cropped", "Hip-length", "Regular", "Long"];

  const OCCASIONS = [
    { key: "Daily", label: "日常" },
    { key: "Work", label: "上班" },
    { key: "Date", label: "約會" },
    { key: "Sport", label: "運動" },
    { key: "Outdoor", label: "戶外" },
    { key: "Formal", label: "正式" },
    { key: "Party", label: "派對" },
    { key: "Travel", label: "旅行" },
  ];

  const STYLES = [
    { key: "Random", label: "隨機" },
    { key: "Minimalist", label: "極簡" },
    { key: "Streetwear", label: "街頭" },
    { key: "CityBoy", label: "日系" },
    { key: "KFashion", label: "韓系" },
    { key: "Vintage", label: "復古" },
    { key: "SmartCasual", label: "商務休閒" },
    { key: "Athleisure", label: "運動風" },
    { key: "OldMoney", label: "老錢風" },
    { key: "Gorpcore", label: "Gorpcore" },
  ];

  const SEASONS = [
    { key: "Spring", label: "春" },
    { key: "Summer", label: "夏" },
    { key: "Autumn", label: "秋" },
    { key: "Winter", label: "冬" },
    { key: "All", label: "四季" },
  ];

  // ====== State ======
  let state = {
    items: [],
    activeCategory: "all",
    aiEndpoint: DEFAULT_AI_ENDPOINT,
    tab: "wardrobe", // wardrobe | mix
    mix: {
      occasion: "Daily",
      style: "Random",
      weather: null, // { temp, feelsLike, code, city? }
      slots: {
        inner: null,
        tops: null,
        bottoms: null,
        outer: null,
        shoes: null,
        accessory: null,
      },
      compositeDataUrl: "",
      lastUpdatedAt: "",
    },
  };

  // ====== Utils ======
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function uid() {
    return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }
  function nowISO() {
    return new Date().toISOString();
  }
  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }
  function safeParseJSON(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function categoryLabel(key) {
    return (CATEGORIES.find((c) => c.key === key) || {}).label || key;
  }
  function sortByUpdatedDesc(a, b) {
    const ta = Date.parse(a.updatedAt || a.createdAt || 0);
    const tb = Date.parse(b.updatedAt || b.createdAt || 0);
    return tb - ta;
  }

  function normalizeItem(item) {
    const base = {
      id: uid(),
      category: "tops",
      title: "",
      desc: "",
      tempMin: 18,
      tempMax: 28,
      color: "",
      material: "",
      fit: "Regular",
      length: "Regular",
      occasions: [],
      seasons: [],
      imageDataUrl: "",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const out = Object.assign(base, item || {});
    if (!CATEGORIES.some((c) => c.key === out.category) || out.category === "all") out.category = "tops";
    if (!FITS.includes(out.fit)) out.fit = "Regular";
    if (!LENGTHS.includes(out.length)) out.length = "Regular";
    if (!Array.isArray(out.occasions)) out.occasions = [];
    if (!Array.isArray(out.seasons)) out.seasons = [];
    return out;
  }

  // ====== Storage ======
  function loadPrefs() {
    const prefs = safeParseJSON(localStorage.getItem(LS_KEY_PREFS) || "{}", {});
    if (prefs && typeof prefs === "object") {
      state.aiEndpoint = prefs.aiEndpoint || DEFAULT_AI_ENDPOINT;
      state.activeCategory = prefs.activeCategory || "all";
      state.tab = prefs.tab || "wardrobe";
    }
  }
  function savePrefs() {
    localStorage.setItem(LS_KEY_PREFS, JSON.stringify({
      aiEndpoint: state.aiEndpoint,
      activeCategory: state.activeCategory,
      tab: state.tab,
    }));
  }

  function loadItems() {
    const arr = safeParseJSON(localStorage.getItem(LS_KEY_ITEMS) || "[]", []);
    state.items = Array.isArray(arr) ? arr.map(normalizeItem) : [];
  }
  function saveItems() {
    localStorage.setItem(LS_KEY_ITEMS, JSON.stringify(state.items));
    updateCounter();
  }

  function loadMix() {
    const m = safeParseJSON(localStorage.getItem(LS_KEY_MIX) || "{}", {});
    if (m && typeof m === "object") {
      state.mix = Object.assign(state.mix, m);
      // 防守：slot key
      state.mix.slots = Object.assign({
        inner: null, tops: null, bottoms: null, outer: null, shoes: null, accessory: null
      }, state.mix.slots || {});
    }
  }
  function saveMix() {
    state.mix.lastUpdatedAt = nowISO();
    localStorage.setItem(LS_KEY_MIX, JSON.stringify(state.mix));
  }

  // ====== Minimal UI (若你原本 HTML 沒有對應節點，也能直接跑) ======
  function ensureUI() {
    // 只要頁面有 #appRoot，就視為你有自己的 UI
    if ($("#appRoot")) return;

    const root = document.createElement("div");
    root.id = "appRoot";
    root.style.cssText = "padding:16px;max-width:980px;margin:0 auto;font-family: system-ui, -apple-system;";
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div>
          <div style="font-weight:900;font-size:22px;">My Wardrobe</div>
          <div id="counterText" style="opacity:.7;margin-top:6px;">今天收集了 0 件寶貝</div>
        </div>
        <div style="display:flex;gap:10px;">
          <button id="openSettingsBtn" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(0,0,0,.12);background:#fff;">設定</button>
        </div>
      </div>

      <div style="margin:14px 0;display:flex;gap:10px;">
        <button data-tab="wardrobe" id="tabWardrobe" style="padding:10px 12px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:#fff;">衣櫃</button>
        <button data-tab="mix" id="tabMix" style="padding:10px 12px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:#fff;">自選穿搭</button>
      </div>

      <div id="pageWardrobe">
        <div id="chipBar" style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0;"></div>
        <div id="itemsGrid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;"></div>
      </div>

      <div id="pageMix" style="display:none;">
        <div id="weatherCard" style="padding:14px;border-radius:18px;border:1px solid rgba(0,0,0,.08);background:#fff;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
            <div>
              <div style="font-weight:800;">當下天氣 / 體感溫度</div>
              <div id="weatherText" style="opacity:.75;margin-top:6px;">尚未取得</div>
            </div>
            <button id="btnWeather" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(0,0,0,.12);background:#fff;">抓取位置</button>
          </div>
        </div>

        <div style="margin-top:14px;padding:14px;border-radius:18px;border:1px solid rgba(0,0,0,.08);background:#fff;">
          <div style="font-weight:800;">Step 1：場合</div>
          <div id="occasionBar" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;"></div>

          <div style="font-weight:800;margin-top:14px;">Step 2：風格</div>
          <div id="styleBar" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;"></div>

          <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">
            <button id="btnRecommend" style="padding:12px 14px;border-radius:14px;border:0;background:rgba(140,80,255,.9);color:#fff;font-weight:900;">
              ✨ 推薦穿搭
            </button>
            <button id="btnCompose" style="padding:12px 14px;border-radius:14px;border:1px solid rgba(0,0,0,.12);background:#fff;font-weight:800;">
              生成示意圖
            </button>
            <button id="btnClearSlots" style="padding:12px 14px;border-radius:14px;border:1px solid rgba(0,0,0,.12);background:#fff;">
              清空選擇
            </button>
          </div>
        </div>

        <div style="margin-top:14px;">
          <div style="font-weight:900;font-size:16px;margin-bottom:10px;">選擇單品（點格子挑選）</div>
          <div id="slotGrid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;"></div>
        </div>

        <div id="composeResult" style="margin-top:14px;display:none;">
          <div style="font-weight:900;margin-bottom:8px;">穿搭示意圖（可長按存圖）</div>
          <img id="composeImg" alt="" style="width:100%;border-radius:18px;border:1px solid rgba(0,0,0,.08);background:#fff;" />
          <div style="margin-top:10px;opacity:.7;font-size:12px;line-height:1.5;">
            iPhone 儲存方式：長按圖片 → 加入照片。<br/>
            若你要「下載按鈕」，需要 iOS Safari 允許下載行為（有時會被限制）。
          </div>
        </div>
      </div>

      <button id="fabAdd"
        style="position:fixed;right:16px;bottom:16px;width:62px;height:62px;border-radius:999px;font-size:28px;border:0;background:rgba(140,80,255,.95);color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.25);">
        +
      </button>
    `;
    document.body.appendChild(root);
  }

  // ====== Wardrobe UI ======
  function updateCounter() {
    const el = $("#counterText");
    if (!el) return;
    el.textContent = `今天收集了 ${state.items.length} 件寶貝`;
  }

  function renderTabs() {
    const w = $("#pageWardrobe");
    const m = $("#pageMix");
    if (!w || !m) return;

    w.style.display = state.tab === "wardrobe" ? "" : "none";
    m.style.display = state.tab === "mix" ? "" : "none";

    const tabW = $("#tabWardrobe");
    const tabM = $("#tabMix");
    if (tabW && tabM) {
      tabW.style.background = state.tab === "wardrobe" ? "rgba(0,0,0,.06)" : "#fff";
      tabM.style.background = state.tab === "mix" ? "rgba(0,0,0,.06)" : "#fff";
    }
  }

  function renderChips() {
    const bar = $("#chipBar");
    if (!bar) return;

    bar.innerHTML = CATEGORIES.map((c) => {
      const active = c.key === state.activeCategory ? "true" : "false";
      return `<button data-cat="${c.key}" data-active="${active}"
        style="padding:10px 12px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:${active === "true" ? "rgba(0,0,0,.06)" : "#fff"};">
        ${c.label}
      </button>`;
    }).join("");

    $$("[data-cat]", bar).forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeCategory = btn.dataset.cat;
        savePrefs();
        renderChips();
        renderItems();
      });
    });
  }

  function filteredItems() {
    const list = [...state.items].sort(sortByUpdatedDesc);
    if (state.activeCategory === "all") return list;
    return list.filter((x) => x.category === state.activeCategory);
  }

  function renderItems() {
    const grid = $("#itemsGrid");
    if (!grid) return;

    const list = filteredItems();
    if (list.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;opacity:.65;padding:18px 8px;">尚無單品，點右下角 + 開始加入。</div>`;
      return;
    }

    grid.innerHTML = list.map((it) => {
      const title = escapeHtml(it.title || "未命名單品");
      const meta = [
        it.color ? `色：${escapeHtml(it.color)}` : "",
        it.material ? `材：${escapeHtml(it.material)}` : "",
      ].filter(Boolean).join(" · ");

      const temp = `${it.tempMin ?? ""}–${it.tempMax ?? ""}°C`;
      return `
        <div data-card="${it.id}" style="border:1px solid rgba(0,0,0,.08);border-radius:16px;overflow:hidden;background:#fff;">
          <div style="aspect-ratio:4/3;background:#f3f3f3;display:flex;align-items:center;justify-content:center;">
            ${it.imageDataUrl
              ? `<img src="${it.imageDataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" />`
              : `<div style="opacity:.5">無照片</div>`
            }
          </div>
          <div style="padding:10px 12px;">
            <div style="font-weight:800;">${title}</div>
            <div style="opacity:.75;font-size:12px;margin-top:4px;">${escapeHtml(meta || `${categoryLabel(it.category)} · ${temp}`)}</div>
            <div style="opacity:.65;font-size:12px;margin-top:4px;">${escapeHtml(categoryLabel(it.category))} · ${escapeHtml(temp)}</div>
          </div>
        </div>
      `;
    }).join("");

    $$("[data-card]", grid).forEach((card) => {
      card.addEventListener("click", () => {
        const id = card.dataset.card;
        const it = state.items.find((x) => x.id === id);
        if (it) openEditor(it);
      });
    });
  }

  // ====== Bottom Sheet (Add Menu) ======
  function makeBottomSheet({ title, items }) {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9998;display:flex;align-items:flex-end;justify-content:center;";

    const panel = document.createElement("div");
    panel.style.cssText =
      "width:min(520px,100%);background:#fff;border-radius:20px 20px 0 0;padding:14px 14px 24px;box-shadow:0 -10px 30px rgba(0,0,0,.2);";
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-weight:900;font-size:18px;">${escapeHtml(title)}</div>
        <button data-close style="width:38px;height:38px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:#fff;">✕</button>
      </div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px;">
        ${items.map((x) => `
          <button data-item="${x.key}" style="text-align:left;padding:14px 14px;border-radius:14px;border:1px solid rgba(0,0,0,.08);background:#fff;">
            ${escapeHtml(x.label)}
          </button>`).join("")}
      </div>
    `;
    overlay.appendChild(panel);

    const api = {
      open() { document.body.appendChild(overlay); },
      close() { overlay.remove(); },
      onSelect(fn) { api._select = fn; },
      _select: null,
    };

    overlay.addEventListener("click", (e) => { if (e.target === overlay) api.close(); });
    $("[data-close]", panel).addEventListener("click", api.close);
    $$("[data-item]", panel).forEach((btn) => {
      btn.addEventListener("click", () => api._select && api._select(btn.dataset.item));
    });

    return api;
  }

  function openAddMenu() {
    const sheet = makeBottomSheet({
      title: "新增單品",
      items: [
        { key: "gallery", label: "照片圖庫" },
        { key: "camera", label: "拍照" },
        { key: "quick", label: "快速加入（無照片）" },
        { key: "settings", label: "AI / 端點設定" },
      ],
    });

    sheet.onSelect(async (key) => {
      sheet.close();
      if (key === "gallery") return pickImage({ capture: false });
      if (key === "camera") return pickImage({ capture: true });
      if (key === "quick") return quickAdd();
      if (key === "settings") return openSettings();
    });

    sheet.open();
  }

  // ====== Image helper ======
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.crossOrigin = "anonymous";
      img.src = src;
    });
  }
  async function compressImageDataUrl(dataUrl, { maxSide = 1024, quality = 0.85 }) {
    const img = await loadImage(dataUrl);
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
    return canvas.toDataURL("image/jpeg", clamp(quality, 0.5, 0.92));
  }

  function pickImage({ capture }) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      if (capture) input.setAttribute("capture", "environment");

      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return resolve();

        const dataUrl = await fileToDataUrl(file);
        const compressed = await compressImageDataUrl(dataUrl, { maxSide: 1024, quality: 0.85 });

        const it = normalizeItem({
          id: uid(),
          category: state.activeCategory === "all" ? "tops" : state.activeCategory,
          title: "",
          desc: "",
          imageDataUrl: compressed,
        });

        state.items.unshift(it);
        saveItems();
        renderItems();
        openEditor(it, { autoAI: true });

        resolve();
      };

      input.click();
    });
  }

  function quickAdd() {
    const it = normalizeItem({
      id: uid(),
      category: state.activeCategory === "all" ? "tops" : state.activeCategory,
      title: "新單品",
      desc: "",
      imageDataUrl: "",
    });
    state.items.unshift(it);
    saveItems();
    renderItems();
    openEditor(it, { autoAI: false });
  }

  // ====== Editor ======
  function openEditor(item, { autoAI = false } = {}) {
    const it = item;
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px;";

    const modal = document.createElement("div");
    modal.style.cssText =
      "width:min(580px,100%);background:#fff;border-radius:22px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);max-height:90vh;overflow:auto;";

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-weight:900;font-size:18px;">編輯單品</div>
        <button data-close style="width:38px;height:38px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:#fff;">✕</button>
      </div>

      <div style="margin-top:12px;display:grid;gap:12px;">
        <div style="display:grid;grid-template-columns:110px 1fr;gap:12px;align-items:center;">
          <div style="width:110px;height:110px;border-radius:16px;overflow:hidden;background:#f3f3f3;display:flex;align-items:center;justify-content:center;">
            ${it.imageDataUrl ? `<img data-preview src="${it.imageDataUrl}" style="width:100%;height:100%;object-fit:cover;" />` : `<div style="opacity:.6;font-size:12px;">無照片</div>`}
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <button data-change-photo style="padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.1);background:#fff;">更換照片</button>
            <button data-ai-fill style="padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.1);background:#fff;">
              ✨ AI 一鍵填完整（顏色/材質/版型/長度/場合/季節）
            </button>
            <div data-ai-hint style="font-size:12px;opacity:.7;line-height:1.4;"></div>
          </div>
        </div>

        <div>
          <div style="font-weight:800;margin-bottom:6px;">名稱 / 描述</div>
          <input data-title value="${escapeHtml(it.title || "")}" placeholder="例如：軍綠短袖 / 丹寧襯衫"
            style="width:100%;padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.12);" />
          <textarea data-desc placeholder="可輸入材質、品牌、版型、場合等"
            style="width:100%;margin-top:10px;padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.12);min-height:74px;resize:vertical;">${escapeHtml(it.desc || "")}</textarea>
        </div>

        <div>
          <div style="font-weight:800;margin-bottom:6px;">顏色 / 材質</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <input data-color value="${escapeHtml(it.color || "")}" placeholder="顏色（軍綠/深藍/米白…）"
              style="width:100%;padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.12);" />
            <input data-material value="${escapeHtml(it.material || "")}" placeholder="材質（棉/丹寧/羊毛…）"
              style="width:100%;padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.12);" />
          </div>
        </div>

        <div>
          <div style="font-weight:800;margin-bottom:6px;">適穿溫度（°C）</div>
          <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;">
            <input data-tmin type="number" value="${escapeHtml(it.tempMin)}"
              style="width:100%;padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.12);text-align:center;" />
            <div style="opacity:.65;">–</div>
            <input data-tmax type="number" value="${escapeHtml(it.tempMax)}"
              style="width:100%;padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.12);text-align:center;" />
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <div style="font-weight:800;margin-bottom:6px;">版型（FIT）</div>
            <select data-fit style="width:100%;padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.12);">
              ${FITS.map((x) => `<option value="${x}" ${x === it.fit ? "selected" : ""}>${x}</option>`).join("")}
            </select>
          </div>
          <div>
            <div style="font-weight:800;margin-bottom:6px;">長度（LENGTH）</div>
            <select data-length style="width:100%;padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.12);">
              ${LENGTHS.map((x) => `<option value="${x}" ${x === it.length ? "selected" : ""}>${x}</option>`).join("")}
            </select>
          </div>
        </div>

        <div>
          <div style="font-weight:800;margin-bottom:6px;">分類</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
            ${CATEGORIES.filter((c) => c.key !== "all").map((c) => {
              const active = c.key === it.category;
              return `<button data-cat-pick="${c.key}" style="padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.12);background:${active ? "rgba(0,0,0,.06)" : "#fff"};">${c.label}</button>`;
            }).join("")}
          </div>
        </div>

        <div>
          <div style="font-weight:800;margin-bottom:6px;">場合</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${OCCASIONS.map((o) => {
              const on = (it.occasions || []).includes(o.key);
              return `<button data-occ="${o.key}" style="padding:10px 12px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:${on ? "rgba(0,0,0,.06)" : "#fff"};">${o.label}</button>`;
            }).join("")}
          </div>
        </div>

        <div>
          <div style="font-weight:800;margin-bottom:6px;">季節</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${SEASONS.map((s) => {
              const on = (it.seasons || []).includes(s.key);
              return `<button data-season="${s.key}" style="padding:10px 12px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:${on ? "rgba(0,0,0,.06)" : "#fff"};">${s.label}</button>`;
            }).join("")}
          </div>
        </div>

        <div style="display:grid;gap:10px;margin-top:6px;">
          <button data-save style="padding:14px;border-radius:16px;background:rgba(140,80,255,.9);color:#fff;font-weight:900;border:0;">
            儲存修改
          </button>
          <button data-delete style="padding:14px;border-radius:16px;background:rgba(255,80,80,.12);color:#b00020;font-weight:900;border:0;">
            刪除此單品
          </button>
          <button data-cancel style="padding:14px;border-radius:16px;border:1px solid rgba(0,0,0,.12);background:#fff;">
            取消
          </button>
        </div>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    modal.addEventListener("click", (e) => e.stopPropagation());
    overlay.addEventListener("click", close);
    $("[data-close]", modal).addEventListener("click", close);
    $("[data-cancel]", modal).addEventListener("click", close);

    // Category
    $$("[data-cat-pick]", modal).forEach((btn) => {
      btn.addEventListener("click", () => {
        it.category = btn.dataset.catPick;
        $$("[data-cat-pick]", modal).forEach((b) => {
          b.style.background = b.dataset.catPick === it.category ? "rgba(0,0,0,.06)" : "#fff";
        });
      });
    });

    // Occasions
    $$("[data-occ]", modal).forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.occ;
        it.occasions = it.occasions || [];
        const idx = it.occasions.indexOf(k);
        if (idx >= 0) it.occasions.splice(idx, 1);
        else it.occasions.push(k);
        btn.style.background = it.occasions.includes(k) ? "rgba(0,0,0,.06)" : "#fff";
      });
    });

    // Seasons
    $$("[data-season]", modal).forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.season;
        it.seasons = it.seasons || [];
        const idx = it.seasons.indexOf(k);
        if (idx >= 0) it.seasons.splice(idx, 1);
        else it.seasons.push(k);
        btn.style.background = it.seasons.includes(k) ? "rgba(0,0,0,.06)" : "#fff";
      });
    });

    // Change photo
    $("[data-change-photo]", modal).addEventListener("click", async () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const dataUrl = await fileToDataUrl(file);
        it.imageDataUrl = await compressImageDataUrl(dataUrl, { maxSide: 1024, quality: 0.85 });
        it.updatedAt = nowISO();
        const preview = $("[data-preview]", modal);
        if (preview) preview.src = it.imageDataUrl;
        const idx = state.items.findIndex((x) => x.id === it.id);
        if (idx >= 0) state.items[idx] = it;
        saveItems();
        renderItems();
      };
      input.click();
    });

    // AI fill
    const aiBtn = $("[data-ai-fill]", modal);
    const aiHint = $("[data-ai-hint]", modal);
    aiBtn.addEventListener("click", async () => runAIFill(it, modal, { aiBtn, aiHint }));

    // Save
    $("[data-save]", modal).addEventListener("click", () => {
      it.title = $("[data-title]", modal).value.trim();
      it.desc = $("[data-desc]", modal).value.trim();
      it.color = $("[data-color]", modal).value.trim();
      it.material = $("[data-material]", modal).value.trim();

      const tmin = parseInt($("[data-tmin]", modal).value, 10);
      const tmax = parseInt($("[data-tmax]", modal).value, 10);
      it.tempMin = Number.isFinite(tmin) ? tmin : it.tempMin;
      it.tempMax = Number.isFinite(tmax) ? tmax : it.tempMax;

      const fit = $("[data-fit]", modal).value;
      const len = $("[data-length]", modal).value;
      it.fit = FITS.includes(fit) ? fit : it.fit;
      it.length = LENGTHS.includes(len) ? len : it.length;

      it.updatedAt = nowISO();
      const idx = state.items.findIndex((x) => x.id === it.id);
      if (idx >= 0) state.items[idx] = it;
      saveItems();
      renderItems();
      close();
    });

    // Delete
    $("[data-delete]", modal).addEventListener("click", () => {
      if (!confirm("確定刪除此單品？")) return;
      state.items = state.items.filter((x) => x.id !== it.id);
      saveItems();
      renderItems();
      // 若此 item 正在 mix slot，清掉
      for (const k of Object.keys(state.mix.slots)) {
        if (state.mix.slots[k] === it.id) state.mix.slots[k] = null;
      }
      saveMix();
      renderSlots();
      close();
    });

    if (autoAI && it.imageDataUrl) runAIFill(it, modal, { aiBtn, aiHint }).catch(() => {});
  }

  async function runAIFill(it, modal, { aiBtn, aiHint }) {
    if (!it.imageDataUrl) {
      aiHint.textContent = "沒有照片，無法用 AI 判斷。";
      return;
    }

    const endpoint = String(state.aiEndpoint || DEFAULT_AI_ENDPOINT).replace(/\/+$/, "");
    aiBtn.disabled = true;
    aiBtn.style.opacity = "0.6";
    aiHint.textContent = "AI 分析中（顏色/材質/版型/長度/場合/季節）…";

    try {
      const res = await fetch(`${endpoint}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: it.imageDataUrl,
          locale: "zh-TW",
          hint_text: `${it.title || ""}\n${it.desc || ""}`.trim(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();

      if (data.color_primary) it.color = String(data.color_primary);
      if (data.material) it.material = String(data.material);
      if (data.fit && FITS.includes(data.fit)) it.fit = data.fit;
      if (data.length && LENGTHS.includes(data.length)) it.length = data.length;
      if (Array.isArray(data.occasions)) it.occasions = data.occasions.filter((x) => OCCASIONS.some((o) => o.key === x));
      if (Array.isArray(data.seasons)) it.seasons = data.seasons.filter((x) => SEASONS.some((s) => s.key === x));
      if (data.notes && !it.desc) it.desc = String(data.notes);

      // reflect to UI
      const colorEl = $("[data-color]", modal);
      const materialEl = $("[data-material]", modal);
      const fitEl = $("[data-fit]", modal);
      const lengthEl = $("[data-length]", modal);
      const descEl = $("[data-desc]", modal);

      if (colorEl) colorEl.value = it.color || "";
      if (materialEl) materialEl.value = it.material || "";
      if (fitEl) fitEl.value = it.fit || "Regular";
      if (lengthEl) lengthEl.value = it.length || "Regular";
      if (descEl) descEl.value = it.desc || "";

      $$("[data-occ]", modal).forEach((btn) => {
        btn.style.background = (it.occasions || []).includes(btn.dataset.occ) ? "rgba(0,0,0,.06)" : "#fff";
      });
      $$("[data-season]", modal).forEach((btn) => {
        btn.style.background = (it.seasons || []).includes(btn.dataset.season) ? "rgba(0,0,0,.06)" : "#fff";
      });

      it.updatedAt = nowISO();
      const idx = state.items.findIndex((x) => x.id === it.id);
      if (idx >= 0) state.items[idx] = it;
      saveItems();
      renderItems();

      const conf = data.confidence != null ? `（信心：${Math.round(Number(data.confidence) * 100)}%）` : "";
      aiHint.textContent = `完成：${it.color ? `顏色「${it.color}」` : ""}${it.material ? `、材質「${it.material}」` : ""}${conf}`;
    } catch (e) {
      aiHint.textContent = `AI 分析失敗：${e && e.message ? e.message : "未知錯誤"}`;
    } finally {
      aiBtn.disabled = false;
      aiBtn.style.opacity = "1";
    }
  }

  // ====== Settings ======
  function openSettings() {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px;";

    const modal = document.createElement("div");
    modal.style.cssText =
      "width:min(520px,100%);background:#fff;border-radius:22px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);";

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-weight:900;font-size:18px;">設定</div>
        <button data-close style="width:38px;height:38px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:#fff;">✕</button>
      </div>

      <div style="margin-top:12px;display:grid;gap:10px;">
        <div style="font-weight:800;">Cloudflare Worker Endpoint</div>
        <input data-endpoint value="${escapeHtml(state.aiEndpoint || DEFAULT_AI_ENDPOINT)}"
          placeholder="例如：https://xxxxx.yyyyy.workers.dev"
          style="width:100%;padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.12);" />
        <div style="font-size:12px;opacity:.75;line-height:1.5;">
          提示：ALLOW_ORIGINS 要填 origin，不含路徑，例如：<br/>
          <code>https://f0620123-png.github.io</code>
        </div>

        <button data-save style="margin-top:6px;padding:14px;border-radius:16px;background:rgba(140,80,255,.9);color:#fff;font-weight:900;border:0;">
          儲存
        </button>

        <button data-hard-refresh style="padding:14px;border-radius:16px;border:1px solid rgba(0,0,0,.12);background:#fff;">
          強制清除快取並重整（解決舊版卡住）
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    modal.addEventListener("click", (e) => e.stopPropagation());
    overlay.addEventListener("click", close);
    $("[data-close]", modal).addEventListener("click", close);

    $("[data-save]", modal).addEventListener("click", () => {
      const v = $("[data-endpoint]", modal).value.trim();
      state.aiEndpoint = v || DEFAULT_AI_ENDPOINT;
      savePrefs();
      close();
      alert("已儲存。");
    });

    $("[data-hard-refresh]", modal).addEventListener("click", async () => hardRefresh());
  }

  async function hardRefresh() {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {}
    location.reload();
  }

  // ====== Mix & Match UI ======
  function renderOccasionBar() {
    const bar = $("#occasionBar");
    if (!bar) return;
    bar.innerHTML = OCCASIONS.map((o) => {
      const on = o.key === state.mix.occasion;
      return `<button data-occsel="${o.key}" style="padding:10px 12px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:${on ? "rgba(0,0,0,.06)" : "#fff"};">${o.label}</button>`;
    }).join("");
    $$("[data-occsel]", bar).forEach((btn) => {
      btn.addEventListener("click", () => {
        state.mix.occasion = btn.dataset.occsel;
        saveMix();
        renderOccasionBar();
      });
    });
  }

  function renderStyleBar() {
    const bar = $("#styleBar");
    if (!bar) return;
    bar.innerHTML = STYLES.map((s) => {
      const on = s.key === state.mix.style;
      return `<button data-stylesel="${s.key}" style="padding:10px 12px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:${on ? "rgba(0,0,0,.06)" : "#fff"};">${s.label}</button>`;
    }).join("");
    $$("[data-stylesel]", bar).forEach((btn) => {
      btn.addEventListener("click", () => {
        state.mix.style = btn.dataset.stylesel;
        saveMix();
        renderStyleBar();
      });
    });
  }

  function weatherTextFromState() {
    if (!state.mix.weather) return "尚未取得（按右上「抓取位置」）";
    const w = state.mix.weather;
    const city = w.city ? `${w.city} · ` : "";
    const t = (w.temp != null) ? `${Number(w.temp).toFixed(1)}°C` : "—";
    const f = (w.feelsLike != null) ? `${Number(w.feelsLike).toFixed(1)}°C` : "—";
    return `${city}溫度 ${t}，體感 ${f}`;
  }

  function renderWeatherCard() {
    const el = $("#weatherText");
    if (el) el.textContent = weatherTextFromState();
  }

  function renderSlots() {
    const grid = $("#slotGrid");
    if (!grid) return;

    const slotDefs = [
      { key: "inner", label: "內搭", icon: "◻︎" },
      { key: "tops", label: "上衣", icon: "👕" },
      { key: "bottoms", label: "下著", icon: "▭" },
      { key: "outer", label: "外套", icon: "🧥" },
      { key: "shoes", label: "鞋子", icon: "👟" },
      { key: "accessory", label: "配件", icon: "✨" },
    ];

    grid.innerHTML = slotDefs.map((s) => {
      const id = state.mix.slots[s.key];
      const it = id ? state.items.find((x) => x.id === id) : null;
      const has = !!it;
      const title = has ? escapeHtml(it.title || categoryLabel(it.category)) : "不選擇此項";
      const img = has && it.imageDataUrl
        ? `<img src="${it.imageDataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" />`
        : `<div style="opacity:.35;font-size:36px;">${s.icon}</div>`;

      return `
        <div data-slot="${s.key}" style="border:1px dashed rgba(0,0,0,.18);border-radius:18px;overflow:hidden;background:#fff;cursor:pointer;">
          <div style="aspect-ratio: 4/3; background:#f7f7f7; display:flex;align-items:center;justify-content:center;">
            ${img}
          </div>
          <div style="padding:10px 12px;">
            <div style="font-weight:900;">${escapeHtml(s.label)}</div>
            <div style="opacity:.75;font-size:12px;margin-top:4px;">${title}</div>
          </div>
        </div>
      `;
    }).join("");

    $$("[data-slot]", grid).forEach((card) => {
      card.addEventListener("click", () => {
        const slotKey = card.dataset.slot;
        openSlotPicker(slotKey);
      });
    });
  }

  function openSlotPicker(slotKey) {
    const label = categoryLabel(slotKey);
    const list = slotKey === "accessory"
      ? state.items.filter((x) => x.category === "accessory").sort(sortByUpdatedDesc)
      : state.items.filter((x) => x.category === slotKey).sort(sortByUpdatedDesc);

    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;";

    const modal = document.createElement("div");
    modal.style.cssText =
      "width:min(720px,100%);background:#fff;border-radius:22px;padding:14px;box-shadow:0 20px 60px rgba(0,0,0,.25);max-height:90vh;overflow:auto;";

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-weight:900;font-size:18px;">選擇 ${escapeHtml(label)}</div>
        <button data-close style="width:38px;height:38px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:#fff;">✕</button>
      </div>

      <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;">
        <button data-pick="none" style="padding:10px 12px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:#fff;">不選擇此項</button>
        <button data-pick="edit" style="padding:10px 12px;border-radius:999px;border:1px solid rgba(0,0,0,.12);background:#fff;">到衣櫃新增/編輯</button>
      </div>

      <div style="margin-top:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
        ${list.map((it) => `
          <div data-pickid="${it.id}" style="border:1px solid rgba(0,0,0,.08);border-radius:16px;overflow:hidden;background:#fff;cursor:pointer;">
            <div style="aspect-ratio:4/3;background:#f3f3f3;display:flex;align-items:center;justify-content:center;">
              ${it.imageDataUrl ? `<img src="${it.imageDataUrl}" style="width:100%;height:100%;object-fit:cover;" />` : `<div style="opacity:.5">無照片</div>`}
            </div>
            <div style="padding:10px 12px;">
              <div style="font-weight:800;">${escapeHtml(it.title || "未命名")}</div>
              <div style="opacity:.7;font-size:12px;margin-top:4px;">${escapeHtml(it.color || "")}${it.material ? ` · ${escapeHtml(it.material)}` : ""}</div>
            </div>
          </div>
        `).join("")}
      </div>
      ${list.length === 0 ? `<div style="opacity:.7;margin-top:12px;">這個分類還沒有單品，請先到衣櫃新增。</div>` : ""}
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    modal.addEventListener("click", (e) => e.stopPropagation());
    overlay.addEventListener("click", close);
    $("[data-close]", modal).addEventListener("click", close);

    $$("[data-pickid]", modal).forEach((card) => {
      card.addEventListener("click", () => {
        state.mix.slots[slotKey] = card.dataset.pickid;
        saveMix();
        renderSlots();
        close();
      });
    });

    $("[data-pick='none']", modal).addEventListener("click", () => {
      state.mix.slots[slotKey] = null;
      saveMix();
      renderSlots();
      close();
    });

    $("[data-pick='edit']", modal).addEventListener("click", () => {
      // 切回衣櫃
      state.tab = "wardrobe";
      savePrefs();
      renderTabs();
      close();
    });
  }

  function clearSlots() {
    state.mix.slots = { inner: null, tops: null, bottoms: null, outer: null, shoes: null, accessory: null };
    state.mix.compositeDataUrl = "";
    saveMix();
    renderSlots();
    renderComposeResult();
  }

  // ====== Compose (Canvas 拼貼示意圖) ======
  async function composeOutfitPreview() {
    // 版面：1080x1440（手機直式）
    const W = 1080, H = 1440;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    // 背景
    ctx.fillStyle = "#FBF7F0";
    ctx.fillRect(0, 0, W, H);

    // Header
    ctx.fillStyle = "rgba(0,0,0,.78)";
    ctx.font = "900 44px system-ui, -apple-system";
    ctx.fillText("MIX & MATCH", 60, 90);
    ctx.font = "800 60px system-ui, -apple-system";
    ctx.fillText("自選穿搭", 60, 165);

    // Weather line
    const w = state.mix.weather;
    ctx.font = "700 32px system-ui, -apple-system";
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.fillText(w ? `體感 ${Number(w.feelsLike).toFixed(1)}°C · 溫度 ${Number(w.temp).toFixed(1)}°C` : "未取得天氣", 60, 220);

    // slots layout (2x3)
    const cards = [
      { key: "inner", label: "內搭" },
      { key: "tops", label: "上衣" },
      { key: "bottoms", label: "下著" },
      { key: "outer", label: "外套" },
      { key: "shoes", label: "鞋子" },
      { key: "accessory", label: "配件" },
    ];

    const startX = 60, startY = 280;
    const gap = 40;
    const cardW = (W - startX * 2 - gap) / 2; // two columns
    const cardH = 260;

    for (let i = 0; i < cards.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = startX + col * (cardW + gap);
      const y = startY + row * (cardH + gap);

      // card background
      roundRect(ctx, x, y, cardW, cardH, 28);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.12)";
      ctx.lineWidth = 3;
      ctx.stroke();

      // dashed inner frame
      ctx.save();
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = "rgba(0,0,0,.18)";
      ctx.lineWidth = 3;
      roundRect(ctx, x + 22, y + 22, cardW - 44, cardH - 90, 24);
      ctx.stroke();
      ctx.restore();

      // label
      ctx.fillStyle = "rgba(0,0,0,.72)";
      ctx.font = "900 34px system-ui, -apple-system";
      ctx.fillText(cards[i].label, x + 28, y + cardH - 28);

      // image
      const id = state.mix.slots[cards[i].key];
      const it = id ? state.items.find((t) => t.id === id) : null;

      if (it && it.imageDataUrl) {
        try {
          const img = await loadImage(it.imageDataUrl);
          const ix = x + 28;
          const iy = y + 28;
          const iw = cardW - 56;
          const ih = cardH - 120;

          // cover crop
          const { sx, sy, sw, sh } = coverCrop(img, iw, ih);
          // clip rounded
          ctx.save();
          roundRect(ctx, ix, iy, iw, ih, 22);
          ctx.clip();
          ctx.drawImage(img, sx, sy, sw, sh, ix, iy, iw, ih);
          ctx.restore();

          // title
          ctx.fillStyle = "rgba(0,0,0,.55)";
          ctx.font = "700 26px system-ui, -apple-system";
          ctx.fillText(truncate(it.title || "", 16), ix, y + cardH - 74);
        } catch {
          // ignore
        }
      } else {
        ctx.fillStyle = "rgba(0,0,0,.25)";
        ctx.font = "800 28px system-ui, -apple-system";
        ctx.fillText("不選擇", x + 40, y + 120);
      }
    }

    // Footer
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.font = "700 26px system-ui, -apple-system";
    const occ = (OCCASIONS.find((o) => o.key === state.mix.occasion) || {}).label || state.mix.occasion;
    const sty = (STYLES.find((s) => s.key === state.mix.style) || {}).label || state.mix.style;
    ctx.fillText(`場合：${occ}   風格：${sty}`, 60, H - 70);

    const dataUrl = canvas.toDataURL("image/png");
    state.mix.compositeDataUrl = dataUrl;
    saveMix();
    renderComposeResult();
  }

  function truncate(s, n) {
    s = String(s || "");
    return s.length <= n ? s : s.slice(0, n - 1) + "…";
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

  function coverCrop(img, targetW, targetH) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const ir = iw / ih;
    const tr = targetW / targetH;

    if (ir > tr) {
      // image wider
      const sh = ih;
      const sw = Math.round(ih * tr);
      const sx = Math.round((iw - sw) / 2);
      return { sx, sy: 0, sw, sh };
    } else {
      // image taller
      const sw = iw;
      const sh = Math.round(iw / tr);
      const sy = Math.round((ih - sh) / 2);
      return { sx: 0, sy, sw, sh };
    }
  }

  function renderComposeResult() {
    const box = $("#composeResult");
    const img = $("#composeImg");
    if (!box || !img) return;

    if (state.mix.compositeDataUrl) {
      img.src = state.mix.compositeDataUrl;
      box.style.display = "";
    } else {
      box.style.display = "none";
    }
  }

  // ====== Weather (Geolocation → Worker /weather) ======
  async function fetchWeatherByGeolocation() {
    if (!navigator.geolocation) {
      alert("此裝置不支援定位。");
      return;
    }

    const btn = $("#btnWeather");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.6";
      btn.textContent = "取得中…";
    }

    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 60_000,
        });
      });

      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      const endpoint = String(state.aiEndpoint || DEFAULT_AI_ENDPOINT).replace(/\/+$/, "");
      const res = await fetch(`${endpoint}/weather`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lon }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      state.mix.weather = {
        temp: data.temp,
        feelsLike: data.feelsLike,
        code: data.weatherCode,
        city: data.city || "",
        lat, lon,
      };
      saveMix();
      renderWeatherCard();
    } catch (e) {
      alert(`取得天氣失敗：${e && e.message ? e.message : "未知錯誤"}\n\n若你拒絕定位，請到 Safari/瀏覽器設定開啟定位權限。`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.textContent = "抓取位置";
      }
    }
  }

  // ====== Recommend Outfit (Worker /recommend) ======
  function pickCandidateItems(feelsLike) {
    // 控制 token/成本：只送「可能適合」的單品（最多 60）
    const list = [...state.items].sort(sortByUpdatedDesc);
    if (!Number.isFinite(feelsLike)) return list.slice(0, 60);

    const within = [];
    const near = [];
    const far = [];

    for (const it of list) {
      const min = Number(it.tempMin);
      const max = Number(it.tempMax);
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        far.push(it);
        continue;
      }
      if (feelsLike >= min && feelsLike <= max) within.push(it);
      else if (feelsLike >= min - 3 && feelsLike <= max + 3) near.push(it);
      else far.push(it);
    }

    const merged = [...within, ...near, ...far];
    return merged.slice(0, 60);
  }

  async function recommendOutfit() {
    if (!state.mix.weather) {
      alert("請先抓取位置取得體感溫度。");
      return;
    }
    if (state.items.length === 0) {
      alert("你的衣櫃目前沒有單品，請先新增。");
      return;
    }

    const btn = $("#btnRecommend");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.6";
      btn.textContent = "推薦中…";
    }

    try {
      const feels = Number(state.mix.weather.feelsLike);
      const candidates = pickCandidateItems(feels).map((it) => ({
        id: it.id,
        category: it.category,
        title: it.title || "",
        desc: it.desc || "",
        color: it.color || "",
        material: it.material || "",
        fit: it.fit || "Regular",
        length: it.length || "Regular",
        tempMin: it.tempMin,
        tempMax: it.tempMax,
      }));

      const endpoint = String(state.aiEndpoint || DEFAULT_AI_ENDPOINT).replace(/\/+$/, "");
      const res = await fetch(`${endpoint}/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale: "zh-TW",
          weather: {
            temp: state.mix.weather.temp,
            feelsLike: state.mix.weather.feelsLike,
            weatherCode: state.mix.weather.code,
          },
          occasion: state.mix.occasion,
          style: state.mix.style,
          items: candidates,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${t ? `：${t}` : ""}`);
      }
      const data = await res.json();

      // data.items: {inner,tops,bottoms,outer,shoes,accessory} → id 或 null
      const pick = (k) => (data.items && typeof data.items[k] === "string" ? data.items[k] : null);

      // 套用（只接受存在於衣櫃的 id）
      const exists = (id) => id && state.items.some((x) => x.id === id);

      const newSlots = { ...state.mix.slots };
      for (const k of ["inner","tops","bottoms","outer","shoes","accessory"]) {
        const id = pick(k);
        newSlots[k] = exists(id) ? id : null;
      }
      state.mix.slots = newSlots;
      saveMix();
      renderSlots();

      // 推薦後自動生成示意圖
      await composeOutfitPreview();

      if (data.notes) {
        // 不用 alert 轟炸，顯示在 weather text 下方也可；這裡用 alert 先簡單
        console.log("AI Notes:", data.notes);
      }
    } catch (e) {
      alert(`推薦失敗：${e && e.message ? e.message : "未知錯誤"}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.textContent = "✨ 推薦穿搭";
      }
    }
  }

  // ====== Service Worker Register ======
  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      reg.update().catch(() => {});
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            try { reg.waiting && reg.waiting.postMessage({ type: "SKIP_WAITING" }); } catch {}
            setTimeout(() => location.reload(), 250);
          }
        });
      });
    } catch {}
  }

  // ====== Bind Events ======
  function bindEvents() {
    const fab = $("#fabAdd");
    if (fab) fab.addEventListener("click", openAddMenu);

    const settingsBtn = $("#openSettingsBtn");
    if (settingsBtn) settingsBtn.addEventListener("click", openSettings);

    const tabW = $("#tabWardrobe");
    const tabM = $("#tabMix");
    if (tabW) tabW.addEventListener("click", () => { state.tab = "wardrobe"; savePrefs(); renderTabs(); });
    if (tabM) tabM.addEventListener("click", () => { state.tab = "mix"; savePrefs(); renderTabs(); });

    const btnWeather = $("#btnWeather");
    if (btnWeather) btnWeather.addEventListener("click", fetchWeatherByGeolocation);

    const btnRecommend = $("#btnRecommend");
    if (btnRecommend) btnRecommend.addEventListener("click", recommendOutfit);

    const btnCompose = $("#btnCompose");
    if (btnCompose) btnCompose.addEventListener("click", composeOutfitPreview);

    const btnClear = $("#btnClearSlots");
    if (btnClear) btnClear.addEventListener("click", clearSlots);
  }

  // ====== Init ======
  function init() {
    ensureUI();
    loadPrefs();
    loadItems();
    loadMix();

    updateCounter();
    renderTabs();
    renderChips();
    renderItems();

    renderWeatherCard();
    renderOccasionBar();
    renderStyleBar();
    renderSlots();
    renderComposeResult();

    bindEvents();
    registerSW();
  }

  document.addEventListener("DOMContentLoaded", init);
})();