// circles-view.js
// 50音表示／スペース順表示／表表示の切替とサブボタン制御
// 修正点：
//  - サブボタン（あ〜わ / A〜E・企業・委託）を #viewControls 直下に必ず表示
//  - 50音・スペース順の表示は「カード表示（renderCards）」を使用（表表示は viewTable のときのみ）
//  - フィルタ時、kana/space から行判定できないデータは “除外せず含める” 振る舞いに変更（表示件数が極端に減る不具合を回避）
//  - さらに読み込むボタン（#loadMoreCircles）の表示/非表示をモードに応じて制御

(() => {
  "use strict";

  /* ========== ユーティリティ ========== */
  const $ = (id) => document.getElementById(id);
  const getData = () => Array.isArray(window.circleData) ? window.circleData : [];

  // 「さらに読み込む」ボタンの表示切替（cards側で id="loadMoreCircles" を生成している想定）
  function toggleLoadMore(show) {
    const btn = document.getElementById("loadMoreCircles");
    if (btn) btn.style.display = show ? "block" : "none";
  }

  // サブボタンのコンテナを #viewControls の直下に必ず配置
  function ensureSubControls() {
    const controls = $("viewControls");
    let sub = $("subControls");
    if (!sub) {
      sub = document.createElement("div");
      sub.id = "subControls";
      if (controls && controls.parentNode) {
        // #viewControls の直後に差し込む
        if (controls.nextSibling) controls.parentNode.insertBefore(sub, controls.nextSibling);
        else controls.parentNode.appendChild(sub);
      } else {
        // 念のためのフォールバック
        const list = $("circleList");
        (list?.parentNode || document.body).insertBefore(sub, list || null);
      }
    } else if (controls && sub.previousElementSibling !== controls) {
      // 既に存在しても #viewControls の直下へ移動
      controls.parentNode.insertBefore(sub, controls.nextSibling);
    }
    return sub;
  }

  /* ========== 比較関数（他JSでも使えるよう公開） ========== */

  // かな順（kana優先）。なければ name を使用
  function compareKana(a, b) {
    const collator = new Intl.Collator("ja", { usage: "sort", sensitivity: "base", ignorePunctuation: true });
    const ka = (a?.kana ?? a?.name ?? "").toString();
    const kb = (b?.kana ?? b?.name ?? "").toString();
    return collator.compare(ka, kb);
  }
  window.compareKana = compareKana;

  // スペース比較（Aブロック→数値。最初の数値のみ）
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
  window.compareSpaceStr = compareSpaceStr;

  /* ========== かな行判定ヘルパ ========== */

  // 先頭1文字を “基底ひらがな” に正規化（濁点/半濁点/小書き/カタカナ対応）
  function normalizeKanaHead(s) {
    if (!s) return "";
    const head = String(s).trim().charAt(0) || "";
    if (!head) return "";
    let ch = head.normalize("NFKD").replace(/\p{M}+/gu, ""); // 結合記号削除
    const code = ch.charCodeAt(0); // カタカナ→ひらがな
    if (code >= 0x30A1 && code <= 0x30F6) ch = String.fromCharCode(code - 0x60);
    const SMALL = {"ぁ":"あ","ぃ":"い","ぅ":"う","ぇ":"え","ぉ":"お","っ":"つ","ゃ":"や","ゅ":"ゆ","ょ":"よ","ゎ":"わ"};
    return SMALL[ch] || ch;
  }

// ▼修正：rowKeyForRecord をローマ字コード対応に
// kana に a,k,s,t,n,h,m,y,r,w,kigyou が入っているケースを想定し、
// a→あ行, k→か行… w→わ行, kigyou→"corp"（企業フィルタ用の特別キー）にマップする。
// それ以外は従来どおり「先頭文字から行判定（かな優先, 名前フォールバック）」で対応。
function rowKeyForRecord(rec) {
  const kanaRaw = (rec?.kana ?? "").toString().trim().toLowerCase();
  const romanMap = {
    a: "あ", k: "か", s: "さ", t: "た", n: "な",
    h: "は", m: "ま", y: "や", r: "ら", w: "わ",
    kigyou: "corp" // 企業専用キー（ボタン側の data-filter="corp" と連動）
  };
  if (romanMap[kanaRaw]) return romanMap[kanaRaw];

  // ▼ローマ字コードでなければ、従来の日本語先頭文字で判定
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

  // CAT/type（小文字）
  function getCatLower(d) {
    const cat = d?.cat ?? d?.type ?? "";
    return String(cat).trim().toLowerCase();
  }

  /* ========== 下段ボタン（サブコントロール） ========== */

  function setSubControls(html, onClick) {
    const sub = ensureSubControls();
    sub.innerHTML = html;
    sub.onclick = (ev) => {
      const target = ev.target.closest("[data-filter]");
      if (!target) return;
      const key = target.getAttribute("data-filter");
      onClick?.(key);
      // 視覚的アクティブ
      [...sub.querySelectorAll("[data-filter]")].forEach(btn => btn.classList.toggle("active", btn === target));
    };
  }

  /* ========== 各表示モード ========== */

  // 50音表示（カード描画）
  function renderKanaView(initialKey = "あ") {
    const base = [...getData()].sort(compareKana);

    // 下段ボタン：あ〜わ + 企業
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
          // 判定できないデータは “除外しない” 方針（表示減少バグ対策）
          data = data.filter(d => {
            const row = rowKeyForRecord(d);
            return (row === key) || (row === "");
          });
        }
        if (typeof window.renderCards === "function") {
          window.renderCards(data);
          toggleLoadMore(true);
        }
      }
    );

    // 初回描画（指定行 + 判定不能を含める）
    let data = base.filter(d => {
      const row = rowKeyForRecord(d);
      return (row === initialKey) || (row === "");
    });
    if (typeof window.renderCards === "function") {
      window.renderCards(data);
      toggleLoadMore(true);
    }

    // 初期選択のアクティブ表示
    const sub = ensureSubControls();
    const initBtn = sub.querySelector(`[data-filter="${initialKey}"]`);
    if (initBtn) initBtn.classList.add("active");
  }

  // スペース順表示（カード描画）
  function renderSpaceView(initialKey = "A") {
    const base = [...getData()].sort((a, b) => compareSpaceStr(a.space || "", b.space || ""));

    // 下段ボタン：A〜E + 企業 + 委託
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
          // space 判定できない（空など）データは “除外しない”
          data = data.filter(d => re.test(String(d.space || "")) || !String(d.space || "").trim());
        }
        if (typeof window.renderCards === "function") {
          window.renderCards(data);
          toggleLoadMore(true);
        }
      }
    );

    // 初回描画（該当レター + space未設定も含む）
    const reInit = new RegExp(`^${initialKey}`, "i");
    let data = base.filter(d => reInit.test(String(d.space || "")) || !String(d.space || "").trim());
    if (typeof window.renderCards === "function") {
      window.renderCards(data);
      toggleLoadMore(true);
    }

    // 初期選択のアクティブ表示
    const sub = ensureSubControls();
    const initBtn = sub.querySelector(`[data-filter="${initialKey}"]`);
    if (initBtn) initBtn.classList.add("active");
  }

  // 表表示（全件／サブボタン無し）
  function renderPlainTable() {
    const sub = ensureSubControls();
    sub.innerHTML = "";
    if (typeof window.renderTable === "function") {
      window.renderTable(getData());
      toggleLoadMore(false);
    }
  }

  /* ========== 初期化（デフォルト 50音 “あ” 行） ========== */
  document.addEventListener("DOMContentLoaded", () => {
    const btnKana  = $("sortKana");
    const btnSpace = $("sortSpace");
    const btnTable = $("viewTable");

    // 最初は 50音表示
    renderKanaView("あ");

    if (btnKana)  btnKana.addEventListener("click", () => renderKanaView("あ"));
    if (btnSpace) btnSpace.addEventListener("click", () => renderSpaceView("A"));
    if (btnTable) btnTable.addEventListener("click", () => renderPlainTable());
  });

})();
