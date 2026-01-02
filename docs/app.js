/* docs/app.js - v7.2 */
(() => {
  "use strict";

  // ========= Config =========
  const DEFAULT_WORKER_BASE = "https://autumn-cell-d032.f0620123.workers.dev";
  const LS_WORKER_BASE = "wardrobe.worker.base.v1";

  const LS_WEATHER_KEY = "wardrobe.weather.cache.v2";
  const LS_WEATHER_TTL_MS = 10 * 60 * 1000;

  // outfit selections
  const OUTFIT_SLOTS = ["inner", "top", "bottom", "outer", "shoes", "acc"];
  const CAT_LABEL = {
    inner: "內搭",
    top: "上衣",
    bottom: "下身",
    outer: "外套",
    shoes: "鞋子",
    acc: "配件",
  };

  // ========= State =========
  const state = {
    items: [],
    filter: "all",
    editingId: null,
    editingCat: "top",
    editingImage: "", // dataURL
    outfit: {
      inner: null,
      top: null,
      bottom: null,
      outer: null,
      shoes: null,
      acc: null,
    },
    pickingSlot: null,
    inflight: null, // AbortController
  };

  // ========= DOM =========
  const $ = (sel) => document.querySelector(sel);

  function setText(sel, text) {
    const el = $(sel);
    if (el) el.textContent = text;
  }
  function setHTML(sel, html) {
    const el = $(sel);
    if (el) el.innerHTML = html;
  }

  function toast(msg, ms = 2200) {
    const el = $("#toast");
    if (!el) return alert(msg);
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), ms);
  }

  function showModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove("hidden");
    m.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function hideModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add("hidden");
    m.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  // ========= Worker base =========
  function getWorkerBase() {
    return (localStorage.getItem(LS_WORKER_BASE) || DEFAULT_WORKER_BASE).trim();
  }
  function setWorkerBase(v) {
    localStorage.setItem(LS_WORKER_BASE, v.trim());
  }

  // ========= Service Worker =========
  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;

    try {
      const reg = await navigator.serviceWorker.register("./sw.js?v=7.2");
      // 主動 update
      await reg.update().catch(() => {});
      // 若有 waiting，提示重整
      if (reg.waiting) {
        toast("偵測到新版本，建議重新整理", 2400);
      }
    } catch (e) {
      // 不阻斷
    }
  }

  async function forceCheckSWUpdate() {
    if (!("serviceWorker" in navigator)) return toast("此瀏覽器不支援 Service Worker");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return toast("尚未註冊 SW");
      await reg.update();
      toast("已檢查更新（若仍怪請加 ?update=999）", 2600);
    } catch {
      toast("檢查更新失敗（可用 ?update=999）", 2600);
    }
  }

  // ========= Weather Cache =========
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

  // ========= Geolocation =========
  function getCurrentPosition(opts = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("此裝置不支援定位"));
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60 * 1000,
        ...opts,
      });
    });
  }

  // ========= Fetch helpers =========
  async function fetchJSON(url, options = {}) {
    const res = await fetch(url, options);
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.error || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  // ========= Weather =========
  function setLoading(isLoading) {
    const btn = $("#btnLocate");
    if (btn) {
      btn.disabled = isLoading;
      btn.textContent = isLoading ? "定位中…" : "定位/更新天氣";
    }
    const sk = $("#weatherSkeleton");
    if (sk) sk.style.display = isLoading ? "block" : "none";
  }

  async function fetchWeatherByLatLon(lat, lon) {
    if (state.inflight) state.inflight.abort();
    state.inflight = new AbortController();
    const base = getWorkerBase();
    const url = `${base}/weather/now?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const json = await fetchJSON(url, {
      method: "GET",
      signal: state.inflight.signal,
      cache: "no-store",
    });
    if (json?.ok !== true) throw new Error(json?.error || "Weather API error");
    return json;
  }

  async function fetchWeatherByCity(q) {
    const base = getWorkerBase();
    const url = `${base}/weather/now?q=${encodeURIComponent(q)}`;
    const json = await fetchJSON(url, { method: "GET", cache: "no-store" });
    if (json?.ok !== true) throw new Error(json?.error || "Weather API error");
    return json;
  }

  function recommendOutfit(feelsC, precipMm, windMs) {
    const f = Number(feelsC);
    const p = Number(precipMm);
    const w = Number(windMs);
    const parts = [];
    let level = "";

    if (f <= 10) {
      level = "寒冷";
      parts.push("保暖內層（發熱衣/長袖）", "厚外套（羽絨/羊毛）", "長褲", "可加圍巾/手套");
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

  function renderWeather(w, cityLabel = "") {
    const temp = w.temperature;
    const feels = w.feels_like;
    const wind = w.wind_speed;
    const rain = w.precipitation;
    const unit = w.unit || "C";
    const provider = w.provider || "—";

    setText("#tempText", `${temp}°${unit}`);
    setText("#feelsText", `體感 ${feels}°${unit}`);
    setText("#metaText", `風 ${wind} m/s · 降雨 ${rain} mm · 來源 ${provider}`);
    setText("#cityText", cityLabel || "目前位置");

    const rec = recommendOutfit(feels, rain, wind);
    setHTML("#outfitHint", `
      <div class="hintTitle">今日體感：${rec.level}</div>
      <ul class="hintList">
        ${rec.parts.map((x) => `<li>${escapeHTML(x)}</li>`).join("")}
      </ul>
    `);
  }

  async function refreshByGPS() {
    try {
      setLoading(true);

      // 快取先顯示，不卡 UI
      const cached = readWeatherCache();
      if (cached) {
        renderWeather(cached.data, cached.city || "快取");
        toast("已顯示快取天氣，背景更新中…", 1600);
        setLoading(false);
      }

      // 先嘗試定位
      try {
        const pos = await getCurrentPosition();
        const { latitude, longitude } = pos.coords;
        const w = await fetchWeatherByLatLon(latitude, longitude);
        const payload = { data: w, city: "目前位置" };
        writeWeatherCache(payload);
        renderWeather(w, "目前位置");
        toast("天氣已更新");
        return;
      } catch (geoErr) {
        // fallback city
        const w2 = await fetchWeatherByCity("Taipei");
        const payload = { data: w2, city: "Taipei（fallback）" };
        writeWeatherCache(payload);
        renderWeather(w2, "Taipei（fallback）");
        toast("定位失敗，改用 Taipei 天氣");
        return;
      }
    } catch (e) {
      toast(`更新失敗：${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  // ========= Wardrobe CRUD =========
  function newId() {
    return `it_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function catToFilterKey(cat) {
    return cat || "top";
  }

  function setActiveChips(containerSel, matcherFn) {
    const root = $(containerSel);
    if (!root) return;
    root.querySelectorAll(".chip").forEach((b) => {
      const on = matcherFn(b);
      b.classList.toggle("active", !!on);
    });
  }

  function renderWardrobe() {
    const grid = $("#wardrobeGrid");
    if (!grid) return;

    const items = state.items.filter((it) => {
      if (state.filter === "all") return true;
      return (it.category || "") === state.filter;
    });

    setText("#wardrobeCount", `${state.items.length} 件`);

    if (!items.length) {
      grid.innerHTML = `
        <div class="card" style="grid-column: 1 / -1;">
          <div style="font-weight:900;margin-bottom:6px;">目前沒有符合的單品</div>
          <div class="muted small">按右下角「+」新增。建議一開始先加外套/上衣/下身各 3 件。</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = items.map((it) => {
      const img = it.imageDataUrl ? `<img class="itemImg" src="${it.imageDataUrl}" alt="">` : `<div class="itemImg" style="display:grid;place-items:center;color:#6b7280;font-weight:900;background:#f3f4f6;">No Image</div>`;
      const name = escapeHTML(it.name || "未命名");
      const cat = CAT_LABEL[it.category] || "未分類";
      const note = (it.note || "").trim();
      const ai = (it.aiDesc || "").trim();
      const tag2 = note ? "備註" : (ai ? "AI" : "");
      return `
        <div class="itemCard" data-open="${it.id}">
          ${img}
          <div class="itemBody">
            <div class="itemName">${name}</div>
            <div class="itemTags">
              <span class="tag">${cat}</span>
              ${tag2 ? `<span class="tag">${escapeHTML(tag2)}</span>` : ""}
            </div>
          </div>
        </div>
      `;
    }).join("");

    grid.querySelectorAll("[data-open]").forEach((el) => {
      el.addEventListener("click", async () => {
        const id = el.getAttribute("data-open");
        await openEditor(id);
      });
    });
  }

  async function loadItems() {
    state.items = await window.WardrobeDB.getAllItems().catch(() => []);
    renderWardrobe();
    renderOutfitPreviews();
  }

  function clearEditorUI() {
    state.editingId = null;
    state.editingCat = "top";
    state.editingImage = "";

    setText("#itemModalTitle", "新增單品");
    $("#itemName").value = "";
    $("#itemNote").value = "";
    $("#itemAIDesc").value = "";
    $("#itemFile").value = "";

    setEditorImage("");
    setActiveItemCat("top");
    $("#btnDeleteItem").style.display = "none";
  }

  function setEditorImage(dataUrl) {
    const img = $("#itemImg");
    const empty = $("#itemImgEmpty");
    if (!img || !empty) return;
    if (dataUrl) {
      img.src = dataUrl;
      img.style.display = "block";
      empty.style.display = "none";
    } else {
      img.removeAttribute("src");
      img.style.display = "none";
      empty.style.display = "grid";
    }
  }

  function setActiveItemCat(cat) {
    state.editingCat = cat;
    setActiveChips("#itemCats", (b) => b.getAttribute("data-cat") === cat);
  }

  async function openEditor(id = null) {
    clearEditorUI();

    if (id) {
      const it = await window.WardrobeDB.getItem(id);
      if (!it) return toast("找不到此單品");
      state.editingId = it.id;
      state.editingCat = it.category || "top";
      state.editingImage = it.imageDataUrl || "";

      setText("#itemModalTitle", "編輯單品");
      $("#itemName").value = it.name || "";
      $("#itemNote").value = it.note || "";
      $("#itemAIDesc").value = it.aiDesc || "";
      setActiveItemCat(state.editingCat);
      setEditorImage(state.editingImage);

      $("#btnDeleteItem").style.display = "inline-flex";
    }

    showModal("modalItem");
  }

  async function saveEditor() {
    const name = ($("#itemName").value || "").trim();
    const note = ($("#itemNote").value || "").trim();
    const aiDesc = ($("#itemAIDesc").value || "").trim();
    const category = state.editingCat || "top";
    const imageDataUrl = state.editingImage || "";

    if (!name && !imageDataUrl) {
      toast("請至少輸入名稱或選擇圖片");
      return;
    }

    const now = Date.now();
    const id = state.editingId || newId();

    const old = state.editingId ? await window.WardrobeDB.getItem(id) : null;

    const item = {
      id,
      name: name || (old?.name || "未命名"),
      category,
      note,
      aiDesc,
      imageDataUrl, // 重要：固定用 dataURL（避免 blob URL 失效）
      createdAt: old?.createdAt || now,
      updatedAt: now,
    };

    try {
      await window.WardrobeDB.putItem(item);
      hideModal("modalItem");
      toast("已儲存");
      await loadItems();
    } catch (e) {
      // IndexedDB quota 等情況
      toast("儲存失敗：可能圖片太大或資料庫空間不足。建議重新選圖（會自動壓縮）。");
    }
  }

  async function deleteEditor() {
    if (!state.editingId) return;
    if (!confirm("確定要刪除這個單品？")) return;
    await window.WardrobeDB.deleteItem(state.editingId).catch(() => {});
    hideModal("modalItem");
    toast("已刪除");
    await loadItems();
  }

  // ========= Image compression (根治：點進去沒圖 / DB 爆掉 / iOS 解碼卡住) =========
  async function compressImageToDataURL(file, maxEdge = 1280, quality = 0.85) {
    // iOS/Safari createImageBitmap 支援不一（但多數 ok），失敗就 fallback FileReader
    try {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, w, h);

      // 用 JPEG 大幅縮小（衣服照片適合）
      return canvas.toDataURL("image/jpeg", quality);
    } catch {
      // fallback
      const dataUrl = await fileToDataURL(file);
      // 若已是 dataURL，仍可能很大；嘗試再畫一次縮圖
      return await downscaleDataURL(dataUrl, maxEdge, quality);
    }
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  async function downscaleDataURL(dataUrl, maxEdge, quality) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        const w = Math.round(width * scale);
        const h = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // ========= AI Analyze (Worker) =========
  async function aiAnalyzeCurrentItem() {
    if (!state.editingImage) {
      toast("請先選擇圖片");
      return;
    }

    const base = getWorkerBase();
    const url = `${base}/ai/wardrobe/analyze-image`;

    const payload = {
      image_data_url: state.editingImage,
      name: ($("#itemName").value || "").trim(),
      category: state.editingCat || "top",
      lang: "zh-Hant",
    };

    try {
      toast("AI 分析中…", 1200);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json) {
        throw new Error(`AI API error (${res.status})`);
      }
      if (json.ok !== true) {
        const msg = json.error || "AI 回傳失敗";
        const body = json.body ? (typeof json.body === "string" ? json.body : JSON.stringify(json.body)) : "";
        throw new Error(body ? `${msg} / ${body}` : msg);
      }

      // 容錯解析：不同 worker 版本可能欄位不同
      const desc =
        (json.description || json.desc || json.text || json.result || "").toString().trim();

      const fields = json.fields || json.meta || null;

      if (desc) {
        $("#itemAIDesc").value = desc;
      } else if (fields) {
        $("#itemAIDesc").value = JSON.stringify(fields, null, 2);
      } else {
        $("#itemAIDesc").value = "AI 已完成分析，但未取得可用的描述欄位。";
      }

      // 也可以幫你把 note 自動填一些常用欄位（若 worker 有回）
      if (fields && typeof fields === "object") {
        const parts = [];
        if (fields.color) parts.push(`顏色：${fields.color}`);
        if (fields.material) parts.push(`材質：${fields.material}`);
        if (fields.fit) parts.push(`版型：${fields.fit}`);
        if (fields.length) parts.push(`長度：${fields.length}`);
        if (fields.occasion) parts.push(`場合：${fields.occasion}`);
        if (fields.season) parts.push(`季節：${fields.season}`);
        if (parts.length) {
          const old = ($("#itemNote").value || "").trim();
          const next = parts.join("；");
          $("#itemNote").value = old ? `${old}\n${next}` : next;
        }
      }

      toast("AI 已生成描述");
    } catch (e) {
      toast(`AI 失敗：${String(e?.message || e)}`, 3200);
    }
  }

  // ========= Outfit Composer =========
  function renderOutfitPreviews() {
    OUTFIT_SLOTS.forEach((slot) => {
      const root = $(`#pv-${slot}`);
      if (!root) return;
      const it = state.outfit[slot];
      if (!it) {
        root.innerHTML = `<div class="muted small">未選擇</div>`;
        return;
      }
      root.innerHTML = `
        ${it.imageDataUrl ? `<img src="${it.imageDataUrl}" alt="">` : ""}
        <div>
          <div class="pvText">${escapeHTML(it.name || "未命名")}</div>
          <div class="pvSub">${CAT_LABEL[it.category] || ""}</div>
        </div>
      `;
    });
  }

  async function openPicker(slot) {
    state.pickingSlot = slot;
    setText("#pickTitle", `選擇${CAT_LABEL[slot] || "單品"}`);
    setText("#pickHint", "點選一個單品即可套用");

    const list = state.items.filter((it) => (it.category || "") === slot);
    const grid = $("#pickGrid");
    if (!grid) return;

    if (!list.length) {
      grid.innerHTML = `
        <div class="card" style="grid-column: 1 / -1;">
          <div style="font-weight:900;margin-bottom:6px;">目前沒有「${CAT_LABEL[slot]}」</div>
          <div class="muted small">請先到「衣櫃」新增該分類的單品。</div>
        </div>
      `;
      showModal("modalPick");
      return;
    }

    grid.innerHTML = list.map((it) => {
      const img = it.imageDataUrl ? `<img class="itemImg" src="${it.imageDataUrl}" alt="">` : `<div class="itemImg" style="display:grid;place-items:center;color:#6b7280;font-weight:900;background:#f3f4f6;">No Image</div>`;
      return `
        <div class="itemCard" data-pickid="${it.id}">
          ${img}
          <div class="itemBody">
            <div class="itemName">${escapeHTML(it.name || "未命名")}</div>
            <div class="itemTags"><span class="tag">${CAT_LABEL[it.category] || ""}</span></div>
          </div>
        </div>
      `;
    }).join("");

    grid.querySelectorAll("[data-pickid]").forEach((el) => {
      el.addEventListener("click", async () => {
        const id = el.getAttribute("data-pickid");
        const it = state.items.find((x) => x.id === id);
        if (!it) return;
        state.outfit[slot] = it;
        renderOutfitPreviews();
        hideModal("modalPick");
        toast(`已選擇：${it.name || "單品"}`);
      });
    });

    showModal("modalPick");
  }

  function clearOutfit() {
    OUTFIT_SLOTS.forEach((s) => (state.outfit[s] = null));
    renderOutfitPreviews();
    const c = $("#composeCanvas");
    if (c) {
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      drawComposePlaceholder(ctx, c.width, c.height);
    }
    toast("已清空");
  }

  function drawComposePlaceholder(ctx, w, h) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "rgba(17,24,39,0.55)";
    ctx.font = "bold 40px system-ui";
    ctx.fillText("合成示意圖會出現在這裡", 70, 120);

    ctx.fillStyle = "rgba(17,24,39,0.35)";
    ctx.font = "24px system-ui";
    ctx.fillText("先選內搭/上衣/下身/外套/鞋子/配件", 70, 170);
    ctx.restore();
  }

  async function composeOutfit() {
    const canvas = $("#composeCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    // background
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(0, 0, W, H);

    // ensure at least one selected
    const picked = OUTFIT_SLOTS.map((s) => state.outfit[s]).filter(Boolean);
    if (!picked.length) {
      drawComposePlaceholder(ctx, W, H);
      toast("請先選擇至少一件單品");
      return;
    }

    // layout: stack blocks with image + label
    const blocks = [];
    if (state.outfit.inner) blocks.push(["內搭", state.outfit.inner]);
    if (state.outfit.top) blocks.push(["上衣", state.outfit.top]);
    if (state.outfit.bottom) blocks.push(["下身", state.outfit.bottom]);
    if (state.outfit.outer) blocks.push(["外套", state.outfit.outer]);
    if (state.outfit.shoes) blocks.push(["鞋子", state.outfit.shoes]);
    if (state.outfit.acc) blocks.push(["配件", state.outfit.acc]);

    const margin = 50;
    const gap = 24;
    const blockH = Math.floor((H - margin * 2 - gap * (blocks.length - 1)) / blocks.length);
    const imgH = Math.max(140, Math.floor(blockH * 0.72));
    const imgW = Math.floor(W - margin * 2);
    const labelH = blockH - imgH;

    // title
    ctx.fillStyle = "rgba(17,24,39,0.9)";
    ctx.font = "900 44px system-ui";
    ctx.fillText("MIX & MATCH", margin, 70);
    ctx.fillStyle = "rgba(17,24,39,0.55)";
    ctx.font = "22px system-ui";
    ctx.fillText(`Generated at ${new Date().toLocaleString()}`, margin, 105);

    let y = 140;
    for (const [label, it] of blocks) {
      // label
      ctx.fillStyle = "rgba(17,24,39,0.85)";
      ctx.font = "900 28px system-ui";
      ctx.fillText(`${label}：${it.name || "未命名"}`, margin, y + 28);

      // image box
      const boxY = y + labelH;
      // rounded rect backdrop
      roundRect(ctx, margin, boxY, imgW, imgH, 26, "rgba(17,24,39,0.06)");

      if (it.imageDataUrl) {
        const img = await loadImage(it.imageDataUrl).catch(() => null);
        if (img) {
          // fit cover
          const { sx, sy, sw, sh } = coverCrop(img.width, img.height, imgW, imgH);
          ctx.save();
          // clip to rounded rect
          clipRoundRect(ctx, margin, boxY, imgW, imgH, 26);
          ctx.drawImage(img, sx, sy, sw, sh, margin, boxY, imgW, imgH);
          ctx.restore();
        } else {
          ctx.fillStyle = "rgba(107,114,128,0.9)";
          ctx.font = "700 22px system-ui";
          ctx.fillText("Image decode failed", margin + 20, boxY + 40);
        }
      } else {
        ctx.fillStyle = "rgba(107,114,128,0.9)";
        ctx.font = "700 22px system-ui";
        ctx.fillText("No Image", margin + 20, boxY + 40);
      }

      y = boxY + imgH + gap;
    }

    toast("已合成（可長按另存）");
  }

  function roundRect(ctx, x, y, w, h, r, fillStyle) {
    ctx.save();
    ctx.beginPath();
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.restore();
  }

  function clipRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    ctx.clip();
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function coverCrop(sw, sh, tw, th) {
    const sRatio = sw / sh;
    const tRatio = tw / th;
    let cw, ch, sx, sy;
    if (sRatio > tRatio) {
      // wider: crop width
      ch = sh;
      cw = Math.round(ch * tRatio);
      sx = Math.round((sw - cw) / 2);
      sy = 0;
    } else {
      // taller: crop height
      cw = sw;
      ch = Math.round(cw / tRatio);
      sx = 0;
      sy = Math.round((sh - ch) / 2);
    }
    return { sx, sy, sw: cw, sh: ch };
  }

  // ========= Navigation =========
  function setSection(name) {
    const secWardrobe = $("#secWardrobe");
    const secOutfit = $("#secOutfit");
    const secSettings = $("#secSettings");

    secWardrobe.classList.toggle("active", name === "wardrobe");
    secOutfit.classList.toggle("active", name === "outfit");
    secSettings.classList.toggle("active", name === "settings");

    document.querySelectorAll(".navBtn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-nav") === name);
    });
  }

  // ========= Settings =========
  async function runHealthz() {
    try {
      const base = getWorkerBase();
      const json = await fetchJSON(`${base}/healthz`, { cache: "no-store" });
      setText("#healthzBox", JSON.stringify(json, null, 2));
      toast("healthz OK");
    } catch (e) {
      const body = e?.body ? JSON.stringify(e.body, null, 2) : "";
      setText("#healthzBox", `FAILED: ${e.message}\n${body}`);
      toast("healthz 失敗");
    }
  }

  function clearLocalCacheOnly() {
    try {
      localStorage.removeItem(LS_WEATHER_KEY);
      toast("已清除本機快取（衣櫃不受影響）");
    } catch {
      toast("清除失敗");
    }
  }

  function showHardReloadHint() {
    toast("若仍顯示舊版：請開啟 ?update=999，或清除 Safari 網站資料", 3200);
  }

  // ========= Bind events =========
  function bindEvents() {
    // bottom nav
    document.querySelectorAll(".navBtn").forEach((b) => {
      b.addEventListener("click", () => setSection(b.getAttribute("data-nav")));
    });

    // locate
    $("#btnLocate").addEventListener("click", refreshByGPS);

    // SW update btn
    $("#btnSWUpdate").addEventListener("click", forceCheckSWUpdate);

    // Add item
    $("#btnAdd").addEventListener("click", () => openEditor(null));

    // filter chips
    $("#wardrobeFilter").addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const f = btn.getAttribute("data-filter");
      state.filter = f;
      setActiveChips("#wardrobeFilter", (b) => b.getAttribute("data-filter") === f);
      renderWardrobe();
    });

    // modal close
    document.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => {
        hideModal(el.getAttribute("data-close"));
      });
    });

    // category chips in editor
    $("#itemCats").addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const cat = btn.getAttribute("data-cat");
      if (!cat) return;
      setActiveItemCat(cat);
    });

    // file input
    $("#itemFile").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        toast("處理圖片中…", 1200);
        const dataUrl = await compressImageToDataURL(file, 1280, 0.85);
        state.editingImage = dataUrl;
        setEditorImage(dataUrl);

        // 若名稱空白，先用檔名
        const nm = ($("#itemName").value || "").trim();
        if (!nm && file.name) $("#itemName").value = file.name.replace(/\.[a-z0-9]+$/i, "");

        toast("圖片已載入");
      } catch {
        toast("圖片處理失敗：請換一張或改用 JPG");
      }
    });

    // AI describe
    $("#btnAIDescribe").addEventListener("click", aiAnalyzeCurrentItem);

    // save / delete
    $("#btnSaveItem").addEventListener("click", saveEditor);
    $("#btnDeleteItem").addEventListener("click", deleteEditor);

    // Outfit: pick slot
    document.querySelectorAll("[data-pick]").forEach((b) => {
      b.addEventListener("click", () => openPicker(b.getAttribute("data-pick")));
    });

    // Outfit: compose
    $("#btnCompose").addEventListener("click", composeOutfit);
    $("#btnClearOutfit").addEventListener("click", clearOutfit);

    // Settings
    $("#workerBaseInput").addEventListener("change", (e) => setWorkerBase(e.target.value));
    $("#btnSaveWorkerBase").addEventListener("click", () => {
      const v = ($("#workerBaseInput").value || "").trim();
      if (!v.startsWith("https://")) return toast("請輸入 https:// 開頭的 Worker URL");
      setWorkerBase(v);
      toast("已儲存 Worker Base");
    });
    $("#btnHealthz").addEventListener("click", runHealthz);
    $("#btnHardReloadHint").addEventListener("click", showHardReloadHint);
    $("#btnClearLocalCache").addEventListener("click", clearLocalCacheOnly);
  }

  // ========= Boot =========
  async function boot() {
    // init worker base input
    $("#workerBaseInput").value = getWorkerBase();

    bindEvents();

    // draw placeholder canvas
    const c = $("#composeCanvas");
    if (c) drawComposePlaceholder(c.getContext("2d"), c.width, c.height);

    // initial section
    setSection("wardrobe");

    // load items
    await loadItems();

    // render cached weather
    const cached = readWeatherCache();
    if (cached?.data) {
      renderWeather(cached.data, cached.city || "快取");
    }

    // auto refresh weather once
    refreshByGPS().catch(() => {});

    // SW
    registerSW().catch(() => {});
  }

  document.addEventListener("DOMContentLoaded", boot);
})();