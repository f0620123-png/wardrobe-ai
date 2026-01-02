/* docs/app.js */
/* === Hotfix: FAB click reliability + keep existing logic === */

/**
 * 你的原本 app.js 內一定已經有：
 * - Tab 切換
 * - 開啟「新增/編輯單品」的既有流程（按鈕或函式）
 *
 * 這份檔案做的事情：
 * 1) 永遠把 FAB 點擊導到「既有新增流程」
 * 2) 修 iOS 常見點不到/事件不觸發問題
 *
 * 注意：我不改 DB、不改資料結構、不改你原本的 render，只做點擊可靠性熱修。
 */

/* -----------------------------
 * 1) 找到 FAB（容錯多 selector）
 * ----------------------------- */
function getFabEl() {
  return (
    document.querySelector("#fabAdd") ||
    document.querySelector("#fab") ||
    document.querySelector("#btnAdd") ||
    document.querySelector('button[data-fab="add"]') ||
    document.querySelector(".fab")
  );
}

/* -----------------------------
 * 2) 導到「你原本的新增流程」
 *    盡量不碰你的底層邏輯：
 *    - 先嘗試點擊既有的「新增單品」按鈕
 *    - 再嘗試呼叫既有的全域函式（若你有暴露）
 *    - 最後才用 fallback 去開 modal（不建議走到這步）
 * ----------------------------- */
function triggerExistingAddFlow() {
  // A) 先找你頁面上已存在、原本用來新增的按鈕（最保險：沿用既有 listener）
  const candidates = [
    "#btnNewItem",
    "#addItem",
    "#openAdd",
    '[data-action="add"]',
    '[data-action="new-item"]',
    '[aria-label="新增"]',
    '[aria-label="新增單品"]',
    'button[name="add"]',
  ];

  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el) {
      el.click();
      return true;
    }
  }

  // B) 如果你有把函式掛在 window（很多人會這樣做），就直接呼叫
  const fnCandidates = [
    "openAddItem",
    "openAddItemModal",
    "openItemEditor",
    "openEditorForNewItem",
    "showAddModal",
    "openModalAdd",
  ];
  for (const name of fnCandidates) {
    const fn = window[name];
    if (typeof fn === "function") {
      try {
        fn(); // 不帶參數：新增模式
        return true;
      } catch (e) {
        // continue
      }
    }
  }

  // C) 最後 fallback：嘗試把常見 modal 打開（避免完全沒反應）
  const modal =
    document.querySelector("#itemModal") ||
    document.querySelector("#modalItem") ||
    document.querySelector("#editModal") ||
    document.querySelector("dialog#itemDialog") ||
    document.querySelector("dialog#dlgItem");

  if (modal) {
    // dialog
    if (typeof modal.showModal === "function") {
      modal.showModal();
      return true;
    }
    // div modal
    modal.classList.add("open", "show", "active");
    modal.style.display = "block";
    return true;
  }

  return false;
}

/* -----------------------------
 * 3) iOS 熱修：用捕獲階段監聽 pointer/touch/click
 *    很多時候 click 會被吞，捕獲監聽比較穩。
 * ----------------------------- */
function bindFabHotfix() {
  const fab = getFabEl();
  if (!fab) return;

  // 保底：確保屬性可點
  fab.style.pointerEvents = "auto";
  fab.style.zIndex = "99999";

  // 如果你原本已經綁過 click，這裡也不會破壞：我們只是多一道保險
  const fire = (ev) => {
    // 避免同一次點擊連觸發多種事件造成重複開 modal
    if (fab.__fabLock) return;
    fab.__fabLock = true;
    setTimeout(() => (fab.__fabLock = false), 350);

    ev.preventDefault?.();
    ev.stopPropagation?.();

    const ok = triggerExistingAddFlow();
    if (!ok) {
      // 真的找不到既有流程才提示
      console.warn("[FAB] Cannot find existing add flow. Please ensure add button or function exists.");
      if (typeof window.toast === "function") {
        window.toast("找不到新增流程：請確認頁面是否有『新增單品』按鈕/函式");
      } else {
        alert("找不到新增流程：請確認頁面是否有『新增單品』按鈕/函式");
      }
    }
  };

  // 捕獲：最穩
  fab.addEventListener("pointerup", fire, true);
  fab.addEventListener("touchend", fire, true);
  fab.addEventListener("click", fire, true);
}

/* -----------------------------
 * 4) 若你的 app 會「切 Tab 後重新 render FAB」，
 *    需要在每次切換後 re-bind。
 *    我用 MutationObserver 監看 DOM 變動，自動補綁。
 * ----------------------------- */
function watchFabChanges() {
  const obs = new MutationObserver(() => {
    const fab = getFabEl();
    if (fab && !fab.__fabHotfixBound) {
      fab.__fabHotfixBound = true;
      bindFabHotfix();
    }
  });

  obs.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

/* -----------------------------
 * 5) 啟動：不干擾你原本 boot
 * ----------------------------- */
(function bootFabHotfix() {
  const run = () => {
    const fab = getFabEl();
    if (fab && !fab.__fabHotfixBound) {
      fab.__fabHotfixBound = true;
      bindFabHotfix();
    }
    watchFabChanges();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();