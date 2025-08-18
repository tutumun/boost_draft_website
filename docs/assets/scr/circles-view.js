// 表示切替とソート処理（分割前の挙動に等価）
// - デザイン・HTML構造・文言は変更しない前提。
// - index.html 内のボタンIDと #circleList を前提に、表示の切替と並べ替えのみを担当。
// - カード描画は circles-cards.js の renderCards() を利用（本ファイルでは再定義しない）。

(() => {
  "use strict";

  // スペース番号比較関数（改定版）
  // ・ブロック文字（A, B, C …）と数値部分を分けて比較
  // ・「A-01」と「A-1」は同等とみなす
  // ・「A-41・42」のように区切られている場合は最初の数値のみを利用
  function compareSpaceStr(a, b) {
    const regex = /^([A-Z]+)-?(\d+)/i;
  
    const ma = a.match(regex);
    const mb = b.match(regex);
  
    if (ma && mb) {
      const blockA = ma[1].toUpperCase();
      const blockB = mb[1].toUpperCase();
    
      // ブロック文字で比較
      if (blockA !== blockB) {
        return blockA.localeCompare(blockB, 'ja');
      }
    
      // 数値部分を数値化して比較（最初の数値のみ）
      const numA = parseInt(ma[2], 10);
      const numB = parseInt(mb[2], 10);
      return numA - numB;
    }
  
    // フォーマット外は通常の文字列比較
    return a.localeCompare(b, 'ja');
  }

  // ▼追加：かな順（kana優先）比較関数
  // - CSVの kana 列があれば優先し、なければ name を利用
  // - Intl.Collator('ja') で日本語の並び替えに最適化
  function compareKana(a, b) {
    const collator = new Intl.Collator('ja', { usage: 'sort', sensitivity: 'base', ignorePunctuation: true });
    const ka = (a?.kana ?? a?.name ?? '').toString();
    const kb = (b?.kana ?? b?.name ?? '').toString();
    return collator.compare(ka, kb);
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

    // 五十音順（kana優先）
    if (btnKana) {
      btnKana.addEventListener("click", () => {
        const sorted = [...getData()].sort((a, b) => compareKana(a, b));
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
