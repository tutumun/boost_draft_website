// circles-view.js（全面改定版）
// 目的：
//  - 50音表示／スペース順表示／表表示 の3モードを提供
//  - 表表示（プレーンテーブル）の列幅を JS 側で「確実に」制御（<colgroup>＋style直指定）
//  - 列幅や合計幅をグローバル設定から「微調整」できるAPIを提供
//  - ボタン要件：
//      * 50音表示 … 「あ/か/さ/た/な/は/ま/や/ら/わ」「企業」「すべて」 ←（★追加）
//      * スペース順表示 … 「A/B/C/D/E」「企業」「委託」「すべて」 ←（★追加）
//      * 表表示 … 「A/B/C/D/E」「企業」「すべて」（ナビ兼フィルタに変更） ←（★仕様変更）
//  - 「さらに読み込む」(#loadMoreCircles) はカード表示のみ。フィルタ後の件数が20件以下なら非表示。
//  - 比較関数 compareKana / compareSpaceStr は window に公開（他JSでも利用可）

(() => {
  "use strict";

  /* =========================
   * グローバル設定（微調整用）
   * ========================= */
  // 表（プレーンテーブル）の列幅（px）とテーブル幅の制御を一元管理
  const defaultTableConfig = {
    // 列幅： [スペース, サークル名, PN, 区分]（px）
    widths: [160, 200, 200, 150],
    // 合計幅を「widthsの合計」に固定するか（true 推奨）
    forceTotalWidthBySum: true,
    // 明示的にテーブル総幅を固定したい場合は数値を指定（px）。nullなら widths 合計を利用
    explicitTotalWidth: null,
    // コンテナ側（#circleList）の最大幅（px）。null ならCSS任せ
    containerMaxWidth: 1360
  };

  // window からも触れるように公開（微調整しやすい）
  window.circleTableConfig = window.circleTableConfig || { ...defaultTableConfig };

  // 簡易API：開発コンソールから即時反映できるよう公開
  window.setTableWidths = (arr) => {
    if (Array.isArray(arr) && arr.length === 4 && arr.every(n => Number.isFinite(n))) {
      window.circleTableConfig.widths = arr.map(n => Math.max(40, Math.floor(n))); // 最小40px保護
      // 再描画（現在が表表示なら即時反映）
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

  /** 「さらに読み込む」ボタンの表示切替（cards 側が生成する #loadMoreCircles を制御） */
  function toggleLoadMore(show) {
    const btn = document.getElementById("loadMoreCircles");
    if (btn) btn.style.display = show ? "block" : "none";
  }

  /** サブボタンコンテナを #viewControls の直下に常に配置 */
  function ensureSubControls() {
    const controls = $("viewControls");
    let sub = $("subControls");
    if (!sub) {
      sub = document.createElement("div");
      sub.id = "subControls";
    }
    if (controls && controls.parentNode) {
      if (controls.nextSibling !== sub) {
        if (controls.nextSibling) controls.parentNode.insertBefore(sub, controls.nextSibling);
        else controls.parentNode.appendChild(sub);
      }
    } else {
      const list = $("circleList");
      (list?.parentNode || document.body).insertBefore(sub, list || null);
    }
    return sub;
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
  window.compareKana = compareKana; // 他JSからも利用可能に公開

  /** スペース：Aブロック→数値（最初の数値のみ） */
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
   * かな行判定（ローマ字 a/k/s/... 対応）
   * ========================= */

  /**
   * レコード → 行キー（"あ/か/さ/た/な/は/ま/や/ら/わ"）
   * - CAT（企業/委託 など）はここでは扱わない（企業は専用ボタンで cat を優先）
   * - kana がローマ字 1 文字 (a,k,s,t,n,h,m,y,r,w) の場合、それぞれ該当行にマップ
   * - 上記以外は従来どおり、日本語の先頭文字から行判定（フォールバック）
   */
  function rowKeyForRecord(rec) {
    const kanaRaw = (rec?.kana ?? "").toString().trim().toLowerCase();
    // ローマ字 1 文字 → 行キー
    const romanMap = { a: "あ", k: "か", s: "さ", t: "た", n: "な", h: "は", m: "ま", y: "や", r: "ら", w: "わ" };
    if (romanMap[kanaRaw]) return romanMap[kanaRaw];

    // ここからは従来の日本語先頭文字からの判定
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
    return ""; // 判定不能
  }

  /** 先頭1文字を “基底ひらがな” に正規化（濁点/半濁点/小書き/カタカナ対応） */
  function normalizeKanaHead(str) {
    if (!str) return "";
    let s = String(str).trim();
    if (!s) return "";
    let ch = s.charAt(0).normalize("NFKC").normalize("NFKD").replace(/\p{M}+/gu, "");
    const code = ch.charCodeAt(0);
    if (code >= 0x30A1 && code <= 0x30FA) ch = String.fromCharCode(code - 0x60); // カタカナ→ひらがな
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

  function setSubControls(html, onClick, datasetKey = "data-filter") {
    const sub = ensureSubControls();
    sub.innerHTML = html;
    sub.onclick = (ev) => {
      const sel = `[${datasetKey}]`;
      const target = ev.target.closest(sel);
      if (!target) return;
      const key = target.getAttribute(datasetKey);
      onClick?.(key);
      // active 表示
      [...sub.querySelectorAll(sel)].forEach(btn => btn.classList.toggle("active", btn === target));
    };
  }

  /* =========================
   * 各表示モード
   * ========================= */

  // 五十音表示（カード）—「すべて」選択時の並びを修正
// 仕様：あ→か→さ→た→な→は→ま→や→ら→わ の順で結合し、
//       「企業」「委託」は最後にまとめて（一般の後ろに）付ける。
function renderKanaView(initialKey = "あ") {
  window.__currentView = "kana";
  window.__currentFilterKey = initialKey;

  // 全データを50音順でソート（レコード同士の比較は compareKana）
  const baseAll = [...getData()].sort(compareKana);

  // 行ボタン
  const rows = ["あ","か","さ","た","な","は","ま","や","ら","わ"];

  // サブボタン生成：「すべて」を含む（企業ボタンもあり）
  setSubControls(
    `<div class="row-buttons" role="group" aria-label="50音行フィルタ">
      ${rows.map(r => `<button type="button" data-filter="${r}">${r}</button>`).join("")}
      <button type="button" data-filter="corp">企業</button>
      <button type="button" data-filter="all">すべて</button>
    </div>`,
    (key) => {
      window.__currentFilterKey = key;
      const viewData = buildKanaViewData(baseAll, key); // ★ 下のヘルパで構築
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

  // active 表示
  const sub = (document.getElementById("subControls")) || ensureSubControls();
  const initBtn = sub.querySelector(`[data-filter="${initialKey}"]`);
  if (initBtn) initBtn.classList.add("active");

  /**
   * 「すべて」時は 50音行順で一般 → 企業 → 委託 の順に結合
   * 通常の行指定時は該当行のみ、企業指定は cat=企業 のみ。
   */
  function buildKanaViewData(sortedAll, key) {
    // cat 判定（小文字化済みで比較）
    const isCorp   = (d) => getCatLower(d) === "企業";
    const isItaku  = (d) => getCatLower(d) === "委託";

    if (key === "corp") {
      // 企業のみ
      return sortedAll.filter(isCorp);
    }
    if (key === "all") {
      // 1) 一般（企業・委託を除く）を 50音行順で連結
      const general = sortedAll.filter(d => !isCorp(d) && !isItaku(d));
      let mergedGeneral = [];
      rows.forEach(r => {
        // 行キー一致のものを順に追加
        const part = general.filter(d => rowKeyForRecord(d) === r);
        mergedGeneral = mergedGeneral.concat(part);
      });
      // 2) 企業・委託を最後にまとめて付ける（並びは元の compareKana 順）
      const corp  = sortedAll.filter(isCorp);
      const itaku = sortedAll.filter(isItaku);
      return mergedGeneral.concat(corp, itaku);
    }
    // 行指定（あ/か/…/わ）の場合：その行だけ抽出
    return sortedAll.filter(d => rowKeyForRecord(d) === key);
  }
}


  // 表表示（Excel安全：純テキスト表。★ナビ兼フィルタに変更）
  function renderPlainTable(initialKey = "all") {
    window.__currentView = "table";
    window.__currentFilterKey = initialKey;

    // ▼ サブボタン生成（押すとフィルタして再描画）
    setSubControls(
      `<div class="row-buttons" role="group" aria-label="表表示フィルタ">
        <button type="button" data-filter="A">A</button>
        <button type="button" data-filter="B">B</button>
        <button type="button" data-filter="C">C</button>
        <button type="button" data-filter="D">D</button>
        <button type="button" data-filter="E">E</button>
        <button type="button" data-filter="corp">企業</button>
        <button type="button" data-filter="all" class="active">すべて</button>
      </div>`,
      (key) => renderPlainTable(key), // 自身を呼び直して反映
      "data-filter"
    );

    // ▼ データを base に（スペース順で安定ソート）
    const base = [...getData()].sort((a, b) => compareSpaceStr(a.space || "", b.space || ""));

    // ▼ フィルタ適用
    let data = base;
    if (initialKey === "corp") {
      const hasCat = base.some(d => (d.cat ?? d.type ?? "").trim() !== "");
      data = hasCat ? base.filter(d => getCatLower(d) === "企業") : [];
    } else if (["A","B","C","D","E"].includes(initialKey)) {
      const re = new RegExp(`^${initialKey}`, "i");
      data = base.filter(d => re.test(String(d.space || "")));
    } // "all" は全件

    // ▼ コンテナ
    const container = $("circleList");
    if (!container) return;
    container.innerHTML = "";

    // 横スクロールの強制（はみ出し時）
    container.style.overflowX = "auto";
    container.style.webkitOverflowScrolling = "touch";
    if (Number.isFinite(window.circleTableConfig.containerMaxWidth)) {
      container.style.maxWidth = window.circleTableConfig.containerMaxWidth + "px";
      container.style.marginLeft = "auto";
      container.style.marginRight = "auto";
      container.style.paddingLeft = "12px";
      container.style.paddingRight = "12px";
    }

    // ▼ 設定読込
    const cfg = window.circleTableConfig;
    const COLS = (cfg?.widths && cfg.widths.length === 4) ? cfg.widths : defaultTableConfig.widths;
    const sum = COLS.reduce((a,b)=>a+b, 0);
    const totalWidth = (cfg.explicitTotalWidth != null)
      ? cfg.explicitTotalWidth
      : (cfg.forceTotalWidthBySum ? sum : sum); // 現状は合計優先

    // ▼ テーブル生成
    const table = document.createElement("table");
    table.style.tableLayout = "fixed";
    table.style.borderCollapse = "collapse";

    // 総幅固定
    table.style.width = `${totalWidth}px`;
    table.style.minWidth = `${totalWidth}px`;
    table.style.maxWidth = `${totalWidth}px`;

    // 列幅を colgroup で宣言（最優先）
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

    // thead
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

    // tbody
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

    // 反映
    container.appendChild(table);

    // 表表示では「さらに読み込む」は不要
    toggleLoadMore(false);

    // デバッグログ（必要なければ削除OK）
    console.log(`[renderPlainTable] key=${initialKey}, colWidths=${COLS.join(",")}, total=${totalWidth}px`);
  }
  window.renderPlainTable = renderPlainTable; // 他所からも呼べるよう公開

  /* =========================
   * 初期化
   * ========================= */
  document.addEventListener("DOMContentLoaded", async () => {
    const btnKana  = $("sortKana");
    const btnSpace = $("sortSpace");
    const btnTable = $("viewTable");

    await waitForData();
    renderKanaView("あ"); // デフォルト：50音表示（“あ” 行）

    if (btnKana)  btnKana.addEventListener("click", () => renderKanaView("あ"));
    if (btnSpace) btnSpace.addEventListener("click", () => renderSpaceView("A"));
    if (btnTable) btnTable.addEventListener("click", () => renderPlainTable("all"));
  });

})();
