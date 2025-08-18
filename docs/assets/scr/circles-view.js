// circles-view.js
// 表示切替（50音表示／スペース順表示／表表示）とサブフィルタ（行ボタン）を制御
// 仕様：
//  - デフォルト表示は「50音表示（kana順）」
//  - カード表示は廃止し、テーブル表示（renderTable）で描画
//  - 上段ボタン：#sortKana（50音表示） / #sortSpace（スペース順表示） / #viewTable（表表示）
//  - 下段ボタンコンテナ：#subControls（無ければ自動生成）
//  - 50音表示の下段：あ・か・さ・た・な・は・ま・や・ら・わ 各行ボタン + 企業ボタン
//  - スペース順表示の下段：A・B・C・D・E 各ボタン + 企業・委託ボタン
//  - フィルタ優先度：CAT列（cat/type）がある場合は「企業／委託」判定に最優先で使用
//  - データ取得：window.circleData（circles-cards.js 等で CSV ロード済み想定）
//  - compareKana / compareSpaceStr / renderTable は本ファイルで定義・window公開（他ファイルからも利用可）

(() => {
  "use strict";

  /* =========================
   * ユーティリティ
   * ========================= */

  /** id で要素取得 */
  const $ = (id) => document.getElementById(id);

  /** サブコントロールのコンテナを確実に用意（無ければ生成） */
  function ensureSubControls() {
    let sub = $("subControls");
    if (!sub) {
      sub = document.createElement("div");
      sub.id = "subControls";
      const controls = $("viewControls");
      if (controls && controls.nextSibling) {
        controls.parentNode.insertBefore(sub, controls.nextSibling);
      } else if (controls) {
        controls.parentNode.appendChild(sub);
      } else {
        const list = $("circleList");
        if (list && list.parentNode) list.parentNode.insertBefore(sub, list);
        else document.body.appendChild(sub);
      }
    }
    return sub;
  }

  /** データ取得（未ロード時は空配列） */
  const getData = () => Array.isArray(window.circleData) ? window.circleData : [];

  /** 非同期に circleData の到着を待つ（最大 5 秒） */
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

  /* =========================
   * 比較関数（window へ公開）
   * ========================= */

  /** kana優先の“かな順”比較（Intl.Collator で日本語ソート） */
  function compareKana(a, b) {
    const collator = new Intl.Collator("ja", { usage: "sort", sensitivity: "base", ignorePunctuation: true });
    const ka = (a?.kana ?? a?.name ?? "").toString();
    const kb = (b?.kana ?? b?.name ?? "").toString();
    return collator.compare(ka, kb);
  }
  window.compareKana = compareKana; // 他から利用できるよう公開

  /** スペース文字列比較（Aブロック→数値。最初の数値のみ比較） */
  function compareSpaceStr(a, b) {
    const regex = /^([A-Z]+)-?(\d+)/i;
    const ma = String(a||"").match(regex);
    const mb = String(b||"").match(regex);
    if (ma && mb) {
      const blockA = ma[1].toUpperCase();
      const blockB = mb[1].toUpperCase();
      if (blockA !== blockB) return blockA.localeCompare(blockB, "ja");
      return parseInt(ma[2], 10) - parseInt(mb[2], 10);
    }
    return String(a||"").localeCompare(String(b||""), "ja");
  }
  window.compareSpaceStr = compareSpaceStr;

  /* =========================
   * かな行判定ヘルパ（50音行フィルタ用）
   * ========================= */

  /** 先頭1文字の“基底ひらがな”を取り出す（濁点/半濁点/小書き/カタカナを正規化） */
  function normalizeKanaHead(s) {
    if (!s) return "";
    const head = String(s).trim().charAt(0) || "";
    if (!head) return "";
    // NFKD 分解して結合記号を除去
    let ch = head.normalize("NFKD").replace(/\p{M}+/gu, "");
    // カタカナ → ひらがな
    const code = ch.charCodeAt(0);
    if (code >= 0x30A1 && code <= 0x30F6) ch = String.fromCharCode(code - 0x60);
    // 小書きの正規化
    const SMALL = {"ぁ":"あ","ぃ":"い","ぅ":"う","ぇ":"え","ぉ":"お","っ":"つ","ゃ":"や","ゅ":"ゆ","ょ":"よ","ゎ":"わ"};
    return SMALL[ch] || ch;
  }

  /** レコード→かな行キー（"あ/か/さ/た/な/は/ま/や/ら/わ"） */
  function rowKeyForRecord(rec) {
    const src = (rec?.kana || rec?.name || "").toString();
    const ch = normalizeKanaHead(src);
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

  /** カテゴリ（cat/type）取得（小文字正規化） */
  function getCatLower(d) {
    const cat = d?.cat ?? d?.type ?? "";
    return String(cat).trim().toLowerCase();
  }

  /* =========================
   * 表描画（フォールバック定義）
   * ========================= */

  if (typeof window.renderTable !== "function") {
    /** 最小実装の表描画（renderTable が未定義の場合のみ定義） */
    window.renderTable = function renderTable(data) {
      const container = $("circleList");
      if (!container) return;
      container.innerHTML = "";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      thead.innerHTML = "<tr><th>スペース</th><th>サークル名</th><th>PN</th><th>区分</th></tr>";
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      (data||[]).forEach(d => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${d.space||""}</td><td>${d.name||""}</td><td>${d.pn||""}</td><td>${d.cat||d.type||""}</td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      container.appendChild(table);
    };
  }

  /* =========================
   * 下段ボタン生成＆イベント
   * ========================= */

  /** 下段ボタン（サブコントロール）を設置し、クリック時のハンドラを設定 */
  function setSubControls(html, onClick) {
    const sub = ensureSubControls();
    sub.innerHTML = html;
    sub.onclick = (ev) => {
      const target = ev.target.closest("[data-filter]");
      if (!target) return;
      const key = target.getAttribute("data-filter");
      onClick?.(key);
      // 視覚的にアクティブ表示
      [...sub.querySelectorAll("[data-filter]")].forEach(btn => btn.classList.toggle("active", btn === target));
    };
  }

  /* =========================
   * 各表示モード
   * ========================= */

  /** 50音表示（あ/か/…/わ + 企業） */
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
          data = hasCat ? data.filter(d => getCatLower(d) === "企業") : data;
        } else {
          data = data.filter(d => rowKeyForRecord(d) === key);
        }
        window.renderTable(data);
      }
    );
    // 初回描画
    let data = base.filter(d => rowKeyForRecord(d) === initialKey);
    window.renderTable(data);
    // 初期選択の視覚化
    const sub = ensureSubControls();
    const initBtn = sub.querySelector(`[data-filter="${initialKey}"]`);
    if (initBtn) initBtn.classList.add("active");
  }

  /** スペース順表示（A〜E + 企業 + 委託） */
  function renderSpaceView(initialKey = "A") {
    const base = [...getData()].sort((a,b) => compareSpaceStr(a.space||"", b.space||""));
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
          data = hasCat ? data.filter(d => getCatLower(d) === "企業") : data;
        } else if (key === "itaku") {
          const hasCat = data.some(d => (d.cat ?? d.type ?? "").trim() !== "");
          data = hasCat ? data.filter(d => getCatLower(d) === "委託") : data;
        } else {
          const re = new RegExp(`^${key}`, "i");
          data = data.filter(d => re.test(String(d.space||"")));
        }
        window.renderTable(data);
      }
    );
    // 初回描画
    const reInit = new RegExp(`^${initialKey}`, "i");
    let data = base.filter(d => reInit.test(String(d.space||"")));
    window.renderTable(data);
    const sub = ensureSubControls();
    const initBtn = sub.querySelector(`[data-filter="${initialKey}"]`);
    if (initBtn) initBtn.classList.add("active");
  }

  /** 表表示（全件・下段ボタン無し） */
  function renderPlainTable() {
    const sub = ensureSubControls();
    sub.innerHTML = "";
    window.renderTable(getData());
  }

  /* =========================
   * 初期化（イベント登録 & デフォルト表示）
   * ========================= */
  document.addEventListener("DOMContentLoaded", async () => {
    const btnKana  = $("sortKana");
    const btnSpace = $("sortSpace");
    const btnTable = $("viewTable");

    // データ到着を待ってから初期描画
    await waitForData();

    // デフォルト：50音表示（“あ” 行）
    renderKanaView("あ");

    if (btnKana)  btnKana.addEventListener("click", () => renderKanaView("あ"));
    if (btnSpace) btnSpace.addEventListener("click", () => renderSpaceView("A"));
    if (btnTable) btnTable.addEventListener("click", () => renderPlainTable());
  });

})();
