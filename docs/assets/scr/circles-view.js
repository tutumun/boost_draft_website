// 表示切替とソート処理（分割前の挙動に等価）
// - デザイン・HTML構造・文言は変更しない前提。
// - index.html 内のボタンIDと #circleList を前提に、表示の切替と並べ替えのみを担当。
// - カード描画は circles-cards.js の renderCards() を利用（本ファイルでは再定義しない）。

(() => {
  "use strict";

  /**
   * 表形式で描画する（分割前のテーブル表示と等価な最小実装）。
   * @param {{name:string,pn:string,space:string,type:string}[]} data
   */
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
      tr.innerHTML = `<td>${d.space || ""}</td><td>${d.name || ""}</td><td>${d.pn || ""}</td><td>${d.type || ""}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    container.appendChild(table);
  }

  // グローバルへ公開（必要に応じて他JSから呼べるように）
  window.renderTable = renderTable;

  // DOM 構築後にイベントを紐付け
  document.addEventListener("DOMContentLoaded", () => {
    const $ = (id) => document.getElementById(id);

    const btnCards = $("viewCards");
    const btnTable = $("viewTable");
    const btnKana  = $("sortKana");
    const btnSpace = $("sortSpace");

    const getData = () => Array.isArray(window.circleData) ? window.circleData : [];

    // カード表示（circles-cards.js に定義済みの renderCards を使用）
    if (btnCards) {
      btnCards.addEventListener("click", () => {
        if (typeof window.renderCards === "function") {
          window.renderCards(getData());
        }
      });
    }

    // 表表示
    if (btnTable) {
      btnTable.addEventListener("click", () => renderTable(getData()));
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

    // スペース順（島-番号）
    if (btnSpace) {
      btnSpace.addEventListener("click", () => {
        const sorted = [...getData()].sort((a, b) => (a.space || "").localeCompare(b.space || "", "ja"));
        if (typeof window.renderCards === "function") {
          window.renderCards(sorted);
        }
      });
    }
  });
})();
