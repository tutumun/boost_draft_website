// circles-view.js
// 表示切替（50音表示／スペース順表示／表表示）とサブフィルタ（行ボタン）を制御
// 仕様：
//  - デフォルト表示は「50音表示（kana順）」
//  - カード表示は廃止し、テーブル表示（renderTable）で描画
//  - 上段ボタン：#sortKana（50音表示） / #sortSpace（スペース順表示） / #viewTable（表表示）
//  - 下段ボタンコンテナ：#subControls
//  - 50音表示の下段：あ・か・さ・た・な・は・ま・や・ら・わ 各行ボタン + 企業ボタン
//  - スペース順表示の下段：A・B・C・D・E 各ボタン + 企業・委託ボタン
//  - フィルタ優先度：CAT列（cat/type）がある場合は「企業／委託」判定に最優先で使用
//  - データ取得：window.circleData（CSVロード済み想定）
//  - 既存関数を利用：compareKana(a,b), compareSpaceStr(a.space, b.space), renderTable(data)

(() => {
  "use strict";

  /** DOMユーティリティ */
  const $ = (id) => document.getElementById(id);

  /** データ取得（未ロード時の保護） */
  const getData = () => Array.isArray(window.circleData) ? window.circleData : [];

  /** かな順（kana列優先）比較：既存 compareKana を利用（無ければフォールバック） */
  const cmpKana = (a, b) => {
    if (typeof window.compareKana === "function") return window.compareKana(a, b);
    const ka = (a?.kana ?? a?.name ?? "").toString();
    const kb = (b?.kana ?? b?.name ?? "").toString();
    return ka.localeCompare(kb, "ja");
  };

  /** スペース順比較：既存 compareSpaceStr を利用（無ければフォールバック） */
  const cmpSpace = (a, b) => {
    if (typeof window.compareSpaceStr === "function") {
      return window.compareSpaceStr(a.space || "", b.space || "");
    }
    return (a.space || "").localeCompare((b.space || ""), "ja");
  };

  /** カテゴリ（cat/type）取得（小文字正規化） */
  function getCatLower(d) {
    const cat = d?.cat ?? d?.type ?? "";
    return String(cat).trim().toLowerCase();
  }

  // =========================
  //  かな行判定ヘルパ
  // =========================

  /** カタカナ→ひらがな（1文字） */
  function toHiragana1(ch) {
    const code = ch.charCodeAt(0);
    // カタカナ（ァ～ヶ）→ ひらがな（ぁ～ゖ）
    if (code >= 0x30A1 && code <= 0x30F6) return String.fromCharCode(code - 0x60);
    return ch;
  }

  /** 先頭の“基底ひらがな”を取り出す（濁点/小書き/記号を除去してから1文字） */
  function headHiraganaBase(s) {
    if (!s) return "";
    // 文字列化 → 正規化（NFKD分解）→ 結合マーク除去（゙゚など）
    const nfkd = String(s).normalize("NFKD").replace(/\p{M}+/gu, "");
    // カタカナ→ひらがな
    const hira = toHiragana1(nfkd[0] || "");
    // 小書きかなを通常に寄せる
    const SMALL_MAP = { "ぁ":"あ","ぃ":"い","ぅ":"う","ぇ":"え","ぉ":"お","っ":"つ","ゃ":"や","ゅ":"ゆ","ょ":"よ","ゎ":"わ" };
    const ch = SMALL_MAP[hira] || hira;
    return ch;
  }

  /** かな→行キー（あ/か/さ/た/な/は/ま/や/ら/わ）にマップ */
  function kanaRowKeyFromString(kanaOrName) {
    const ch = headHiraganaBase(kanaOrName);
    if (!ch) return "";
    // 行の範囲定義
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
    return ""; // 該当なし
  }

  /** レコード→行キー（kana優先、無ければname） */
  function rowKeyForRecord(rec) {
    const src = (rec?.kana || rec?.name || "").toString();
    return kanaRowKeyFromString(src);
  }

  // =========================
  //  UI生成・フィルタ適用
  // =========================

  /** 下段ボタン（サブコントロール）を設置し、クリック時のハンドラを返す */
  function setSubControls(html, onClick) {
    const sub = $("subControls");
    if (!sub) return;
    sub.innerHTML = html;
    sub.onclick = (ev) => {
      const target = ev.target.closest("[data-filter]");
      if (!target) return;
      const key = target.getAttribute("data-filter");
      onClick?.(key);
      // 選択状態の視覚化（任意）
      [...sub.querySelectorAll("[data-filter]")].forEach(btn => btn.classList.toggle("active", btn === target));
    };
  }

  /** 50音表示（デフォルト表示） */
  function renderKanaView(initialKey = "あ") {
    // 1) ソート
    const base = [...getData()].sort(cmpKana);

    // 2) 下段ボタン：あ行〜わ行 + 企業
    const rows = ["あ","か","さ","た","な","は","ま","や","ら","わ"];
    const subHtml = `
      <div class="row-buttons" role="group" aria-label="50音行フィルタ">
        ${rows.map(r => `<button type="button" data-filter="${r}">${r}</button>`).join("")}
        <button type="button" data-filter="corp">企業</button>
      </div>
    `;
    setSubControls(subHtml, (key) => {
      let data = base;
      if (key === "corp") {
        // CATがある場合のみ企業に絞る（CATが全無なら全件表示）
        const hasCatSome = data.some(d => (d.cat ?? d.type ?? "").trim() !== "");
        data = hasCatSome ? data.filter(d => getCatLower(d) === "企業") : data;
      } else {
        data = data.filter(d => rowKeyForRecord(d) === key);
      }
      if (typeof window.renderTable === "function") window.renderTable(data);
    });

    // 3) 初回レンダリング（指定行で絞る）
    let data = base.filter(d => rowKeyForRecord(d) === initialKey);
    if (typeof window.renderTable === "function") window.renderTable(data);

    // 初期選択の視覚化
    const sub = $("subControls");
    const initBtn = sub?.querySelector(`[data-filter="${initialKey}"]`);
    if (initBtn) initBtn.classList.add("active");
  }

  /** スペース順表示（A〜E 行 + 企業 + 委託） */
  function renderSpaceView(initialKey = "A") {
    // 1) ソート
    const base = [...getData()].sort(cmpSpace);

    // 2) 下段ボタン：A〜E + 企業 + 委託
    const letters = ["A","B","C","D","E"];
    const subHtml = `
      <div class="row-buttons" role="group" aria-label="スペース行フィルタ">
        ${letters.map(L => `<button type="button" data-filter="${L}">${L}</button>`).join("")}
        <button type="button" data-filter="corp">企業</button>
        <button type="button" data-filter="itaku">委託</button>
      </div>
    `;
    setSubControls(subHtml, (key) => {
      let data = base;
      if (key === "corp") {
        const hasCatSome = data.some(d => (d.cat ?? d.type ?? "").trim() !== "");
        data = hasCatSome ? data.filter(d => getCatLower(d) === "企業") : data;
      } else if (key === "itaku") {
        const hasCatSome = data.some(d => (d.cat ?? d.type ?? "").trim() !== "");
        data = hasCatSome ? data.filter(d => getCatLower(d) === "委託") : data;
      } else {
        // 先頭英字一致
        const re = new RegExp(`^${key}`, "i");
        data = data.filter(d => re.test(String(d.space || "")));
      }
      if (typeof window.renderTable === "function") window.renderTable(data);
    });

    // 3) 初回レンダリング（指定レターで絞る）
    const reInit = new RegExp(`^${initialKey}`, "i");
    let data = base.filter(d => reInit.test(String(d.space || "")));
    if (typeof window.renderTable === "function") window.renderTable(data);

    // 初期選択の視覚化
    const sub = $("subControls");
    const initBtn = sub?.querySelector(`[data-filter="${initialKey}"]`);
    if (initBtn) initBtn.classList.add("active");
  }

  /** 表表示（素のテーブル。下段ボタンは消去） */
  function renderPlainTable() {
    const sub = $("subControls");
    if (sub) sub.innerHTML = "";
    if (typeof window.renderTable === "function") {
      window.renderTable(getData());
    }
  }

  /** イベント初期化 */
  document.addEventListener("DOMContentLoaded", () => {
    const btnKana  = $("sortKana");
    const btnSpace = $("sortSpace");
    const btnTable = $("viewTable");

    // デフォルト：50音表示（“あ” 行）
    renderKanaView("あ");

    if (btnKana)  btnKana.addEventListener("click", () => renderKanaView("あ"));
    if (btnSpace) btnSpace.addEventListener("click", () => renderSpaceView("A"));
    if (btnTable) btnTable.addEventListener("click", () => renderPlainTable());
  });

})();
