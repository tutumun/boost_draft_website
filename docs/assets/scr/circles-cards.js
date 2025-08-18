// circles-cards.js
// サークルカード描画（SNSリンク表示対応）
// - 変更点A: コンテナIDを #circleList に統一
// - 変更点B: SNSは「文字列 or オブジェクト」の両方に対応、空欄非表示・複数は " | " 区切り
// - 変更点C: 画像キーは thumb/cut の両対応（無ければ noimage.png）

(() => {
  "use strict";

  /** favicon 取得（ドラフトは Google S2 を利用） */
  function faviconUrl(href) {
    try {
      const u = new URL(href);
      return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=16`;
    } catch {
      return "";
    }
  }

  /** SNSラベル推定（ホスト or キー名から簡易判定） */
  function guessLabel(hrefOrKey) {
    const key = String(hrefOrKey).toLowerCase();
    // キー名での推定（オブジェクト入力用）
    if (/(^|[^a-z])(x|twitter)([^a-z]|$)/.test(key)) return "X";
    if (/instagram|ig/.test(key)) return "Instagram";
    if (/youtube|yt/.test(key)) return "YouTube";
    if (/tiktok/.test(key)) return "TikTok";
    if (/pixiv/.test(key)) return "pixiv";
    if (/booth/.test(key)) return "BOOTH";
    if (/bluesky|bsky/.test(key)) return "Bluesky";
    if (/threads/.test(key)) return "Threads";
    if (/note/.test(key)) return "note";
    if (/web|site|homepage|url/.test(key)) return "Web";

    // URLでの推定（文字列入力用）
    try {
      const host = new URL(hrefOrKey).hostname;
      if (host.includes("x.com") || host.includes("twitter.com")) return "X";
      if (host.includes("instagram.com")) return "Instagram";
      if (host.includes("youtube.com") || host.includes("youtu.be")) return "YouTube";
      if (host.includes("tiktok.com")) return "TikTok";
      if (host.includes("pixiv.net")) return "pixiv";
      if (host.includes("booth.pm")) return "BOOTH";
      if (host.includes("bsky.app")) return "Bluesky";
      if (host.includes("threads.net")) return "Threads";
      if (host.includes("note.com")) return "note";
    } catch { /* noop */ }
    return "Web";
  }

  /**
   * SNSリンクHTMLを生成
   * - 入力: 文字列（空白/|/カンマ区切り） または { key: url } オブジェクト
   * - 振る舞い: 空欄は除外、複数は " | " 結合、favicon付きアンカーを返す
   * - 戻り: HTML文字列（空なら ""）
   */
  function buildSnsLinks(sns) {
    // 1) null/undefined/空文字 → 非表示
    if (sns == null || sns === "") return "";

    let pairs = [];

    // 2) オブジェクト形式 { x: "https://...", instagram: "" ... }
    if (typeof sns === "object" && !Array.isArray(sns)) {
      for (const [k, v] of Object.entries(sns)) {
        if (typeof v === "string" && v.trim() !== "") {
          pairs.push([k, v.trim()]);
        }
      }
    }
    // 3) 文字列形式 "https://... | https://..."（空白/|/, 区切りを許容）
    else if (typeof sns === "string") {
      const parts = sns.split(/[\s|,]+/).map(s => s.trim()).filter(Boolean);
      pairs = parts.map(href => [href, href]);
    }

    if (pairs.length === 0) return "";

    // 4) aタグ列を生成
    const anchors = pairs.map(([labelOrHref, href]) => {
      const label = guessLabel(labelOrHref);
      const ico = faviconUrl(href);
      const iconImg = ico ? `<img src="${ico}" alt="" width="16" height="16" loading="lazy">` : "";
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${iconImg}<span>${label}</span></a>`;
    });

    // 5) " | " で結合して返す
    return anchors.join(" | ");
  }

  /**
   * カード描画
   * - コンテナは #circleList（従来の構造に合わせる）
   * - 画像は thumb/cut の順で優先、無ければ noimage.png
   * - SNS は空なら非表示
   */
  function renderCards(data) {
    const container = document.getElementById("circleList"); // 変更点A: #circleList を使用
    if (!container) return;
    container.innerHTML = "";

    (data || []).forEach((c) => {
      const card = document.createElement("div");
      card.className = "circle-card";

      const thumb = c.thumb || c.cut || "assets/img/noimage.png"; // 変更点C
      const snsHtml = buildSnsLinks(c.sns); // 変更点B

      card.innerHTML = `
        <div class="thumb"><img src="${thumb}" alt=""></div>
        <div class="meta">
          <div class="name">${c.name || ""}</div>
          <div class="space">${c.space || ""}</div>
          <div class="pn">${c.pn || ""}</div>
          ${snsHtml ? `<div class="sns">${snsHtml}</div>` : ``}
        </div>
      `;
      container.appendChild(card);
    });
  }

  // グローバル公開（他JSから呼び出す）
  window.renderCards = renderCards;
})();
