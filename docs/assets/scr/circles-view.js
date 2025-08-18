// circles-view.js
// 50音表示／スペース順表示／表表示 の切替とサブボタン制御
// 仕様概要：
//  - デフォルト表示は「50音表示（kana順）」でカード描画を使用（renderCards）
//  - スペース順表示もカード描画を使用（renderCards）
//  - 表表示は Excel 等にコピペしても崩れない“純テキストのテーブル”を出力（renderTable）
//  - サブボタン：
//      * 50音表示 … 「あ/か/さ/た/な/は/ま/や/ら/わ」「企業」
//      * スペース順表示 … 「A/B/C/D/E」「企業」「委託」
//      * 表表示 … 「A/B/C/D/E」「企業」「すべて」※データは全件のまま（非フィルタ）
//  - 「さらに読み込む」(#loadMoreCircles) はカード表示のみ。フィルタ後の件数が20件以下なら非表示。
//  - 比較関数 compareKana / compareSpaceStr は window に公開（他JSでも利用可）

(() => {
  "use strict";

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
   * サブボタン生成
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

  // 50音表示（カード）
  function renderKanaView(initialKey = "あ") {
    const base = [...getData()].sort(compareKana);
    const rows = ["あ","か","さ","た","な","は","ま","や","ら","わ"];

    setSubControls(
      `<div class="row-buttons" role="group" aria-label="50音行フィルタ">
        ${rows.map(r => `<button type="button" data-filter="${r}">${r}</button>`).join("")}
        <button type="button" data-filter="corp">企業</button>
      </div>`,
      (key) => {
        let data = base;
        if (key === "corp") {
          // 企業は CAT を優先（CAT が無いデータは含めない）
          const hasCat = data.some(d => (d.cat ?? d.type ?? "").trim() !== "");
          data = hasCat ? data.filter(d => getCatLower(d) === "企業") : [];
        } else {
          data = data.filter(d => rowKeyForRecord(d) === key);
        }
        if (typeof window.renderCards === "function") {
          window.renderCards(data);
          // フィルタ件数が 20 以下なら「さらに読み込む」を非表示
          toggleLoadMore(data.length > 20);
        }
      }
    );

    // 初回描画
    const first = base.filter(d => rowKeyForRecord(d) === initialKey);
    if (typeof window.renderCards === "function") {
      window.renderCards(first);
      toggleLoadMore(first.length > 20);
    }
    const sub = ensureSubControls();
    const initBtn = sub.querySelector(`[data-filter="${initialKey}"]`);
    if (initBtn) initBtn.classList.add("active");
  }

  // スペース順表示（カード）
  function renderSpaceView(initialKey = "A") {
    const base = [...getData()].sort((a, b) => compareSpaceStr(a.space || "", b.space || ""));
    const letters = ["A","B","C","D","E"];

    setSubControls(
      `<div class="row-buttons" role="group" aria-label="スペース行フィルタ">
        ${letters.map(L => `<button type="button" data-filter="${L}">${L}</button>`).join("")}
        <button type="button" data-filter="corp">企業</button>
        <button type="button" data-filter="itaku">委託</button>
      </div>`,
      (key) => {
        let data = base;
        if (key === "corp") {
          const hasCat = data.some(d => (d.cat ?? d.type ?? "").trim() !== "");
          data = hasCat ? data.filter(d => getCatLower(d) === "企業") : [];
        } else if (key === "itaku") {
          const hasCat = data.some(d => (d.cat ?? d.type ?? "").trim() !== "");
          data = hasCat ? data.filter(d => getCatLower(d) === "委託") : [];
        } else {
          const re = new RegExp(`^${key}`, "i");
          data = data.filter(d => re.test(String(d.space || "")));
        }
        if (typeof window.renderCards === "function") {
          window.renderCards(data);
          toggleLoadMore(data.length > 20);
        }
      }
    );

    const reInit = new RegExp(`^${initialKey}`, "i");
    const first = base.filter(d => reInit.test(String(d.space || "")));
    if (typeof window.renderCards === "function") {
      window.renderCards(first);
      toggleLoadMore(first.length > 20);
    }
    const sub = ensureSubControls();
    const initBtn = sub.querySelector(`[data-filter="${initialKey}"]`);
    if (initBtn) initBtn.classList.add("active");
  }

  // 表表示（Excel安全：純テキスト表。A/B/C/D/E・企業・すべてボタンは“非フィルタ”のナビ用）
  // ▼ circles-view.js の renderPlainTable をこの版に差し替えてください
  //   目的: 表の各列を 200px 固定にし、CSS ではなく JS 側で <colgroup> を用いて強制
  //   ポイント:
  //     - table に tableLayout: 'fixed'、width: 'auto' を指定
  //     - <colgroup><col style="width:200px">×4 を挿入し、ブラウザの自動レイアウトに勝つ
  //     - 既存の setSubControls / toggleLoadMore / getData / compareSpaceStr は既存の定義を利用
  //
  //   ※ circles-view.js 全体を置き換える必要はなく、この関数のみ差し替えればOK
  //   ※ 将来、% 指定やレスポンシブ化に戻す際は widths 配列を書き換えるだけで対応可
  
  function renderPlainTable() {
    // --- サブボタン（ナビのみ。データはフィルタしない現状仕様のまま） ---
    if (typeof setSubControls === 'function') {
      setSubControls(
        `<div class="row-buttons" role="group" aria-label="表表示ナビ">
          <button type="button" data-nav="A">A</button>
          <button type="button" data-nav="B">B</button>
          <button type="button" data-nav="C">C</button>
          <button type="button" data-nav="D">D</button>
          <button type="button" data-nav="E">E</button>
          <button type="button" data-nav="corp">企業</button>
          <button type="button" data-nav="all" class="active">すべて</button>
        </div>`,
        null,
        'data-nav'
      );
    }
  
    // --- データをスペース順で安定ソート（既存の compareSpaceStr を利用） ---
    const data = Array.isArray(window.circleData) ? window.circleData : [];
    const sorted = [...data].sort((a, b) => (window.compareSpaceStr || ((x,y)=>String(x).localeCompare(String(y)) ))(a.space || '', b.space || ''));
  
    // --- DOM 取得 & クリア ---
    const container = document.getElementById('circleList');
    if (!container) return;
    container.innerHTML = '';
  
    // --- テーブル生成 ---
    const table = document.createElement('table');
    table.style.tableLayout = 'fixed'; // 固定レイアウト: 列幅指定を優先
    table.style.width = 'auto';        // 固定幅にしたいので auto（100%だと%優先されがち）
    table.style.borderCollapse = 'collapse';
  
    // ★ ここが肝: <colgroup> で列幅を 200px 固定にする
    const widths = ['200px', '200px', '200px', '200px'];
    const colgroup = document.createElement('colgroup');
    widths.forEach(w => {
      const col = document.createElement('col');
      col.style.width = w; // ブラウザ実装依存の差を超えて強制しやすい
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);
  
    // --- thead ---
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    ['スペース', 'サークル名', 'PN', '区分'].forEach((txt, i) => {
      const th = document.createElement('th');
      th.textContent = txt;
      // 念のためヘッダ側にも幅を指定（colgroupが効かない環境の保険）
      th.style.width = widths[i];
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
  
    // --- tbody ---
    const tbody = document.createElement('tbody');
    sorted.forEach(d => {
      const tr = document.createElement('tr');
    
      // 1列目: スペース
      const td1 = document.createElement('td');
      td1.textContent = d.space || '';
      td1.style.width = widths[0];
      tr.appendChild(td1);
    
      // 2列目: サークル名
      const td2 = document.createElement('td');
      td2.textContent = d.name || '';
      td2.style.width = widths[1];
      tr.appendChild(td2);
    
      // 3列目: PN
      const td3 = document.createElement('td');
      td3.textContent = d.pn || '';
      td3.style.width = widths[2];
      tr.appendChild(td3);
    
      // 4列目: 区分（cat/type）
      const td4 = document.createElement('td');
      td4.textContent = d.cat || d.type || '';
      td4.style.width = widths[3];
      tr.appendChild(td4);
    
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  
    // --- 反映 ---
    container.appendChild(table);
  
    // 表表示では「さらに読み込む」は不要
    if (typeof toggleLoadMore === 'function') toggleLoadMore(false);
  }

  window.renderPlainTable = renderPlainTable; // 必要に応じて他所から呼べるよう公開

  /* =========================
   * 初期化
   * ========================= */
  document.addEventListener("DOMContentLoaded", async () => {
    const btnKana  = $("sortKana");
    const btnSpace = $("sortSpace");
    const btnTable = $("viewTable");

    // データ到着を待ってから初期表示
    await waitForData();
    renderKanaView("あ"); // デフォルト：50音表示（“あ” 行）

    if (btnKana)  btnKana.addEventListener("click", () => renderKanaView("あ"));
    if (btnSpace) btnSpace.addEventListener("click", () => renderSpaceView("A"));
    if (btnTable) btnTable.addEventListener("click", () => renderPlainTable());
  });

})();
