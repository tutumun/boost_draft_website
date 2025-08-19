// circles-view.js（修正版・安定版）
// 目的：
//  - デフォルト表示を「CSVのspace列の有無」で切替（spaceあり→サークル順A／全空→五十音あ）
//  - スペース順ボタンが反応しない不具合を解消（renderSpaceViewを追加／初期化を一本化）
//  - 表表示は<colgroup>＋style直指定で列幅を確実に制御し、微調整APIも提供
//  - 50音「すべて」時は一般→企業→委託の順で結合
//  - コメント多め。既存のrenderCards()はそのまま利用
//  - 【今回の修正】初期ロード時に"別モードのサブ行（例：あ〜わ）"が見えてしまう競合を解消
//      └ 2つ目のIIFEにある run() のモード決定を window.__currentView 優先に変更
//      └ これにより、HTML側の aria-selected 初期値に影響されず、実際に描画したモードに同期する

(() => {
  "use strict";

  /* =========================
   * グローバル設定（表の列幅 微調整用）
   * ========================= */
  const defaultTableConfig = {
    // 列幅（px）：[スペース, サークル名, PN, 区分]
    widths: [160, 200, 200, 150],
    // true: 総幅＝列幅合計で固定
    forceTotalWidthBySum: true,
    // 数値指定で総幅を明示固定したい場合（nullなら列幅合計）
    explicitTotalWidth: null,
    // #circleList の最大幅（px）。nullでCSS任せ
    containerMaxWidth: 1360
  };
  // ウィンドウからも編集できる可変設定
  window.circleTableConfig = window.circleTableConfig || { ...defaultTableConfig };

  // デベロッパ向け簡易API（コンソールから即反映）
  window.setTableWidths = (arr) => {
    if (Array.isArray(arr) && arr.length === 4 && arr.every(n => Number.isFinite(n))) {
      window.circleTableConfig.widths = arr.map(n => Math.max(40, Math.floor(n))); // 最小40px保護
      if (window.__currentView === "table") renderPlainTable(window.__currentFilterKey || "all");
    }
  };
  window.setTableTotalWidth = (pxOrNull) => {
    if (pxOrNull == null) {
      window.circleTableConfig.explicitTotalWidth = null;
    } else if (Number.isFinite(pxOrNull)) {
      window.circleTableConfig.explicitTotalWidth = Math.max(160, Math.floor(pxOrNull)); // 最小160px保護
    }
    if (window.__currentView === "table") renderPlainTable(window.__currentFilterKey || "all");
  };
  window.resetTableConfig = () => {
    window.circleTableConfig = { ...defaultTableConfig };
    if (window.__currentView === "table") renderPlainTable(window.__currentFilterKey || "all");
  };

  /* =========================
   * ユーティリティ
   * ========================= */

  /** id 取得のヘルパ */
  const $ = (id) => document.getElementById(id);

  /** データ取得（未ロード時は空配列） */
  const getData = () => Array.isArray(window.circleData) ? window.circleData : [];

// ▼共通：モードに応じてサブ行の表示/非表示を切替
function showRowFor(mode) {
  const rows = {
    space: document.getElementById('sub-switch-space'),
    kana:  document.getElementById('sub-switch-kana'),
    table: document.getElementById('sub-switch-table'),
  };
  Object.entries(rows).forEach(([k, el]) => {
    if (!el) return;
    el.classList.toggle('hidden', k !== mode);
  });
}
  /** circleData の到着を待つ（最大 5 秒） */
  function waitForData(timeoutMs = 5000) {
    if (getData().length > 0) return Promise.resolve(getData());
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (getData().length > 0 || Date.now() - start > timeoutMs) {
          clearInterval(timer);
          resolve(getData());
        }
      }, 100);
    });
  }

  /** 「さらに読み込む」ボタン表示切替（カード表示用） */
  function toggleLoadMore(show) {
    const btn = document.getElementById("loadMoreCircles");
    if (btn) btn.style.display = show ? "block" : "none";
  }

  /** サブボタンコンテナを #viewControls の直下に配置（無ければ近傍に作成） */
function ensureSubControls(mode = window.__currentView) {
  // 既存のサブ行（.sub-switch）へ出力：space/kana/table
  const map = {
    space: $("sub-switch-space"),
    kana:  $("sub-switch-kana"),
    table: $("sub-switch-table"),
  };
  return map[mode] || map.space || (function () {
    // 最終フォールバック（存在しない場合だけ一時的に作る）
    let sub = $("subControls");
    if (!sub) {
      sub = document.createElement("div");
      sub.id = "subControls";
      const list = $("circleList");
      (list?.parentNode || document.body).insertBefore(sub, list || null);
    }
    return sub;
  })();
}

  /* =========================
   * 比較関数（window公開）
   * ========================= */

  /** 50音（kana優先）での比較 */
  function compareKana(a, b) {
    const collator = new Intl.Collator("ja", { usage: "sort", sensitivity: "base", ignorePunctuation: true });
    const ka = (a?.kana ?? a?.name ?? "").toString();
    const kb = (b?.kana ?? b?.name ?? "").toString();
    return collator.compare(ka, kb);
  }
  window.compareKana = compareKana;

  /** スペース：Aブロック→数値（先頭の数値のみ） */
  function compareSpaceStr(a, b) {
    const regex = /^([A-Z]+)-?(\d+)/i;
    const sa = String(a || ""), sb = String(b || "");
    const ma = sa.match(regex), mb = sb.match(regex);
    if (ma && mb) {
      const ba = ma[1].toUpperCase(), bb = mb[1].toUpperCase();
      if (ba !== bb) return ba.localeCompare(bb, "ja");
      return parseInt(ma[2], 10) - parseInt(mb[2], 10);
    }
    return sa.localeCompare(sb, "ja");
  }
  window.compareSpaceStr = window.compareSpaceStr || compareSpaceStr;

  /* =========================
   * かな行判定（ローマ字 a/k/s/... にも対応）
   * ========================= */

  /** レコード → 行キー（"あ/か/さ/た/な/は/ま/や/ら/わ"） */
  function rowKeyForRecord(rec) {
    const kanaRaw = (rec?.kana ?? "").toString().trim().toLowerCase();
    // ローマ字1文字 → 行キー
    const romanMap = { a: "あ", k: "か", s: "さ", t: "た", n: "な", h: "は", m: "ま", y: "や", r: "ら", w: "わ" };
    if (romanMap[kanaRaw]) return romanMap[kanaRaw];

    // 日本語先頭文字からの判定（ひらがな正規化）
    const ch = normalizeKanaHead((rec?.kana || rec?.name || "").toString());
    const ROWS = {
      "あ": ["あ","い","う","え","お"],
      "か": ["か","き","く","け","こ"],
      "さ": ["さ","し","す","せ","そ"],
      "た": ["た","ち","つ","て","と"],
      "な": ["な","に","ぬ","ね","の"],
      "は": ["は","ひ","ふ","へ","ほ"],
      "ま": ["ま","み","む","め","も"],
      "や": ["や","ゆ","よ"],
      "ら": ["ら","り","る","れ","ろ"],
      "わ": ["わ","を","ん"]
    };
    for (const [row, chars] of Object.entries(ROWS)) {
      if (chars.includes(ch)) return row;
    }
    return "";
  }

  /** 先頭1文字を “基底ひらがな” に正規化（濁点/半濁点/小書き/カタカナ対応） */
  function normalizeKanaHead(str) {
    if (!str) return "";
    let s = String(str).trim();
    if (!s) return "";
    let ch = s.charAt(0).normalize("NFKC").normalize("NFKD").replace(/\p{M}+/gu, "");
    const code = ch.charCodeAt(0);
    // カタカナ→ひらがな
    if (code >= 0x30A1 && code <= 0x30FA) ch = String.fromCharCode(code - 0x60);
    const SMALL = { "ぁ":"あ","ぃ":"い","ぅ":"う","ぇ":"え","ぉ":"お","っ":"つ","ゃ":"や","ゅ":"ゆ","ょ":"よ","ゎ":"わ" };
    return SMALL[ch] || ch;
  }

  /** cat/type を小文字で取得 */
  function getCatLower(d) {
    const cat = d?.cat ?? d?.type ?? "";
    return String(cat).trim().toLowerCase();
  }

  /* =========================
   * サブボタン生成（共通ヘルパ）
   * ========================= */

function setSubControls(html, onClick, datasetKey = "data-scope", mode = window.__currentView) {
  const sub = ensureSubControls(mode);
  // 互換のため：どのテンプレでも .ui-pill / .js-sub-btn を強制付与し、data-filter も併記
  sub.innerHTML = html
    .replaceAll("<button ", `<button class="ui-pill js-sub-btn" `)
    .replaceAll('data-filter="', 'data-scope="')             // 旧 attr → 新 attr へ
    .replaceAll('data-scope="',  'data-scope="');            // 再置換安全弁
  // data-filter 互換（ハンドラ側で参照するため両方持たせる）
  sub.querySelectorAll("[data-scope]").forEach(b => {
    if (!b.hasAttribute("data-filter")) b.setAttribute("data-filter", b.getAttribute("data-scope"));
  });
  sub.onclick = (ev) => {
    const target = ev.target.closest(".js-sub-btn");
    if (!target) return;
    const key = target.getAttribute("data-scope") || target.getAttribute("data-filter");
    onClick?.(key);
    sub.querySelectorAll(".js-sub-btn").forEach(btn => btn.classList.toggle("ui-pill--active", btn === target));
  };
}

  /* =========================
   * 各表示モード
   * ========================= */

  // 50音表示（カード）
  // 「すべて」時：一般（企業/委託以外）を あ→…→わ で結合し、その後ろに 企業→委託 をまとめる
  function renderKanaView(initialKey = "あ") {
    window.__currentView = "kana";
    window.__currentFilterKey = initialKey;
    showRowFor("kana"); // ←追記：50音のサブ行を表示、他は隠す

    const baseAll = [...getData()].sort(compareKana);
    const rows = ["あ","か","さ","た","な","は","ま","や","ら","わ"];

    setSubControls(
      `<div role="group" aria-label="50音行フィルタ">
        ${rows.map(r => `<button type="button" data-scope="${r}">${r}</button>`).join("")}
        <button type="button" data-scope="corp">企業</button>
        <button type="button" data-scope="all">すべて</button>
      </div>`,
      (key) => {
        window.__currentFilterKey = key;
        const viewData = buildKanaViewData(baseAll, key);
        if (typeof window.renderCards === "function") {
          window.renderCards(viewData);
          toggleLoadMore(viewData.length > 20);
        }
        "data-scope",
        "kana"
      }
    );

    // 初回描画
    const firstData = buildKanaViewData(baseAll, initialKey);
    if (typeof window.renderCards === "function") {
      window.renderCards(firstData);
      toggleLoadMore(firstData.length > 20);
    }

    // active 初期付与
    const sub = ensureSubControls(window.__currentView);
    const initBtn = sub.querySelector(`[data-scope="${initialKey}"]`);
    if (initBtn) initBtn.classList.add("ui-pill--active");

    function buildKanaViewData(sortedAll, key) {
      const isCorp  = (d) => getCatLower(d) === "企業";
      const isItaku = (d) => getCatLower(d) === "委託";

      if (key === "corp") return sortedAll.filter(isCorp);
      if (key === "all") {
        const general = sortedAll.filter(d => !isCorp(d) && !isItaku(d));
        let mergedGeneral = [];
        rows.forEach(r => {
          mergedGeneral = mergedGeneral.concat(general.filter(d => rowKeyForRecord(d) === r));
        });
        const corp  = sortedAll.filter(isCorp);
        const itaku = sortedAll.filter(isItaku);
        return mergedGeneral.concat(corp, itaku);
      }
      return sortedAll.filter(d => rowKeyForRecord(d) === key);
    }
    document.getElementById('circleList')?.classList.add('circle-list');
  }

  // スペース順表示（カード）★不足していたため追加
  function renderSpaceView(initialKey = "A") {
    window.__currentView = "space";
    window.__currentFilterKey = initialKey;
    showRowFor("space"); // ←追記

    const base = [...getData()].sort((a, b) => compareSpaceStr(a.space || "", b.space || ""));
    const letters = ["A","B","C","D","E"];

    setSubControls(
      `<div role="group" aria-label="スペース行フィルタ">
        ${letters.map(L => `<button type=\"button\" data-scope=\"${L}\">${L}</button>`).join("")}
        <button type="button" data-scope="corp">企業</button>
        <button type="button" data-scope="itaku">委託</button>
        <button type="button" data-scope="all">すべて</button>
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
        } else if (key === "all") {
          // 全件
        } else {
          const re = new RegExp(`^${key}`, "i");
          data = data.filter(d => re.test(String(d.space || "")));
        }
        if (typeof window.renderCards === "function") {
          window.renderCards(data);
          toggleLoadMore(data.length > 20);
        }
        "data-scope",
        "space"
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
    const sub = ensureSubControls(window.__currentView);
    const initBtn = sub.querySelector(`[data-scope="${initialKey}"]`);
    if (initBtn) initBtn.classList.add("ui-pill--active");

    document.getElementById('circleList')?.classList.add('circle-list');
  }

  // 表表示（プレーンテーブル）
  function renderPlainTable(initialKey = "all") {
    window.__currentView = "table";
    window.__currentFilterKey = initialKey;
    showRowFor("table"); // ←追記

    // サブボタン（フィルタ兼用）
    setSubControls(
      `<div role="group" aria-label="表表示フィルタ">
        <button type="button" data-scope="A">A</button>
        <button type="button" data-scope="B">B</button>
        <button type="button" data-scope="C">C</button>
        <button type="button" data-scope="D">D</button>
        <button type="button" data-scope="E">E</button>
        <button type="button" data-scope="corp">企業</button>
        <button type="button" data-scope="all">すべて</button>
      </div>`,
      (key) => renderPlainTable(key),
      "data-scope",
      "table"
    );

    // スペース順で安定ソート
    const base = [...getData()].sort((a, b) => compareSpaceStr(a.space || "", b.space || ""));

    // フィルタ適用
    let data = base;
    if (initialKey === "corp") {
      const hasCat = base.some(d => (d.cat ?? d.type ?? "").trim() !== "");
      data = hasCat ? base.filter(d => getCatLower(d) === "企業") : [];
    } else if (["A","B","C","D","E"].includes(initialKey)) {
      const re = new RegExp(`^${initialKey}`, "i");
      data = base.filter(d => re.test(String(d.space || "")));
    }

    // テーブル描画
    const container = document.getElementById('circleList');
    container?.classList.remove('circle-list');
//    const container = $("circleList");
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
    const COLS = (cfg?.widths && cfg.widths.length === 4) ? cfg.widths : defaultTableConfig.widths;
    const sum = COLS.reduce((a,b)=>a+b, 0);
    const totalWidth = (cfg.explicitTotalWidth != null)
      ? cfg.explicitTotalWidth
      : (cfg.forceTotalWidthBySum ? sum : sum);

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
    ["スペース", "サークル名", "PN", "区分"].forEach((txt, i) => {
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
      const cells = [
        String(d?.space || ""),
        String(d?.name || ""),
        String(d?.pn || ""),
        String(d?.cat || d?.type || "")
      ];
      cells.forEach((val, i) => {
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
    
    document.getElementById('circleList')?.classList.add('circle-list');
  }
  window.renderPlainTable = renderPlainTable;

  /* =========================
   * 初期化（一本化）
   * ========================= */

  /** デフォルト表示：space有→サークル順A／全空→五十音あ */
  function initView() {
    // 旧サブ行が残っていた場合に備えて排除（従来処理の干渉を防止）
    document.querySelectorAll('.sub-switch, #sub-switch-space, #sub-switch-kana, #sub-switch-table').forEach(el => el.remove?.());
    try {
      const data = getData();
      const hasSpace = Array.isArray(data) && data.some(d => (d?.space ?? "").toString().trim() !== "");
      if (hasSpace) {
        renderSpaceView("A");
        console.log("[init] default = Space(A)");
      } else {
        renderKanaView("あ");
        console.log("[init] default = Kana(あ)");
      }
    } catch (e) {
      console.error("[initView] error:", e);
      renderKanaView("あ"); // フォールバック
    }
    document.getElementById("viewControls")?.classList.remove("is-hidden");
    document.getElementById("subControls")?.classList.remove("is-hidden");

  }

  // DOMContentLoadedハンドラは一つに集約（※重複定義による競合を避ける）
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      await waitForData();   // データ到着待ち
      initView();            // デフォルト描画

      // 上部タブのバインド（重複バインド回避のため addEventListener 一回）
      const btnKana  = $("sortKana");
      const btnSpace = $("sortSpace");
      const btnTable = $("viewTable");
      if (btnKana)  btnKana.addEventListener("click", () => renderKanaView("あ"));
      if (btnSpace) btnSpace.addEventListener("click", () => renderSpaceView("A"));
      if (btnTable) btnTable.addEventListener("click", () => renderPlainTable("all"));
    } catch (e) {
      console.error("[DOMContentLoaded] init failed:", e);
      renderKanaView("あ");
    }
  });

  //!-- =========================================================
  // ここから下は「UI強調の最小追加（既存ソースに追記）」
  //   - 上部のモードボタン（.js-mode-btn）とサブボタン（.js-sub-btn）に
  //     .ui-pill--active / ARIA を同期させる軽量ハンドラ
  //   - 既存の filterCircles / switchViewMode があればそれを尊重
  //========================================================= -->
  /**
   * クリックされたボタンをアクティブ強調（.ui-pill--active 付与）
   * @param {HTMLElement} btn
   * @param {string|HTMLElement} groupSelector - 親コンテナ or セレクタ
   */
  const setActive = (btn, groupSelector = ".mode-switch") => {
    const group = btn.closest(groupSelector) || document;
    group.querySelectorAll('.ui-pill').forEach(el => {
      el.classList.remove('ui-pill--active');
      if (el.hasAttribute('aria-selected')) el.setAttribute('aria-selected', 'false');
      if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('ui-pill--active');
    if (btn.hasAttribute('aria-selected')) btn.setAttribute('aria-selected', 'true');
    if (btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', 'true');
  };

  // モードボタン（サークル順・50音順・表表示）
  const modeButtons = document.querySelectorAll('.js-mode-btn');
  modeButtons.forEach(btn => {
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
  const subButtons = document.querySelectorAll('.js-sub-btn');
  subButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget;
      setActive(target, '.sub-switch');
      const scope = target.dataset.scope;
      if (typeof window.filterCircles === 'function') {
        window.filterCircles(scope);
      }
    });
  });

  // 初期強調の同期（HTML上で aria-selected="true" 等があれば反映）
  const syncInitialActive = (containerSel) => {
    document.querySelectorAll(containerSel).forEach(container => {
      const selected = container.querySelector('.ui-pill[aria-selected="true"], .ui-pill[aria-pressed="true"], .ui-pill.ui-pill--active');
      if (selected) setActive(selected, containerSel);
    });
  };

  // 初期同期を実行
  syncInitialActive('.mode-switch');
  syncInitialActive('.sub-switch');

  // グローバル公開（inline onclick対策）
  window.renderKanaView   = window.renderKanaView   || renderKanaView;
  window.renderSpaceView  = window.renderSpaceView  || renderSpaceView;
  window.renderPlainTable = window.renderPlainTable || renderPlainTable;
  window.initView         = window.initView         || initView;

})();


// --- 追加: 旧スタイルボタンの除去・重複「すべて」排除 -------------------------
// 目的: スクリーンショットのように「未選択の行まで出る」「一番下に旧ボタンが残る」を解消
// 方針: 既存DOMから旧クラスや特徴を持つ要素を除去/非表示にする（最小変更）
(() => {
  "use strict";
  /** 旧スタイルのサブ行を片付ける（安全に remove） */
  function cleanupLegacyUI() {
    // 想定される旧クラス/容器を列挙（なければ無視される）
    const selectors = [
      '.alpha-switch',          // A~E等 旧行
      '.kana-switch',           // あ~わ 等 旧行
      '.sub-switch-legacy',     // 名前違いの旧行
      '#legacySubControls',     // 旧ID想定
      '#oldSubControls',        // 旧ID想定
    ];
    document.querySelectorAll(selectors.join(',')).forEach(el => el.remove());

    // 下部に残るプレーンな旧ボタン行（<button>が並ぶだけで .ui-pill でも .sub-switch でもない）
    // 「A B C D E 企業 委託 すべて」といった並びを検出して削除
    const circlesSection = document.getElementById('circles') || document;
    const rows = [...circlesSection.querySelectorAll('div,nav,section')];
    rows.forEach(row => {
      // すでに新UIの行ならスキップ
      if (row.classList.contains('sub-switch') || row.classList.contains('mode-switch')) return;
      const btns = row.querySelectorAll('button');
      if (!btns.length) return;
      const texts = [...btns].map(b => b.textContent.trim());
      const looksLikeAlpha = ['A','B','C','D','E'].every(t => texts.includes(t));
      const looksLikeKana = ['あ','か','さ','た','な','は','ま','や','ら','わ'].some(t => texts.includes(t));
      const hasCorpOrItaku = texts.includes('企業') || texts.includes('委託');
      const hasSubete = texts.includes('すべて');
      if ((looksLikeAlpha || looksLikeKana) && hasSubete) {
        row.remove();
      }
    });
  }

  // モードに応じたサブ行のみ表示（他は非表示）
  function showOnlyCurrentSubRow(mode) {
    const rows = {
      space: document.getElementById('sub-switch-space'),
      kana:  document.getElementById('sub-switch-kana'),
      table: document.getElementById('sub-switch-table')
    };
    Object.entries(rows).forEach(([k, el]) => {
      if (!el) return;
      el.classList.toggle('hidden', k !== mode);
    });
  }

  // 初期化タイミングで実行
  const run = () => {
    cleanupLegacyUI();
    // 【修正点】HTMLの aria-selected ではなく、実際に描画が決まる window.__currentView を最優先
    // これにより、初期ロード直後に "サークル順" を描画したのに "50音" のサブ行が見えてしまう競合を防止
    const current = document.querySelector('.js-mode-btn[aria-selected="true"]');
    const mode = window.__currentView || current?.dataset.mode || 'space';

    showOnlyCurrentSubRow(mode);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();


function setSubControls(view) {
  const sub = document.getElementById("subControls");
  sub.innerHTML = "";

  let buttons = [];
  if (view === "circle" || view === "table") {
    buttons = ["すべて", "A", "B", "C", "D", "E", "企業", "委託"];
  } else if (view === "kana") {
    buttons = ["すべて", "あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ", "企業"];
  }

  buttons.forEach(label => {
    const el = document.createElement("button");
    el.textContent = label;
    el.addEventListener("click", (ev) => {
      const parent = ev.currentTarget.parentElement;
      parent.querySelectorAll('button').forEach(b => {
        b.classList.remove('ui-pill--active');
        b.removeAttribute('aria-selected');
        b.removeAttribute('aria-pressed');
      });
      el.classList.add('ui-pill--active');
      el.setAttribute('aria-selected','true');
      switchSub(label); // ← 表モードでも同一経路で実処理
    });
    sub.appendChild(el);
  });
}