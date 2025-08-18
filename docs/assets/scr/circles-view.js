// circles-view.js
// 50音表示／スペース順表示／表表示 の切替とサブボタン制御（表表示の不具合修正版）
//
// 修正ポイント：
//  - 表示切替を #viewControls の「イベント委譲」で一元管理（個別バインド漏れを防止）
//  - 「表表示」時は必ず renderTable() を呼び、カード描画は行わない（上書きされない）
//  - 表表示時に A/B/C/D/E・企業・すべて の“ナビ用”ボタンを表示（データは常に全件・space順）
//  - カード用の「さらに読み込む」ボタンは、表表示では必ず非表示にする
//  - 50音フィルタは kana のローマ字 a/k/s/t/n/h/m/y/r/w を行キーにマップ（CAT=企業は専用ボタンで抽出）
//
// 依存：#viewControls, #subControls（なくても自動生成）, #circleList
//       window.renderCards, window.renderTable, window.circleData（CSVロード済み）
//       circles-cards.js 側で #loadMoreCircles を生成している想定

(() => {
  "use strict";

  /* =========================
   * ユーティリティ
   * ========================= */

  const $ = (id) => document.getElementById(id);
  const getData = () => Array.isArray(window.circleData) ? window.circleData : [];

  /** 初期データ到着を待つ（最大5秒） */
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

  /** 「さらに読み込む」ボタンの表示切替（表表示では常に非表示） */
  function toggleLoadMore(show) {
    const btn = document.getElementById("loadMoreCircles");
    if (btn) btn.style.display = show ? "block" : "none";
  }

  /** サブボタンのコンテナを #viewControls 直下に常に配置 */
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

  function compareKana(a, b) {
    const collator = new Intl.Collator("ja", { usage: "sort", sensitivity: "base", ignorePunctuation: true });
    const ka = (a?.kana ?? a?.name ?? "").toString();
    const kb = (b?.kana ?? b?.name ?? "").toString();
    return collator.compare(ka, kb);
  }
  window.compareKana = compareKana;

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
   * 行判定（ローマ字 a/k/s/... 対応）
   * ========================= */

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

  function rowKeyForRecord(rec) {
    const kanaRaw = (rec?.kana ?? "").toString().trim().toLowerCase();
    const romanMap = { a:"あ", k:"か", s:"さ", t:"た", n:"な", h:"は", m:"ま", y:"や", r:"ら", w:"わ" };
    if (romanMap[kanaRaw]) return romanMap[kanaRaw];

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
    for (const [row, chars] of Object.entries(ROWS)) if (chars.includes(ch)) return row;
    return "";
  }

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
      [...sub.querySelectorAll(sel)].forEach(btn => btn.classList.toggle("active", btn === target));
    };
  }

  /* =========================
   * 各表示モード
   * ========================= */

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
          const hasCat = data.some(d => (d.cat ?? d.type ?? "").trim() !== "");
          data = hasCat ? data.filter(d => getCatLower(d) === "企業") : [];
        } else {
          data = data.filter(d => rowKeyForRecord(d) === key);
        }
        if (typeof window.renderCards === "function") {
          window.renderCards(data);
          toggleLoadMore(data.length > 20);
        }
      }
    );

    const first = base.filter(d => rowKeyForRecord(d) === initialKey);
    if (typeof window.renderCards === "function") {
      window.renderCards(first);
      toggleLoadMore(first.length > 20);
    }
    const sub = ensureSubControls();
    sub.querySelector(`[data-filter="${initialKey}"]`)?.classList.add("active");
  }

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
    sub.querySelector(`[data-filter="${initialKey}"]`)?.classList.add("active");
  }

  /** 表表示（Excel安全：純テキスト表。A/B/C/D/E・企業・すべてボタンは“ナビ用”で非フィルタ） */
/* =========================
 * 表表示（Excel安全・純テキスト表）
 *  - A〜E／企業／すべて の各ボタンで“表データをフィルタ”して再描画
 *  - 表モード中はカード描画を行わない（state.mode === "table"）
 * ========================= */
function renderPlainTable() {
  state.mode = "table";          // ← 表モードに固定（他からの renderCards 呼出しをブロック）
  toggleLoadMore(false);         // 表では「さらに読み込む」を隠す

  // ▼サブボタン（押すとフィルタして再描画）
  setSubControls(
    `<div class="row-buttons" role="group" aria-label="表表示フィルタ">
      <button type="button" data-nav="all"  class="active">すべて</button>
      <button type="button" data-nav="A">A</button>
      <button type="button" data-nav="B">B</button>
      <button type="button" data-nav="C">C</button>
      <button type="button" data-nav="D">D</button>
      <button type="button" data-nav="E">E</button>
      <button type="button" data-nav="corp">企業</button>
    </div>`,
    (key) => {
      // クリック時：キーに応じて配列を作りなおし、表を再描画
      const filtered = makeTableDataset(key);
      renderTablePure(filtered);
    },
    "data-nav"
  );

  // ▼初回描画：全件（space順）
  const initial = makeTableDataset("all");
  renderTablePure(initial);
}

/* -------------------------------------------
 * 表用データ生成：key に応じて配列をフィルタ＆space順でソート
 * key: "all" | "A"|"B"|"C"|"D"|"E" | "corp"
 *  - "all" : 全件
 *  - A〜E   : space 先頭レター一致（例: "A-01" など）
 *  - "corp" : cat(またはtype) が "企業"
 * ------------------------------------------- */
function makeTableDataset(key) {
  const base = [...getData()].sort((a, b) => compareSpaceStr(a.space || "", b.space || ""));
  if (key === "all") return base;

  if (key === "corp") {
    // CAT優先で企業のみ
    return base.filter(d => (d.cat ?? d.type ?? "").toString().trim().toLowerCase() === "企業");
  }

  // A〜E の先頭一致
  const re = new RegExp(`^${key}`, "i");
  return base.filter(d => re.test(String(d.space || "")));
}

/* -------------------------------------------
 * 純テキストの表を #circleList に出力
 * （Excelにコピペして崩れないよう装飾は入れない）
 * ------------------------------------------- */
function renderTablePure(rows) {
  const container = document.getElementById("circleList");
  if (!container) return;
  container.innerHTML = "";

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>スペース</th><th>サークル名</th><th>PN</th><th>区分</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  (rows || []).forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d.space || ""}</td>
      <td>${d.name || ""}</td>
      <td>${d.pn || ""}</td>
      <td>${d.cat || d.type || ""}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  container.appendChild(table);
}

  window.renderPlainTable = renderPlainTable;

  /* =========================
   * 初期化（イベント委譲で安定化）
   * ========================= */
  document.addEventListener("DOMContentLoaded", async () => {
    await waitForData();

    // デフォルト：50音表示（“あ” 行）
    renderKanaView("あ");

    // 切替は #viewControls のイベント委譲で一元化
    const controls = $("viewControls");
    if (controls) {
      controls.addEventListener("click", (ev) => {
        const btn = ev.target.closest("button");
        if (!btn) return;

        if (btn.id === "sortKana")       renderKanaView("あ");
        else if (btn.id === "sortSpace") renderSpaceView("A");
        else if (btn.id === "viewTable") renderPlainTable();
      });
    }
  });

})();
