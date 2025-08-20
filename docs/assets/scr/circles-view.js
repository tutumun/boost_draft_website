// circles-view.js（refactor: 可読性・保守性向上 / 挙動・表示は変更しない）
// 役割：サークル一覧の 3 モード（50音 / スペース順 / 表）を描画し、
//       上部タブ（.js-mode-btn）とサブボタン（.js-sub-btn）の状態同期を行う。
// 方針：
//  - 既存の公開API名（renderKanaView/renderSpaceView/renderPlainTable/initView）を維持
//  - 既存のUI仕様（選択中を濃く、ARIA反映、CSV space有 → デフォルトSpace(A)）を維持
//  - コードを機能別ブロックに整理、重複ユーティリティを統合
//  - コメントを追加（日本語）

(() => {
  "use strict";

  /* =========================
   * 表カラム幅 設定（表モードだけ使用）
   * ========================= */
  const defaultTableConfig = {
    widths: [160, 200, 200, 150],    // [スペース, サークル名, PN, 区分]
    forceTotalWidthBySum: true,       // true: 合計をそのまま総幅に採用
    explicitTotalWidth: null,         // 数値指定で総幅固定（nullなら合計）
    containerMaxWidth: 1360           // #circleList の最大幅（px）
  };
  // ウィンドウから編集可能（開発支援）。既に存在すれば上書きしない
  window.circleTableConfig = window.circleTableConfig || { ...defaultTableConfig };

  // デベロッパ向けの即時反映API（任意）
  window.setTableWidths = (arr) => {
    if (Array.isArray(arr) && arr.length === 4 && arr.every(Number.isFinite)) {
      window.circleTableConfig.widths = arr.map(n => Math.max(40, Math.floor(n))); // 最小40px
      if (window.__currentView === "table") renderPlainTable(window.__currentFilterKey || "all");
    }
  };
  window.setTableTotalWidth = (pxOrNull) => {
    window.circleTableConfig.explicitTotalWidth = (pxOrNull == null) ? null : Math.max(160, Math.floor(pxOrNull));
    if (window.__currentView === "table") renderPlainTable(window.__currentFilterKey || "all");
  };
  window.resetTableConfig = () => {
    window.circleTableConfig = { ...defaultTableConfig };
    if (window.__currentView === "table") renderPlainTable(window.__currentFilterKey || "all");
  };

  /* =========================
   * ユーティリティ
   * ========================= */
  const $ = (id) => document.getElementById(id);
  const getData = () => Array.isArray(window.circleData) ? window.circleData : [];

  /** 指定モード以外のサブ行を隠し、対象のみ表示 */
  function showRowFor(mode) {
    const rows = { space: $("sub-switch-space"), kana: $("sub-switch-kana"), table: $("sub-switch-table") };
    Object.entries(rows).forEach(([k, el]) => el?.classList.toggle("hidden", k !== mode));
  }

  /** circleData の到着を待つ（最大 timeoutMs ms） */
  function waitForData(timeoutMs = 5000) {
    if (getData().length > 0) return Promise.resolve(getData());
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (getData().length > 0 || Date.now() - start > timeoutMs) { clearInterval(timer); resolve(getData()); }
      }, 100);
    });
  }

  /** カード表示時の「さらに読み込む」可視切替 */
  function toggleLoadMore(show) {
    const btn = $("loadMoreCircles");
    if (btn) btn.style.display = show ? "block" : "none";
  }

  /** サブボタンの設置先（.sub-switch）を返す。無ければフォールバック生成 */
  function ensureSubControls(mode = window.__currentView) {
    const map = { space: $("sub-switch-space"), kana: $("sub-switch-kana"), table: $("sub-switch-table") };
    if (map[mode]) return map[mode];
    // 最終フォールバック（テンプレ依存を避けるため一時生成）
    let sub = $("subControls");
    if (!sub) {
      sub = document.createElement("div");
      sub.id = "subControls";
      const list = $("circleList");
      (list?.parentNode || document.body).insertBefore(sub, list || null);
    }
    return sub;
  }

  /* ===== 比較関数（公開） ===== */
  function compareKana(a, b) {
    const collator = new Intl.Collator("ja", { usage: "sort", sensitivity: "base", ignorePunctuation: true });
    const ka = (a?.kana ?? a?.name ?? "").toString();
    const kb = (b?.kana ?? b?.name ?? "").toString();
    return collator.compare(ka, kb);
  }
  window.compareKana = window.compareKana || compareKana;

  function compareSpaceStr(a, b) {
    const re = /^([A-Z]+)-?(\d+)/i;
    const sa = String(a || ""), sb = String(b || "");
    const ma = sa.match(re), mb = sb.match(re);
    if (ma && mb) {
      const ba = ma[1].toUpperCase(), bb = mb[1].toUpperCase();
      if (ba !== bb) return ba.localeCompare(bb, "ja");
      return parseInt(ma[2], 10) - parseInt(mb[2], 10);
    }
    return sa.localeCompare(sb, "ja");
  }
  window.compareSpaceStr = window.compareSpaceStr || compareSpaceStr;

  /* ===== かな行判定 ===== */
  function rowKeyForRecord(rec) {
    const kanaRaw = (rec?.kana ?? "").toString().trim().toLowerCase();
    const roman = { a:"あ",k:"か",s:"さ",t:"た",n:"な",h:"は",m:"ま",y:"や",r:"ら",w:"わ" };
    if (roman[kanaRaw]) return roman[kanaRaw];
    const ch = normalizeKanaHead((rec?.kana || rec?.name || "").toString());
    const ROWS = { "あ":["あ","い","う","え","お"], "か":["か","き","く","け","こ"], "さ":["さ","し","す","せ","そ"], "た":["た","ち","つ","て","と"], "な":["な","に","ぬ","ね","の"], "は":["は","ひ","ふ","へ","ほ"], "ま":["ま","み","む","め","も"], "や":["や","ゆ","よ"], "ら":["ら","り","る","れ","ろ"], "わ":["わ","を","ん"] };
    for (const [row, chars] of Object.entries(ROWS)) if (chars.includes(ch)) return row;
    return "";
  }
  function normalizeKanaHead(str) {
    if (!str) return "";
    let ch = String(str).trim().charAt(0).normalize("NFKC").normalize("NFKD").replace(/\p{M}+/gu, "");
    const code = ch.charCodeAt(0);
    if (code >= 0x30A1 && code <= 0x30FA) ch = String.fromCharCode(code - 0x60); // カタカナ→ひらがな
    const SMALL = { "ぁ":"あ","ぃ":"い","ぅ":"う","ぇ":"え","ぉ":"お","っ":"つ","ゃ":"や","ゅ":"ゆ","ょ":"よ","ゎ":"わ" };
    return SMALL[ch] || ch;
  }
  const getCatLower = (d) => String(d?.cat ?? d?.type ?? "").trim().toLowerCase();

  /* ===== サブボタン描画・挙動（共通） ===== */
  function setSubControls(html, onClick, datasetKey = "data-scope", mode = window.__currentView) {
    const sub = ensureSubControls(mode);
    // どのテンプレでも動くよう強制的にクラスを付与、data-filter 互換も確保
    sub.innerHTML = html
      .replaceAll("<button ", `<button class="ui-pill js-sub-btn" `)
      .replaceAll('data-filter="', 'data-scope="');

    sub.querySelectorAll("[data-scope]").forEach(b => {
      if (!b.hasAttribute("data-filter")) b.setAttribute("data-filter", b.getAttribute("data-scope"));
    });

    sub.onclick = (ev) => {
      const target = ev.target.closest(".js-sub-btn");
      if (!target) return;
      const key = target.getAttribute("data-scope") || target.getAttribute("data-filter");
      // UI（見た目/ARIA）の先行反映：再描画で置換されても初期状態が正しくなる
      sub.querySelectorAll(".js-sub-btn").forEach(btn => {
        const active = (btn === target);
        btn.classList.toggle("ui-pill--active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
        btn.setAttribute("aria-pressed",  active ? "true" : "false");
      });
      onClick?.(key);
    };
  }

  /* =========================
   * 各表示モード
   * ========================= */
  function renderKanaView(initialKey = "あ") {
    window.__currentView = "kana";
    window.__currentFilterKey = initialKey;
    showRowFor("kana");

    const baseAll = [...getData()].sort(compareKana);
    const rows = ["あ","か","さ","た","な","は","ま","や","ら","わ"];

    setSubControls(
      `<div role="group" aria-label="50音行フィルタ">
        <button type="button" data-scope="all">すべて</button>
        ${rows.map(r => `<button type="button" data-scope="${r}">${r}</button>`).join("")}
        <button type="button" data-scope="corp">企業</button>
      </div>`,
      (key) => {
        window.__currentFilterKey = key;
        const viewData = buildKanaViewData(baseAll, key);
        if (typeof window.renderCards === "function") {
          window.renderCards(viewData);
          toggleLoadMore(viewData.length > 20);
        }
      }
    );

    // 初回描画
    const firstData = buildKanaViewData(baseAll, initialKey);
    if (typeof window.renderCards === "function") {
      window.renderCards(firstData);
      toggleLoadMore(firstData.length > 20);
    }

    // 初期アクティブ強調
    applyInitialActive(initialKey);

    function buildKanaViewData(sortedAll, key) {
      const isCorp  = (d) => getCatLower(d) === "企業";
      const isItaku = (d) => getCatLower(d) === "委託";

      if (key === "corp") return sortedAll.filter(isCorp);
      if (key === "all") {
        const general = sortedAll.filter(d => !isCorp(d) && !isItaku(d));
        let merged = [];
        rows.forEach(r => { merged = merged.concat(general.filter(d => rowKeyForRecord(d) === r)); });
        const corp  = sortedAll.filter(isCorp);
        const itaku = sortedAll.filter(isItaku);
        return merged.concat(corp, itaku);
      }
      return sortedAll.filter(d => rowKeyForRecord(d) === key);
    }
    $("circleList")?.classList.add("circle-list");
  }

  function renderSpaceView(initialKey = "A") {
    window.__currentView = "space";
    window.__currentFilterKey = initialKey;
    showRowFor("space");

    const base = [...getData()].sort((a, b) => compareSpaceStr(a.space || "", b.space || ""));
    const letters = ["A","B","C","D","E"];

    setSubControls(
      `<div role="group" aria-label="スペース行フィルタ">
        <button type="button" data-scope="all">すべて</button>
        ${letters.map(L => `<button type="button" data-scope="${L}">${L}</button>`).join("")}
        <button type="button" data-scope="corp">企業</button>
        <button type="button" data-scope="itaku">委託</button>
      </div>`,
      (key) => {
        window.__currentFilterKey = key;
        let data = base;
        if (key === "corp") {
          const hasCat = data.some(d => (d.cat ?? d.type ?? "").trim() !== "");
          data = hasCat ? data.filter(d => getCatLower(d) === "企業") : [];
        } else if (key === "itaku") {
          const hasCat = data.some(d => (d.cat ?? d.type ?? "").trim() !== "");
          data = hasCat ? data.filter(d => getCatLower(d) === "委託") : [];
        } else if (key !== "all") {
          const re = new RegExp(`^${key}`, "i");
          data = data.filter(d => re.test(String(d.space || "")));
        }
        if (typeof window.renderCards === "function") {
          window.renderCards(data);
          toggleLoadMore(data.length > 20);
        }
      }
    );

    // 初回描画
    let first = base;
    if (initialKey === "corp") {
      const hasCat = base.some(d => (d.cat ?? d.type ?? "").trim() !== "");
      first = hasCat ? base.filter(d => getCatLower(d) === "企業") : [];
    } else if (initialKey === "itaku") {
      const hasCat = base.some(d => (d.cat ?? d.type ?? "").trim() !== "");
      first = hasCat ? base.filter(d => getCatLower(d) === "委託") : [];
    } else if (initialKey !== "all") {
      const reInit = new RegExp(`^${initialKey}`, "i");
      first = base.filter(d => reInit.test(String(d.space || "")));
    }
    if (typeof window.renderCards === "function") {
      window.renderCards(first);
      toggleLoadMore(first.length > 20);
    }

    // 初期アクティブ強調
    applyInitialActive(initialKey);

    $("circleList")?.classList.add("circle-list");
  }

  function renderPlainTable(initialKey = "all") {
    window.__currentView = "table";
    window.__currentFilterKey = initialKey;
    showRowFor("table");

    setSubControls(
      `<div role="group" aria-label="表表示フィルタ">
        <button type="button" data-scope="all">すべて</button>
        <button type="button" data-scope="A">A</button>
        <button type="button" data-scope="B">B</button>
        <button type="button" data-scope="C">C</button>
        <button type="button" data-scope="D">D</button>
        <button type="button" data-scope="E">E</button>
        <button type="button" data-scope="corp">企業</button>
        <button type="button" data-scope="itaku">委託</button>
      </div>`,
      (key) => renderPlainTable(key),
      "data-scope",
      "table"
    );

    // 初期アクティブ強調
    applyInitialActive(initialKey);

    // スペース順で安定ソート
    const base = [...getData()].sort((a, b) => compareSpaceStr(a.space || "", b.space || ""));

    // フィルタ適用
    let data = base;
    if (initialKey === "corp") {
      const hasCat = base.some(d => (d.cat ?? d.type ?? "").trim() !== "");
      data = hasCat ? base.filter(d => getCatLower(d) === "企業") : [];
    } else if (initialKey === "itaku") {
      const hasCat = base.some(d => (d.cat ?? d.type ?? "").trim() !== "");
      data = hasCat ? base.filter(d => getCatLower(d) === "委託") : [];
    } else if (["A","B","C","D","E"].includes(initialKey)) {
      const re = new RegExp(`^${initialKey}`, "i");
      data = base.filter(d => re.test(String(d.space || "")));
    }

    // テーブル描画（style直指定で列幅を固定）
    const container = $("circleList");
    container?.classList.remove("circle-list");
    if (!container) return;
    container.innerHTML = "";
    container.style.overflowX = "auto";
    container.style.webkitOverflowScrolling = "touch";
    if (Number.isFinite(window.circleTableConfig.containerMaxWidth)) {
      container.style.maxWidth = window.circleTableConfig.containerMaxWidth + "px";
      container.style.marginLeft = "auto";
      container.style.marginRight = "auto";
      container.style.paddingLeft = "12px";
      container.style.paddingRight = "12px";
    }

    const cfg = window.circleTableConfig;
    const COLS = (cfg?.widths?.length === 4) ? cfg.widths : defaultTableConfig.widths;
    const sum = COLS.reduce((a,b)=>a+b, 0);
    const totalWidth = (cfg.explicitTotalWidth != null) ? cfg.explicitTotalWidth : (cfg.forceTotalWidthBySum ? sum : sum);

    const table = document.createElement("table");
    table.style.tableLayout = "fixed";
    table.style.borderCollapse = "collapse";
    table.style.width = `${totalWidth}px`;
    table.style.minWidth = `${totalWidth}px`;
    table.style.maxWidth = `${totalWidth}px`;

    const colgroup = document.createElement("colgroup");
    COLS.forEach((w) => {
      const col = document.createElement("col");
      col.setAttribute("width", w);
      col.style.width = `${w}px`;
      col.style.minWidth = `${w}px`;
      col.style.maxWidth = `${w}px`;
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    ["スペース","サークル名","PN","区分"].forEach((txt, i) => {
      const th = document.createElement("th");
      th.textContent = txt;
      th.style.width = `${COLS[i]}px`;
      th.style.minWidth = `${COLS[i]}px`;
      th.style.maxWidth = `${COLS[i]}px`;
      th.style.whiteSpace = "normal";
      th.style.wordBreak = "break-word";
      th.style.border = "1px solid #ccc";
      th.style.padding = "6px 10px";
      th.style.background = "#f8fafc";
      th.style.fontWeight = "600";
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    data.forEach((d) => {
      const tr = document.createElement("tr");
      [String(d?.space||""), String(d?.name||""), String(d?.pn||""), String(d?.cat||d?.type||"")].forEach((val, i) => {
        const td = document.createElement("td");
        td.textContent = val;
        td.style.width = `${COLS[i]}px`;
        td.style.minWidth = `${COLS[i]}px`;
        td.style.maxWidth = `${COLS[i]}px`;
        td.style.whiteSpace = "normal";
        td.style.wordBreak = "break-word";
        td.style.border = "1px solid #ccc";
        td.style.padding = "6px 10px";
        td.style.textAlign = "left";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    container.appendChild(table);
    toggleLoadMore(false);

    console.log(`[renderPlainTable] key=${initialKey}, colWidths=${COLS.join(",")}, total=${totalWidth}px`);

    $("circleList")?.classList.add("circle-list"); // 既存互換のため維持
  }
  window.renderPlainTable = window.renderPlainTable || renderPlainTable;

  /* =========================
   * 初期化（一本化）
   * ========================= */
  function initView() {
    // 旧サブ行が残っていた場合に備えて排除
    document.querySelectorAll('.sub-switch, #sub-switch-space, #sub-switch-kana, #sub-switch-table').forEach(el => el.remove?.());
    try {
      const data = getData();
      const hasSpace = Array.isArray(data) && data.some(d => (d?.space ?? "").toString().trim() !== "");
      if (hasSpace) { renderSpaceView("A"); console.log("[init] default = Space(A)"); }
      else { renderKanaView("あ"); console.log("[init] default = Kana(あ)"); }
    } catch (e) {
      console.error("[initView] error:", e);
      renderKanaView("あ"); // フォールバック
    }
    $("viewControls")?.classList.remove("is-hidden");
    $("subControls")?.classList.remove("is-hidden");
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      await waitForData();    // データ到着待ち
      initView();             // デフォルト描画

      // 上部タブのバインド（一度だけ）
      $("sortKana")?.addEventListener("click", () => renderKanaView("あ"));
      $("sortSpace")?.addEventListener("click", () => renderSpaceView("A"));
      $("viewTable")?.addEventListener("click", () => renderPlainTable("all"));
    } catch (e) {
      console.error("[DOMContentLoaded] init failed:", e);
      renderKanaView("あ");
    }
  });

  /* =========================
   * UI強調の最小追加（既存互換）
   * ========================= */
  /** 指定グループでアクティブを1つにする */
  const setActive = (btn, groupSelector = ".mode-switch") => {
    const group = btn.closest(groupSelector) || document;
    group.querySelectorAll('.ui-pill').forEach(el => {
      el.classList.remove('ui-pill--active');
      if (el.hasAttribute('aria-selected')) el.setAttribute('aria-selected', 'false');
      if (el.hasAttribute('aria-pressed'))  el.setAttribute('aria-pressed',  'false');
    });
    btn.classList.add('ui-pill--active');
    if (btn.hasAttribute('aria-selected')) btn.setAttribute('aria-selected', 'true');
    if (btn.hasAttribute('aria-pressed'))  btn.setAttribute('aria-pressed',  'true');
  };

  /** 初期アクティブ（sub-controls）の同期 */
  function applyInitialActive(initialKey) {
    const sub = ensureSubControls(window.__currentView);
    const initBtn = sub?.querySelector(`[data-scope="${initialKey}"]`);
    if (!sub) return;
    sub.querySelectorAll(".js-sub-btn").forEach(btn => {
      const active = (initBtn && btn === initBtn);
      btn.classList.toggle("ui-pill--active", !!active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.setAttribute("aria-pressed",  active ? "true" : "false");
    });
  }

  // モードボタン（サークル順・50音順・表表示）
  document.querySelectorAll('.js-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget;
      const mode = target.dataset.mode;
      setActive(target, '.mode-switch');
      if (typeof window.switchViewMode === 'function') {
        window.switchViewMode(mode);
      }
    });
  });

  // サブボタン（A~E・企業・委託・あ~わ など）
  document.querySelectorAll('.js-sub-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget;
      setActive(target, '.sub-switch');
      const scope = target.dataset.scope;
      if (typeof window.filterCircles === 'function') {
        window.filterCircles(scope);
      }
    });
  });

  // 初期強調の同期（HTML上で aria-selected などがあれば反映）
  const syncInitialActive = (containerSel) => {
    document.querySelectorAll(containerSel).forEach(container => {
      const selected = container.querySelector('.ui-pill[aria-selected="true"], .ui-pill[aria-pressed="true"], .ui-pill.ui-pill--active');
      if (selected) setActive(selected, containerSel);
    });
  };
  syncInitialActive('.mode-switch');
  syncInitialActive('.sub-switch');

  // 公開（inline onclick対策、既にあれば保持）
  window.renderKanaView   = window.renderKanaView   || renderKanaView;
  window.renderSpaceView  = window.renderSpaceView  || renderSpaceView;
  window.renderPlainTable = window.renderPlainTable || renderPlainTable;
  window.initView         = window.initView         || initView;
})();

// --- 追加: レガシーUIの掃除とサブ行のモード同期 -------------------------------
(() => {
  "use strict";
  function cleanupLegacyUI() {
    const selectors = ['.alpha-switch', '.kana-switch', '.sub-switch-legacy', '#legacySubControls', '#oldSubControls'];
    document.querySelectorAll(selectors.join(',')).forEach(el => el.remove());

    // プレーンな旧ボタン行（A B C D E 企業 委託 すべて …）をパターン検出で削除
    const root = document.getElementById('circles') || document;
    [...root.querySelectorAll('div,nav,section')].forEach(row => {
      if (row.classList.contains('sub-switch') || row.classList.contains('mode-switch')) return;
      const btns = row.querySelectorAll('button');
      if (!btns.length) return;
      const texts = [...btns].map(b => b.textContent.trim());
      const looksAlpha = ['A','B','C','D','E'].every(t => texts.includes(t));
      const looksKana  = ['あ','か','さ','た','な','は','ま','や','ら','わ'].some(t => texts.includes(t));
      const hasSubete  = texts.includes('すべて');
      if ((looksAlpha || looksKana) && hasSubete) row.remove();
    });
  }

  function showOnlyCurrentSubRow(mode) {
    const rows = { space: document.getElementById('sub-switch-space'), kana: document.getElementById('sub-switch-kana'), table: document.getElementById('sub-switch-table') };
    Object.entries(rows).forEach(([k, el]) => el?.classList.toggle('hidden', k !== mode));
  }

  const run = () => {
    cleanupLegacyUI();
    // HTMLの aria-selected よりも、実際に描画したモード（window.__currentView）を優先
    const current = document.querySelector('.js-mode-btn[aria-selected="true"]');
    const mode = window.__currentView || current?.dataset.mode || 'space';
    showOnlyCurrentSubRow(mode);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
