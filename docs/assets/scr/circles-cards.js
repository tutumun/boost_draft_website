// サークル一覧の「カード描画」と「CSVロード」を担当するモジュール
// デザイン仕様：左にサークルカット、右に [サークル名 / スペース / PN / SNS(ファビコン付き)] の縦並び
// ※ HTML/内容は変更しない前提。CSS は site.css 側で定義済み（.circle-list .card など）
// ※ 本ファイルは「カード表示」に必要なマークアップのみ生成する。表表示は circles-view.js の renderTable() 側で実装。

(() => {
  "use strict";

  async function loadCircles() {
    try {
      const res = await fetch("content/circle-list.csv", { cache: "no-store" });
      if (!res.ok) throw new Error("CSV fetch error: " + res.status);
      const text = await res.text();

      const rows = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const data = rows.map((line) => {
        const cells = line.split(",").map((s) => s.trim());
        const [name = "", pn = "", space = "", type = "",
               cut = "", x = "", pixiv = "", booth = "",
               web = "", instagram = "", bluesky = "", tumblr = ""] = cells;
        return { name, pn, space, type, cut, sns: { x, pixiv, booth, web, instagram, bluesky, tumblr } };
      });
      return data;
    } catch (err) {
      console.warn("circle-list.csv の読み込みに失敗しました:", err);
      return [];
    }
  }

  function faviconURL(host, size = 32){
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
  }

  function hostFromUrl(u){
    try { return new URL(u).hostname; } catch { return null; }
  }

  function buildCard(item) {
    const card = document.createElement("div");
    card.className = "card";

    if (item.cut) {
      const img = document.createElement("img");
      img.className = "cut";
      img.alt = `${item.name || "サークル"} カット`;
      img.loading = "lazy";
      img.src = item.cut;
      card.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "cut";
      card.appendChild(ph);
    }

    const info = document.createElement("div");
    info.className = "info";

    const nm = document.createElement("div");
    nm.className = "name";
    nm.textContent = item.name || "";
    info.appendChild(nm);

    const sp = document.createElement("div");
    sp.className = "space";
    sp.textContent = item.space || "";
    info.appendChild(sp);

    const pn = document.createElement("div");
    pn.className = "pn";
    pn.textContent = item.pn || "";
    info.appendChild(pn);

    const snsWrap = document.createElement("div");
    snsWrap.className = "sns";
    const sns = item.sns || {};

    Object.keys(sns).forEach((key) => {
      const url = (sns[key] || "").trim();
      if (!url) return;

      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";

      const host = hostFromUrl(url);
      if (host) {
        const img = document.createElement("img");
        img.className = "favicon";
        img.alt = key;
        img.loading = "lazy";
        img.width = 18; img.height = 18;
        img.src = faviconURL(host, 32);
        a.appendChild(img);
      } else {
        // fallback: テキストリンク
        a.appendChild(document.createTextNode(key));
      }
      snsWrap.appendChild(a);
    });

    info.appendChild(snsWrap);
    card.appendChild(info);

    return card;
  }

  function renderCards(data) {
    const container = document.getElementById("circleList");
    if (!container) return;
    container.innerHTML = "";

    (data || []).forEach((item) => {
      container.appendChild(buildCard(item));
    });
  }

  window.renderCards = renderCards;

  document.addEventListener("DOMContentLoaded", async () => {
    const data = await loadCircles();
    window.circleData = Array.isArray(data) ? data : [];
    renderCards(window.circleData);
  });
})();
