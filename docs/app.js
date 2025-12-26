/* docs/app.js */
(() => {
  const CATS = ["全部", "上衣", "下著", "內搭", "外套", "鞋子", "配件"];
  const QUICK = [
    { title: "長袖打底（白）", category: "內搭", tMin: 10, tMax: 22 },
    { title: "長袖打底（黑）", category: "內搭", tMin: 10, tMax: 22 },
    { title: "短袖T恤（白）", category: "內搭", tMin: 20, tMax: 35 },
    { title: "短袖T恤（黑）", category: "內搭", tMin: 20, tMax: 35 },
    { title: "連帽外套（灰）", category: "外套", tMin: 8, tMax: 20 },
    { title: "牛仔外套", category: "外套", tMin: 10, tMax: 22 },
    { title: "牛仔寬褲", category: "下著", tMin: 8, tMax: 35 },
    { title: "直筒牛仔褲", category: "下著", tMin: 8, tMax: 35 }
  ];

  const $ = (sel) => document.querySelector(sel);

  const el = {
    sub: $("#subline"),
    chips: $("#chips"),
    grid: $("#grid"),
    empty: $("#empty"),
    fab: $("#fab"),
    menu: $("#menu"),
    modalRoot: $("#modalRoot"),
    filePick: $("#filePick"),
    fileCamera: $("#fileCamera"),
    btnPick: $("#btnPick"),
    btnCamera: $("#btnCamera"),
    btnFile: $("#btnFile"),
    btnQuick: $("#btnQuick"),
    bottomNav: $("#bottomNav")
  };

  let tab = "wardrobe";
  let filterCat = "全部";

  // ---- 防止「看起來正常但完全不能操作」：如果 JS 有跑，這裡一定會印
  console.log("[Wardrobe] app.js loaded");

  function renderChips() {
    el.chips.innerHTML = "";
    CATS.forEach(cat => {
      const b = document.createElement("button");
      b.className = "chip" + (filterCat === cat ? " on" : "");
      b.textContent = cat;
      b.addEventListener("click", () => {
        filterCat = cat;
        render();
      });
      el.chips.appendChild(b);
    });
  }

  function renderGrid(items) {
    if (!items.length) {
      el.grid.style.display = "none";
      el.empty.style.display = "block";
      el.sub.textContent = `今天收集了 0 件寶貝`;
      return;
    }
    el.empty.style.display = "none";
    el.grid.style.display = "grid";
    el.sub.textContent = `今天收集了 ${items.length} 件寶貝`;

    el.grid.innerHTML = items.map(item => {
      const img = item.imageDataUrl ? item.imageDataUrl : "";
      const safeTitle = escapeHtml(item.title || "(未命名)");
      return `
        <button class="card" data-id="${item.id}">
          <img alt="" src="${img}" />
          <div class="cardTitle">${safeTitle}</div>
          <div class="tag">${item.category}・${item.tMin}–${item.tMax}°C</div>
        </button>
      `;
    }).join("");

    // 卡片點擊
    el.grid.querySelectorAll(".card").forEach(card => {
      card.addEventListener("click", () => {
        const id = card.getAttribute("data-id");
        openEditModal(DB.get(id));
      });
    });
  }

  function render() {
    // tabs：目前只把衣櫃做完整，其餘顯示佔位
    Array.from(el.bottomNav.querySelectorAll("button")).forEach(b => {
      b.classList.toggle("on", b.dataset.tab === tab);
    });

    if (tab !== "wardrobe") {
      el.chips.style.display = "none";
      el.grid.style.display = "none";
      el.empty.style.display = "block";
      el.empty.textContent = "此頁面先保留，你要我做哪個功能我再補上。";
      return;
    }

    el.chips.style.display = "flex";
    renderChips();

    let items = DB.list();
    if (filterCat !== "全部") items = items.filter(x => x.category === filterCat);
    renderGrid(items);
  }

  // ---- Menu
  function toggleMenu(force) {
    const show = (typeof force === "boolean") ? force : (el.menu.style.display === "none");
    el.menu.style.display = show ? "block" : "none";
  }

  el.fab.addEventListener("click", () => toggleMenu());

  // 點畫面其他地方關掉 menu
  document.addEventListener("click", (e) => {
    const inside = el.menu.contains(e.target) || el.fab.contains(e.target);
    if (!inside) toggleMenu(false);
  });

  // ---- Image handling (壓縮避免 localStorage 爆掉/卡頓)
  async function fileToDataUrl(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });

    // 壓縮
    const img = await loadImage(dataUrl);
    const max = 1024;
    const ratio = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // ---- Add flows
  el.btnPick.addEventListener("click", () => {
    toggleMenu(false);
    el.filePick.click();
  });

  el.btnCamera.addEventListener("click", () => {
    toggleMenu(false);
    el.fileCamera.click();
  });

  el.btnFile.addEventListener("click", () => {
    toggleMenu(false);
    el.filePick.click();
  });

  el.btnQuick.addEventListener("click", () => {
    toggleMenu(false);
    openQuickModal();
  });

  el.filePick.addEventListener("change", async () => {
    const f = el.filePick.files && el.filePick.files[0];
    el.filePick.value = "";
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    openEditModal(DB.newItem({ imageDataUrl: dataUrl }));
  });

  el.fileCamera.addEventListener("change", async () => {
    const f = el.fileCamera.files && el.fileCamera.files[0];
    el.fileCamera.value = "";
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    openEditModal(DB.newItem({ imageDataUrl: dataUrl }));
  });

  // ---- Modals
  function closeModal() {
    el.modalRoot.innerHTML = "";
  }

  function openEditModal(item) {
    if (!item) item = DB.newItem();
    el.modalRoot.innerHTML = `
      <div class="modal">
        <div class="modalCard">
          <div class="modalHead">
            <div class="modalTitle">編輯單品</div>
            <button class="iconBtn" id="xClose">×</button>
          </div>

          <div class="field">
            <div class="label">名稱 / 描述</div>
            <input class="input" id="iTitle" placeholder="例如：深灰色立領羽絨外套，輕巧保暖" value="${escapeAttr(item.title || "")}">
          </div>

          <div class="field">
            <div class="label">適穿溫度範圍（°C）</div>
            <div class="row2">
              <input class="input" id="iMin" type="number" value="${Number(item.tMin ?? 0)}">
              <div class="dash">-</div>
              <input class="input" id="iMax" type="number" value="${Number(item.tMax ?? 30)}">
            </div>
          </div>

          <div class="field">
            <div class="label">修改分類</div>
            <div class="catGrid" id="catGrid"></div>
          </div>

          <button class="btnPrimary" id="btnSave">儲存修改</button>
          <button class="btnDanger" id="btnDel">刪除此單品</button>
        </div>
      </div>
    `;

    $("#xClose").addEventListener("click", closeModal);

    // cat buttons
    const cg = $("#catGrid");
    ["上衣","下著","內搭","外套","鞋子","配件"].forEach(cat => {
      const b = document.createElement("button");
      b.className = "catBtn" + (item.category === cat ? " on" : "");
      b.textContent = cat;
      b.addEventListener("click", () => {
        item.category = cat;
        Array.from(cg.querySelectorAll("button")).forEach(x => x.classList.remove("on"));
        b.classList.add("on");
      });
      cg.appendChild(b);
    });

    $("#btnSave").addEventListener("click", () => {
      item.title = $("#iTitle").value.trim();
      item.tMin = Number($("#iMin").value || 0);
      item.tMax = Number($("#iMax").value || 0);
      DB.upsert(item);
      closeModal();
      render();
    });

    $("#btnDel").addEventListener("click", () => {
      DB.remove(item.id);
      closeModal();
      render();
    });

    // 點遮罩關閉（避免卡住不能點）
    el.modalRoot.querySelector(".modal").addEventListener("click", (e) => {
      if (e.target.classList.contains("modal")) closeModal();
    });
  }

  function openQuickModal() {
    el.modalRoot.innerHTML = `
      <div class="modal">
        <div class="modalCard">
          <div class="modalHead">
            <div class="modalTitle">⚡ 快速加入基礎單品</div>
            <button class="iconBtn" id="xClose">×</button>
          </div>
          <div class="catGrid" id="qGrid"></div>
        </div>
      </div>
    `;

    $("#xClose").addEventListener("click", closeModal);

    const q = $("#qGrid");
    QUICK.forEach(p => {
      const b = document.createElement("button");
      b.className = "catBtn";
      b.textContent = p.title;
      b.addEventListener("click", () => {
        DB.upsert(DB.newItem({
          title: p.title,
          category: p.category,
          tMin: p.tMin,
          tMax: p.tMax,
          imageDataUrl: ""
        }));
        closeModal();
        render();
      });
      q.appendChild(b);
    });

    el.modalRoot.querySelector(".modal").addEventListener("click", (e) => {
      if (e.target.classList.contains("modal")) closeModal();
    });
  }

  // ---- Bottom nav
  el.bottomNav.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    tab = b.dataset.tab;
    render();
  });

  // ---- Service Worker (避免卡頓/快取不更新)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js?v=1").catch(console.error);
  }

  // helpers
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
    }[c]));
  }
  function escapeAttr(s) {
    return String(s).replace(/"/g, "&quot;");
  }

  // start
  render();
})();