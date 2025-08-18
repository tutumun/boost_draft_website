// 表示切替とソート処理（分割前の挙動に等価）
// - デザイン・HTML構造・文言は変更しない前提。
// - index.html 内のボタンIDと #circleList を前提に、表示の切替と並べ替えのみを担当。
// - カード描画は circles-cards.js の renderCards() を利用（本ファイルでは再定義しない）。

(() => {
  "use strict";

  /**
   * スペース番号の比較関数（例: "A-01", "A-1", "A-21"）
   * - 文字列比較ではなく、ブロック文字（A/B/C…）＋数値として比較する
   * - "A-01" と "A-1" は同値として扱う
   * - 想定外の文字列は最後に回す（元の文字列で比較）
   */
  function compareSpaceStr(a, b) {
    const pa = parseSpace(a);
    const pb = parseSpace(b);

    // どちらも正規にパースできた場合：ブロック→数値の順に比較
    if (pa.valid && pb.valid) {
      if (pa.block !== pb.block) {
        // ブロックは文字比較（日本語も想定して localeCompare）
        return pa.block.localeCompare(pb.block, "ja");
      }
      // 同一ブロックなら数値昇順
      if (pa.num !== pb.num) return pa.num - pb.num;
      // 同値なら元文字列の長さ（ゼロパディング有無）で安定ソート
      return a.length - b.length;
    }

    // 片方だけ正規：正規にパースできた方を先に
    if (pa.valid && !pb.valid) return -1;
    if (!pa.valid && pb.valid) return 1;

    // 両方とも非正規：素の文字列で比較（末尾に押しやる）
    return (a || "").localeCompare(b || "", "ja");
  }

  /**
   * スペース番号を { valid, block, num } に分解
   * - ブロック: 先頭の英字（A, B, C...）を大文字化（"AA" など複数文字も許容）
   * - 数値: 末尾の連続数字を10進で取得（先頭ゼロは無視）
   * - 例: "A-01" → { valid:true, block:"A", num:1 }
   *       "b12"  → { valid:true, block:"B", num:12 }
   *       "企業-02" → { valid:false, ... } ※想定外は非正規
   */
  function parseSpace(s) {
    if (!s) return { valid: false, block: "", num: Number.POSITIVE_INFINITY };
    const str = String(s).trim();

    // パターン1: 英字 + 任意のハイフン/空白 + 数字
    //   例: "A-01", "A01", "AA-7"
    const m = str.match(/^([A-Za-z]+)[\s\-]*?(\d+)$/);
    if (m) {
      return {
        valid: true,
        block: m[1].toUpperCase(),
        num: parseInt(m[2], 10)
      };
    }

    // パターン2: 先に数字、後ろにブロック等が付くなどは非対応 → 非正規
    return { valid: false, block: "", num: Number.POSITIVE_INFINITY };
  }

  /** ユーティリティ：DOM取得の短縮 */
  const $ = (id) => document.getElementById(id);

  /** 現在保持しているデータ（circles-cards.js が設定）を取得 */
  const getData = () => Array.isArray(window.circleData) ? window.circleData : [];

  // DOM 構築後にイベントを紐付け
  document.addEventListener("DOMContentLoaded", () => {
    const btnCards = $("viewCards");
    const btnTable = $("viewTable");
    const btnKana  = $("sortKana");
    const btnSpace = $("sortSpace");

    // カード表示（circles-cards.js に定義済みの renderCards を使用）
    if (btnCards) {
      btnCards.addEventListener("click", () => {
        if (typeof window.renderCards === "function") {
          window.renderCards(getData());
        }
      });
    }

    // 表表示（本ファイルで用意した renderTable を使用）
    if (btnTable) {
      btnTable.addEventListener("click", () => {
        if (typeof window.renderTable === "function") {
          window.renderTable(getData());
        }
      });
    }

    // 五十音順（サークル名）
    if (btnKana) {
      btnKana.addEventListener("click", () => {
        const sorted = [...getData()].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));
        if (typeof window.renderCards === "function") {
          window.renderCards(sorted);
        }
      });
    }

    // スペース順（ブロック→数値の昇順で安定ソート）
    if (btnSpace) {
      btnSpace.addEventListener("click", () => {
        const sorted = [...getData()].sort((a, b) => compareSpaceStr(a.space || "", b.space || ""));
        if (typeof window.renderCards === "function") {
          window.renderCards(sorted);
        }
      });
    }
  });

  /* ==========================================================
   * 表表示（最小実装）
   *  - 分割前のテーブル表示と等価な見た目を維持
   *  - CSS は #circleList table のスタイルを使用
   * ========================================================== */
  function renderTable(data) {
    const container = document.getElementById("circleList");
    if (!container) return; // 念のため防御
    container.innerHTML = "";

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>スペース</th><th>サークル名</th><th>PN</th><th>区分</th></tr>";
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    (data || []).forEach((d) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${d.space || ""}</td><td>${d.name || ""}</td><td>${d.pn || ""}</td><td>${d.cat || d.type || ""}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    container.appendChild(table);
  }

  // グローバルへ公開（他JSから呼べるように）
  window.renderTable = renderTable;
})();
