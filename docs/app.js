/* docs/app.js
   Wardrobe AI (GitHub Pages)
   - localStorage persistence
   - FAB '+' menu: Photo Library / Camera / Quick Add / Settings / Force Refresh
   - Card click: Edit modal (save/delete/cancel)
   - AI: analyze color/material from photo or description via your own proxy endpoint
*/

(() => {
  "use strict";

  // ====== Config ======
  const LS_KEY = "wardrobe_items_v3";
  const LS_AI_ENDPOINT = "wardrobe_ai_endpoint_v1";

  // 你的 GitHub Pages 前端不應直接打 OpenAI；請放你自己的 Proxy (Cloudflare Worker) URL
  // 你也可在 UI 內用「設定 AI 端點」來存到 localStorage
  const DEFAULT_AI_ENDPOINT = ""; // e.g. "https://YOUR-WORKER.workers.dev/analyze"

  // ====== Categories ======
  const CATS = [
    { key: "上衣", label: "上衣" },
    { key: "下著", label: "下著" },
    { key: "內搭", label: "內搭" },
    { key: "外套", label: "外套" },
    { key: "鞋子", label: "鞋子" },
    { key: "配件", label: "配件" },
    // 你截圖後來擴充的分類（不影響既有）
    { key: "連身", label: "連身" },
    { key: "背心", label: "背心" },
    { key: "褲子", label: "褲子" },
    { key: "其他", label: "其他" },
  ];

  // Quick add presets (name + cat + optional temp range)
  const QUICK_PRESETS = [
    { title: "長袖打底（白）", cat: "內搭", tmin: 10, tmax: 22 },
    { title: "長袖打底（黑）", cat: "內搭", tmin: 10, tmax: 22 },
    { title: "短袖T恤（白）", cat: "上衣", tmin: 22, tmax: 30 },
    { title: "短袖T恤（黑）", cat: "上衣", tmin: 22, tmax: 30 },
    { title: "連帽外套（灰）", cat: "外套", tmin: 12, tmax: 22 },
    { title: "牛仔外套", cat: "外套", tmin: 15, tmax: 28 },
    { title: "牛仔寬褲", cat: "下著", tmin: 15, tmax: 30 },
    { title: "直筒牛仔褲", cat: "下著", tmin: 15, tmax: 30 },
  ];

  // ====== State ======
  const state = {
    tab: "衣櫃", // bottom nav
    catFilter: "全部",
    items: [],
    menuOpen: false,
    modalOpen: false,
  };

  // ====== Helpers ======
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      if (typeof c === "string") el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    }
    return el;
  }

  function uid() {
    return "i_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      state.items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.items)) state.items = [];
    } catch {
      state.items = [];
    }
  }

  function save() {
    localStorage.setItem(LS_KEY, JSON.stringify(state.items));
  }

  function getAIEndpoint() {
    return localStorage.getItem(LS_AI_ENDPOINT) || DEFAULT_AI_ENDPOINT || "";
  }

  function setAIEndpoint(url) {
    localStorage.setItem(LS_AI_ENDPOINT, url.trim());
  }

  // Resize DataURL to reduce latency/cost
  async function downscaleDataURL(dataURL, maxW = 900, quality = 0.84) {
    if (!dataURL || !dataURL.startsWith("data:image/")) return dataURL;

    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = dataURL;
    });

    const scale = Math.min(1, maxW / img.width);
    if (scale >= 1) return dataURL;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }

  function formatTemp(tmin, tmax) {
    const a = Number.isFinite(tmin) ? tmin : "";
    const b = Number.isFinite(tmax) ? tmax : "";
    if (a === "" && b === "") return "";
    if (a !== "" && b !== "") return `${a}–${b}°C`;
    return `${a !== "" ? a : "?"}–${b !== "" ? b : "?"}°C`;
  }

  function stopScrollWhenModal(open) {
    document.documentElement.style.overflow = open ? "hidden" : "";
    document.body.style.overflow = open ? "hidden" : "";
  }

  // ====== UI Build ======
  function buildApp() {
    document.body.innerHTML = "";

    const app = h("div", { class: "app", id: "app" }, [
      buildHeader(),
      buildChips(),
      h("div", { id: "content" }, [buildWardrobeView()]),
    ]);

    const bottomNav = buildBottomNav();
    const fab = buildFab();
    document.body.appendChild(app);
    document.body.appendChild(bottomNav);
    document.body.appendChild(fab);

    renderAll();
  }

  function buildHeader() {
    return h("div", { class: "header" }, [
      h("div", { class: "brand", text: "MY WARDROBE" }),
      h("h1", { text: "我的衣櫃日記" }),
      h("div", { class: "sub", id: "subText", text: "" }),
    ]);
  }

  function buildChips() {
    const chips = h("div", { class: "chips", id: "chips" });
    const all = h("button", {
      class: "chip on",
      text: "全部",
      onclick: () => {
        state.catFilter = "全部";
        renderChips();
        renderWardrobe();
      },
    });
    chips.appendChild(all);

    for (const c of CATS) {
      chips.appendChild(
        h("button", {
          class: "chip",
          text: c.label,
          onclick: () => {
            state.catFilter = c.key;
            renderChips();
            renderWardrobe();
          },
        })
      );
    }
    return chips;
  }

  function buildWardrobeView() {
    return h("div", { id: "wardrobeView" }, [
      h("div", { class: "grid", id: "grid" }),
      h("div", { class: "empty", id: "empty", text: "尚無衣物，點右下角 + 新增" }),
    ]);
  }

  function buildBottomNav() {
    const nav = h("div", { class: "bottomNav", id: "bottomNav" });

    const tabs = ["衣櫃", "自選", "靈感", "個人"];
    for (const t of tabs) {
      nav.appendChild(
        h("button", {
          class: t === state.tab ? "on" : "",
          text: t,
          onclick: () => {
            state.tab = t;
            renderBottomNav();
            renderContentByTab();
          },
        })
      );
    }
    return nav;
  }

  function buildFab() {
    return h("button", {
      class: "fab",
      id: "fab",
      text: "+",
      onclick: () => toggleMenu(true),
    });
  }

  function buildMenu() {
    // NOTE: 用 display:none / remove 方式避免「透明層卡住不能點」問題
    const menu = h("div", { class: "menu", id: "menu" }, [
      h("button", { text: "照片圖庫", onclick: () => (toggleMenu(false), pickImage("library")) }),
      h("button", { text: "拍照", onclick: () => (toggleMenu(false), pickImage("camera")) }),
      h("button", { text: "⚡ 快速加入基礎單品", onclick: () => (toggleMenu(false), openQuickAdd()) }),
      h("button", { text: "設定 AI 端點", onclick: () => (toggleMenu(false), openAIEndpointSetting()) }),
      h("button", { class: "danger", text: "強制更新（清快取）", onclick: () => (toggleMenu(false), hardRefresh()) }),
    ]);
    return menu;
  }

  function toggleMenu(open) {
    state.menuOpen = open;

    const existing = $("#menu");
    if (open) {
      if (!existing) document.body.appendChild(buildMenu());
      // 點背景關閉（用捕捉避免卡頓）
      window.addEventListener("pointerdown", onGlobalPointerDownToCloseMenu, true);
    } else {
      if (existing) existing.remove();
      window.removeEventListener("pointerdown", onGlobalPointerDownToCloseMenu, true);
    }
  }

  function onGlobalPointerDownToCloseMenu(e) {
    const menu = $("#menu");
    const fab = $("#fab");
    if (!menu || !fab) return;
    if (menu.contains(e.target) || fab.contains(e.target)) return;
    toggleMenu(false);
  }

  function renderBottomNav() {
    const btns = $$("#bottomNav button");
    btns.forEach((b) => b.classList.toggle("on", b.textContent === state.tab));
  }

  function renderContentByTab() {
    // 目前你核心功能在「衣櫃」，其他頁先留白（不影響）
    const content = $("#content");
    content.innerHTML = "";
    if (state.tab === "衣櫃") content.appendChild(buildWardrobeView());
    else content.appendChild(h("div", { class: "empty", text: `${state.tab}（待擴充）` }));
    renderAll();
  }

  function renderChips() {
    const chips = $$("#chips .chip");
    chips.forEach((c) => c.classList.remove("on"));
    const target = chips.find((c) => c.textContent === state.catFilter) || chips.find((c) => c.textContent === "全部");
    if (target) target.classList.add("on");
  }

  function renderSubText() {
    const sub = $("#subText");
    if (!sub) return;
    // 以今日新增（createdAt=今日）計算
    const today = todayStr();
    const count = state.items.filter((x) => x.createdAt === today).length;
    sub.textContent = `今天收集了 ${count} 件寶貝`;
  }

  function renderWardrobe() {
    const grid = $("#grid");
    const empty = $("#empty");
    if (!grid || !empty) return;

    const items = state.items
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const filtered = state.catFilter === "全部" ? items : items.filter((x) => x.cat === state.catFilter);

    grid.innerHTML = "";
    if (filtered.length === 0) {
      empty.style.display = "block";
      grid.style.display = "none";
      return;
    }
    empty.style.display = "none";
    grid.style.display = "grid";

    for (const it of filtered) {
      grid.appendChild(renderCard(it));
    }
  }

  function renderCard(it) {
    const img = it.photo
      ? h("img", { src: it.photo, alt: it.title || "item" })
      : h("div", {
          style:
            "width:100%;height:150px;background:#f2f2f2;display:flex;align-items:center;justify-content:center;color:#aaa;font-weight:800;",
          text: "No Photo",
        });

    const title = h("div", { class: "cardTitle", text: it.title || "(未命名)" });

    // tag line: cat · temp · color/material
    const metaParts = [];
    if (it.cat) metaParts.push(it.cat);
    const temp = formatTemp(it.tmin, it.tmax);
    if (temp) metaParts.push(temp);
    if (it.color) metaParts.push(it.color);
    if (it.material) metaParts.push(it.material);

    const tag = h("div", { class: "tag", text: metaParts.join(" · ") || "尚未設定" });

    const card = h("button", { class: "card", onclick: () => openEdit(it.id) }, [
      img,
      title,
      tag,
    ]);

    return card;
  }

  function renderAll() {
    renderSubText();
    renderChips();
    if (state.tab === "衣櫃") renderWardrobe();
    renderBottomNav();
  }

  // ====== Add / Pick Image ======
  async function pickImage(mode) {
    // mode: 'library' | 'camera'
    const input = h("input", {
      type: "file",
      accept: "image/*",
      ...(mode === "camera" ? { capture: "environment" } : {}),
    });

    input.addEventListener("change", async () => {
      const f = input.files && input.files[0];
      if (!f) return;

      const dataURL = await fileToDataURL(f);
      const small = await downscaleDataURL(dataURL, 1200, 0.84);

      const newItem = {
        id: uid(),
        createdAt: todayStr(),
        updatedAt: Date.now(),
        title: "",
        desc: "",
        cat: "上衣",
        tmin: null,
        tmax: null,
        fit: "",
        length: "",
        color: "",
        material: "",
        photo: small,
        ai: null,
      };

      state.items.unshift(newItem);
      save();
      renderAll();
      openEdit(newItem.id);
    });

    // iOS Safari: 必須真的 append 到 DOM 才會觸發
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 0);
  }

  function fileToDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function openQuickAdd() {
    openSheet({
      title: "⚡ 快速加入基礎單品",
      body: (() => {
        const wrap = h("div", {});
        const grid = h("div", { class: "catGrid" });
        for (const p of QUICK_PRESETS) {
          grid.appendChild(
            h("button", {
              class: "catBtn",
              text: p.title,
              onclick: () => {
                const it = {
                  id: uid(),
                  createdAt: todayStr(),
                  updatedAt: Date.now(),
                  title: p.title,
                  desc: "",
                  cat: p.cat,
                  tmin: Number.isFinite(p.tmin) ? p.tmin : null,
                  tmax: Number.isFinite(p.tmax) ? p.tmax : null,
                  fit: "",
                  length: "",
                  color: "",
                  material: "",
                  photo: "",
                  ai: null,
                };
                state.items.unshift(it);
                save();
                closeSheet();
                renderAll();
              },
            })
          );
        }
        wrap.appendChild(h("div", { style: "margin-top:6px;color:#777;font-weight:800;" }, ["點一下就會直接加入"]));
        wrap.appendChild(grid);
        return wrap;
      })(),
      footerButtons: [
        { text: "關閉", kind: "icon", onClick: () => closeSheet() },
      ],
    });
  }

  function openAIEndpointSetting() {
    const current = getAIEndpoint();
    const input = h("input", {
      class: "input",
      value: current,
      placeholder: "貼上你的 Proxy URL，例如 https://xxx.workers.dev/analyze",
    });

    openSheet({
      title: "設定 AI 端點",
      body: h("div", {}, [
        h("div", { class: "label", text: "AI Proxy URL（必填）" }),
        input,
        h("div", { style: "margin-top:10px;color:#777;line-height:1.5;font-weight:700;" }, [
          "注意：GitHub Pages 不能直接放 OpenAI API Key，必須用你自己的 Proxy（例如 Cloudflare Worker）。",
        ]),
      ]),
      footerButtons: [
        {
          text: "儲存",
          kind: "primary",
          onClick: () => {
            setAIEndpoint(input.value);
            closeSheet();
            alert("已儲存 AI 端點。");
          },
        },
        { text: "取消", kind: "danger", onClick: () => closeSheet() },
      ],
    });
  }

  // ====== Modal / Sheet ======
  let sheetEl = null;

  function openSheet({ title, body, footerButtons = [] }) {
    closeSheet();

    state.modalOpen = true;
    stopScrollWhenModal(true);

    const modal = h("div", { class: "modal", id: "modal" });
    const card = h("div", { class: "modalCard" });

    const head = h("div", { class: "modalHead" }, [
      h("div", { class: "modalTitle", text: title || "" }),
      h("button", { class: "iconBtn", text: "×", onclick: () => closeSheet() }),
    ]);

    const foot = h("div", {});
    for (const b of footerButtons) {
      if (b.kind === "primary") {
        foot.appendChild(h("button", { class: "btnPrimary", text: b.text, onclick: b.onClick }));
      } else if (b.kind === "danger") {
        foot.appendChild(h("button", { class: "btnDanger", text: b.text, onclick: b.onClick }));
      } else {
        foot.appendChild(h("button", { class: "iconBtn", text: b.text, onclick: b.onClick }));
      }
    }

    card.appendChild(head);
    card.appendChild(body);
    if (footerButtons.length) card.appendChild(foot);

    modal.appendChild(card);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeSheet();
    });

    sheetEl = modal;
    document.body.appendChild(modal);
  }

  function closeSheet() {
    if (sheetEl) sheetEl.remove();
    sheetEl = null;
    state.modalOpen = false;
    stopScrollWhenModal(false);
  }

  // ====== Edit Item ======
  function openEdit(id) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;

    // fields
    const nameInput = h("input", { class: "input", value: it.title || "", placeholder: "例如：深灰色立領羽絨外套，輕巧保暖" });
    const descInput = h("input", { class: "input", value: it.desc || "", placeholder: "補充描述（可留空）" });

    const tminInput = h("input", { class: "input", type: "number", value: it.tmin ?? "", inputmode: "numeric" });
    const tmaxInput = h("input", { class: "input", type: "number", value: it.tmax ?? "", inputmode: "numeric" });

    const fitInput = h("input", { class: "input", value: it.fit || "", placeholder: "例如：Oversized / Regular / Slim" });
    const lenInput = h("input", { class: "input", value: it.length || "", placeholder: "例如：Hip-length / Crop / Long" });

    const colorInput = h("input", { class: "input", value: it.color || "", placeholder: "例如：橄欖綠 / 海軍藍 / 米白" });
    const matInput = h("input", { class: "input", value: it.material || "", placeholder: "例如：棉、牛仔、羊毛、羽絨、皮革…" });

    // category buttons
    const catGrid = h("div", { class: "catGrid" });
    const catBtns = [];
    for (const c of CATS) {
      const btn = h("button", {
        class: "catBtn" + (it.cat === c.key ? " on" : ""),
        text: c.label,
        onclick: () => {
          catBtns.forEach((b) => b.classList.remove("on"));
          btn.classList.add("on");
          it.cat = c.key;
        },
      });
      catBtns.push(btn);
      catGrid.appendChild(btn);
    }

    // AI button (only useful if photo exists OR description exists)
    const aiBtn = h("button", {
      class: "btnPrimary",
      text: it.photo ? "AI 從照片判斷顏色 / 材質" : "AI 依描述判斷顏色 / 材質",
      onclick: async () => {
        try {
          aiBtn.disabled = true;
          aiBtn.textContent = "分析中…";

          const endpoint = getAIEndpoint();
          if (!endpoint) {
            alert("尚未設定 AI 端點。請先點「設定 AI 端點」。");
            return;
          }

          const payload = {
            // 送較小的圖，減少卡頓
            image: it.photo ? await downscaleDataURL(it.photo, 900, 0.84) : "",
            text: [nameInput.value, descInput.value].filter(Boolean).join(" / "),
          };

          const r = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!r.ok) {
            const t = await r.text().catch(() => "");
            throw new Error(`AI 端點回傳錯誤：${r.status} ${t}`);
          }

          const data = await r.json();

          // data: { color, material, notes, confidence }
          if (data && typeof data === "object") {
            if (data.color) {
              it.color = String(data.color).trim();
              colorInput.value = it.color;
            }
            if (data.material) {
              it.material = String(data.material).trim();
              matInput.value = it.material;
            }
            it.ai = data;
            it.updatedAt = Date.now();
            save();
            renderAll();
          }
        } catch (err) {
          alert(err.message || String(err));
        } finally {
          aiBtn.disabled = false;
          aiBtn.textContent = it.photo ? "AI 從照片判斷顏色 / 材質" : "AI 依描述判斷顏色 / 材質";
        }
      },
    });

    const saveBtn = h("button", {
      class: "btnPrimary",
      text: "儲存修改",
      onclick: () => {
        it.title = nameInput.value.trim();
        it.desc = descInput.value.trim();

        const a = tminInput.value === "" ? null : Number(tminInput.value);
        const b = tmaxInput.value === "" ? null : Number(tmaxInput.value);
        it.tmin = Number.isFinite(a) ? a : null;
        it.tmax = Number.isFinite(b) ? b : null;

        it.fit = fitInput.value.trim();
        it.length = lenInput.value.trim();
        it.color = colorInput.value.trim();
        it.material = matInput.value.trim();

        it.updatedAt = Date.now();
        save();
        closeSheet();
        renderAll();
      },
    });

    const delBtn = h("button", {
      class: "btnDanger",
      text: "刪除此單品",
      onclick: () => {
        if (!confirm("確定刪除？")) return;
        state.items = state.items.filter((x) => x.id !== it.id);
        save();
        closeSheet();
        renderAll();
      },
    });

    const cancelBtn = h("button", {
      class: "btnDanger",
      text: "取消",
      onclick: () => closeSheet(),
    });

    const body = h("div", {}, [
      h("div", { class: "modalTitle", text: "編輯單品", style: "margin:6px 4px 10px;font-size:22px;font-weight:900;" }),

      h("div", { class: "field" }, [
        h("div", { class: "label", text: "名稱 / 描述" }),
        nameInput,
        h("div", { style: "height:10px" }),
        descInput,
      ]),

      h("div", { class: "field" }, [
        h("div", { class: "label", text: "適穿溫度範圍（°C）" }),
        h("div", { class: "row2" }, [tminInput, h("div", { class: "dash", text: "–" }), tmaxInput]),
      ]),

      h("div", { class: "field" }, [
        h("div", { class: "label", text: "版型（FIT）" }),
        fitInput,
      ]),

      h("div", { class: "field" }, [
        h("div", { class: "label", text: "長度（LENGTH）" }),
        lenInput,
      ]),

      h("div", { class: "field" }, [
        h("div", { class: "label", text: "顏色（COLOR）" }),
        colorInput,
      ]),

      h("div", { class: "field" }, [
        h("div", { class: "label", text: "材質（MATERIAL）" }),
        matInput,
      ]),

      h("div", { class: "field" }, [
        h("div", { class: "label", text: "修改分類" }),
        catGrid,
      ]),

      h("div", { style: "height:10px" }),

      // AI button
      aiBtn,

      saveBtn,
      delBtn,
      cancelBtn,
    ]);

    openSheet({ title: "", body, footerButtons: [] });
  }

  // ====== Hard refresh / cache bust ======
  async function hardRefresh() {
    // 1) 清 caches（如果存在）
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {}

    // 2) unregister SW（避免舊 SW 卡住）
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {}

    // 3) reload
    location.reload();
  }

  // ====== Service Worker registration ======
  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      // 主動 update 一次（避免 iOS 長期抓舊版）
      reg.update?.();
    } catch {
      // ignore
    }
  }

  // ====== Init ======
  function init() {
    load();
    buildApp();
    registerSW();
  }

  document.addEventListener("DOMContentLoaded", init);
})();