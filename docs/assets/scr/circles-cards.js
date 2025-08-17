// サークル一覧の「カード描画」と「CSVロード」を担当するモジュール
// デザイン仕様：左にサークルカット、右に [サークル名 / スペース / PN / SNS(ファビコン付き)] の縦並び
// ※ HTML/内容は変更しない前提。CSS は site.css 側で定義済み（.circle-list .card など）
// ※ 本ファイルは「カード表示」に必要なマークアップのみ生成する。表表示は circles-view.js の renderTable() 側で実装。

(() => {
  "use strict";

  /**
   * CSV を読み込んで配列データ化します。
   * 期待カラム（ヘッダー無し）：
   *   0: サークル名 (name)
   *   1: PN          (pn)
   *   2: スペース    (space)
   *   3: 区分        (type)
   * 以降は任意（存在すれば利用）：
   *   4: サークルカット画像パス (cut) 例: assets/img/circles/alpha.jpg
   *   5: X/Twitter URL
   *   6: pixiv URL
   *   7: BOOTH URL
   *   8: Web/Blog URL
   *   9: Instagram URL
   *  10: Bluesky URL
   *  11: Tumblr URL
   * …不足していても可（存在する分だけアイコン表示）。
   */
  async function loadCircles() {
    try {
      const res = await fetch("content/circle-list.csv", { cache: "no-store" });
      if (!res.ok) throw new Error("CSV fetch error: " + res.status);
      const text = await res.text();

      // 行ごとに分割（空行を除外）。引用やカンマを厳密に扱う必要があれば CSV パーサ導入を検討。
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
      // 失敗時は空配列を返す（UI は空表示）。必要ならデモ用データをここで返すことも可。
      return [];
    }
  }

  /**
   * SNSリンクのアイコン画像パスを返す（存在しないキーは undefined）。
   * アイコン画像は `assets/img/icons/` 配下想定（SVG/PNG どちらでも可）。
   */
  function iconFor(service) {
    const base = "assets/img/icons"; // 例: x.svg, pixiv.svg, booth.svg, web.svg, instagram.svg, bluesky.svg, tumblr.svg
    const map = {
      x: `${base}/x.svg`,
      pixiv: `${base}/pixiv.svg`,
      booth: `${base}/booth.svg`,
      web: `${base}/web.svg`,
      instagram: `${base}/instagram.svg`,
      bluesky: `${base}/bluesky.svg`,
      tumblr: `${base}/tumblr.svg`,
    };
    return map[service];
  }

  /**
   * カード1枚分の DOM を生成
   * @param {{name:string,pn:string,space:string,type?:string,cut?:string,sns?:Record<string,string>}} item
   */
  function buildCard(item) {
    const card = document.createElement("div");
    card.className = "card";

    // 左：サークルカット（任意）
    if (item.cut) {
      const img = document.createElement("img");
      img.className = "cut";
      img.alt = `${item.name || "サークル"} カット`;
      img.loading = "lazy";
      img.src = item.cut;
      card.appendChild(img);
    } else {
      // カットが未指定なら、見た目を崩さないよう空のプレースホルダーを挿入
      const ph = document.createElement("div");
      ph.className = "cut";
      card.appendChild(ph);
    }

    // 右：情報ブロック
    const info = document.createElement("div");
    info.className = "info"; // CSS 側で縦積みスタイル

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

    // SNS リンク群（存在するものだけ表示）
    const snsWrap = document.createElement("div");
    snsWrap.className = "sns";
    const sns = item.sns || {};

    (Object.keys(sns)).forEach((key) => {
      const url = (sns[key] || "").trim();
      if (!url) return; // 空はスキップ
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";

      const ico = iconFor(key);
      if (ico) {
        const img = document.createElement("img");
        img.className = "favicon";
        img.alt = "";
        img.loading = "lazy";
        img.src = ico;
        a.appendChild(img);
      }
      // アクセシビリティのため、サービス名テキストも入れておく
      a.appendChild(document.createTextNode(key));
      snsWrap.appendChild(a);
    });

    info.appendChild(snsWrap);
    card.appendChild(info);

    return card;
  }

  /**
   * カード描画（外部からも使えるように公開）
   * @param {Array} data
   */
  function renderCards(data) {
    const container = document.getElementById("circleList");
    if (!container) return;
    container.innerHTML = "";

    (data || []).forEach((item) => {
      container.appendChild(buildCard(item));
    });
  }

  // グローバル公開：circles-view.js 側のソート・切替から呼ばれる想定
  window.renderCards = renderCards;

  // 初期ロード：CSV→window.circleData に格納し、初期表示をカードで描画
  document.addEventListener("DOMContentLoaded", async () => {
    const data = await loadCircles();
    window.circleData = Array.isArray(data) ? data : [];
    // 初期表示はカード（HTML/内容は変更しないまま見た目だけ反映）
    renderCards(window.circleData);
  });
})();
