// circles-cards.js
// サークル一覧の「カード描画」と「CSVロード」を担当
// 変更点まとめ：
// - CSVパスのフォールバック対応（content/circle-list.csv → data/circles.csv → content/circles.csv）
// - CSVフォーマット両対応（旧12列: name,pn,space,type,cut,x,... / 新7列: name,pn,space,cat,thumb,kana,sns）
// - SNSは「オブジェクト or 文字列」に両対応、空欄は非表示、複数は " | " 区切り
// - 画像は thumb/cut の両対応（無い場合は noimage.png）
// - 初期描画は #circleList にカードを展開、window.circleData を保持

(() => {
  "use strict";

  /** 指定パス群から最初に成功するテキストを取得 */
  async function fetchTextWithFallback(paths) {
    let lastErr;
    for (const p of paths) {
      try {
        const res = await fetch(p, { cache: "no-store" });
        if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
        return await res.text();
      } catch (e) {
        lastErr = e;
        // 次の候補へ
      }
    }
    throw lastErr ?? new Error("No CSV source found");
  }

  /** 旧12列CSV → 行配列からオブジェクトへ変換 */
  function mapOld12(cells) {
    // 期待順: name, pn, space, type, cut, x, pixiv, booth, web, instagram, bluesky, tumblr
    const [
      name = "", pn = "", space = "", type = "",
      cut = "", x = "", pixiv = "", booth = "",
      web = "", instagram = "", bluesky = "", tumblr = ""
    ] = cells.map(s => s?.trim() ?? "");
    return {
      name, pn, space,
      cat: type,                 // 新式のcatに寄せる
      cut, thumb: cut,           // 両対応
      kana: "",                  // 旧式には列が無い
      sns: { x, pixiv, booth, web, instagram, bluesky, tumblr }
    };
  }

  /** 新7列CSV → 行配列からオブジェクトへ変換 */
  function mapNew7(cells) {
    // 期待順: name, pn, space, cat, thumb, kana, sns
    const [
      name = "", pn = "", space = "", cat = "",
      thumb = "", kana = "", sns = ""
    ] = cells.map(s => s?.trim() ?? "");
    return { name, pn, space, cat, thumb, kana, sns };
  }

  /** 1行テキスト → セル配列（簡易CSV。ダブルクォート対応の軽処理） */
  function splitCsvLine(line) {
    // ざっくりなCSV分割（ダブルクォート内のカンマは保護）
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        // 連続する "" はエスケープとして扱う
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === "," && !inQ) {
        out.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  /** CSVテキスト → サークル配列（旧/新どちらも処理） */
  function parseCirclesCsv(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    // ヘッダ行判定：先頭行に name,space などのキーワードが含まれていたらヘッダとみなす
    const firstCells = splitCsvLine(lines[0]).map(s => s.toLowerCase());
    const hasHeader = firstCells.some(s => ["name","space","sns","cat","type","thumb","cut","kana","pn"].includes(s));

    const start = hasHeader ? 1 : 0;
    const out = [];

    for (let i = start; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i]);

      // 列数で旧/新のどちらかを推定（旧: >=12, 新: >=7）
      let row;
      if (cells.length >= 12) {
        row = mapOld12(cells);
      } else {
        row = mapNew7(cells);
      }
      out.push(row);
    }
    return out;
  }

  /** favicon URL（ドラフトでは Google S2 を利用） */
  function faviconUrl(href, size = 16) {
    try {
      const u = new URL(href);
      return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=${size}`;
    } catch { return ""; }
  }

  /** SNSラベル推定（キー名 or URLドメインから簡易判定） */
  function guessLabel(hrefOrKey) {
    const key = String(hrefOrKey).toLowerCase();
    if (/(^|\\b)(x|twitter)(\\b|$)/.test(key)) return "X";
    if (/instagram|\\big\\b/.test(key)) return "Instagram";
    if (/youtube|\\byt\\b/.test(key)) return "YouTube";
    if (/tiktok/.test(key)) return "TikTok";
    if (/pixiv/.test(key)) return "pixiv";
    if (/booth/.test(key)) return "BOOTH";
    if (/bluesky|\\bbsky\\b/.test(key)) return "Bluesky";
    if (/threads/.test(key)) return "Threads";
    if (/note/.test(key)) return "note";
    if (/web|site|homepage|url/.test(key)) return "Web";

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
   * SNSリンクHTML生成
   * - 入力: 文字列（空白/|/, 区切り） or { key: url } オブジェクト
   * - 空欄は除外、複数は " | " で結合、favicon 付与
   */
  // 修正1: SNSパースの厳格化（" | " 区切りのみ）+ オブジェクト両対応
  function buildSnsLinks(sns) {
   // 空欄は非表示
   if (sns == null || sns === "") return "";

   // ラベル推定（キー名 or URLドメイン）
   const guessLabel = (hrefOrKey) => {
     const key = String(hrefOrKey).toLowerCase();
     if (/(^|\b)(x|twitter)(\b|$)/.test(key)) return "X";
     if (/instagram|(^|\b)ig(\b|$)/.test(key)) return "Instagram";
     if (/youtube|(^|\b)yt(\b|$)/.test(key)) return "YouTube";
     if (/tiktok/.test(key)) return "TikTok";
     if (/pixiv/.test(key)) return "pixiv";
     if (/booth/.test(key)) return "BOOTH";
     if (/bluesky|(^|\b)bsky(\b|$)/.test(key)) return "Bluesky";
     if (/threads/.test(key)) return "Threads";
     if (/note/.test(key)) return "note";
     if (/web|site|homepage|url/.test(key)) return "Web";
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
     } catch {}
     return "Web";
   };

   // favicon URL（Google S2）
   const faviconUrl = (href, size = 16) => {
     try {
       const u = new URL(href);
       return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=${size}`;
     } catch { return ""; }
   };

   let pairs = [];

   // 文字列: "url | url | url" のみを区切る（空白単体では区切らない）
   if (typeof sns === "string") {
     const parts = sns.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
     pairs = parts.map(href => [href, href]);
   }
   // オブジェクト: { x: "url", pixiv: "url", ... }
   else if (typeof sns === "object" && !Array.isArray(sns)) {
     for (const [k, v] of Object.entries(sns)) {
       if (typeof v === "string" && v.trim() !== "") {
         pairs.push([k, v.trim()]);
       }
     }
   }

   if (pairs.length === 0) return "";

   const anchors = pairs.map(([labelOrHref, href]) => {
     const label = guessLabel(labelOrHref);
     const ico = faviconUrl(href);
     const iconImg = ico ? `<img src="${ico}" alt="" width="16" height="16" loading="lazy">` : "";
     return `<a href="${href}" target="_blank" rel="noopener noreferrer">${iconImg}<span>${label}</span></a>`;
   });

   return anchors.join(" | ");
  }

  // 修正2: レイアウト（左: 画像 / 右: 情報）を強制（CSSが無くても横並びになるよう最低限のinline-styleを付与）
  function renderCards(data) {
   const container = document.getElementById("circleList"); // 既存構造に合わせる
   if (!container) return;
   container.innerHTML = "";

   (data || []).forEach((c) => {
     const card = document.createElement("div");
     card.className = "circle-card";

     // 横並びを確実にする（サイトCSSがある場合は上書きされてもOKなよう最小限）
     card.style.display = "flex";
     card.style.gap = "12px";
     card.style.alignItems = "flex-start";

     const thumb = c.thumb || c.cut || "assets/img/noimage.png";
     const snsHtml = buildSnsLinks(c.sns);

     card.innerHTML = `
       <div class="thumb" style="flex:0 0 auto;"><img src="${thumb}" alt="" style="display:block;max-width:160px;height:auto;"></div>
       <div class="meta" style="flex:1 1 auto;">
         <div class="name">${c.name || ""}</div>
         <div class="space">${c.space || ""}</div>
         <div class="pn">${c.pn || ""}</div>
         ${snsHtml ? `<div class="sns">${snsHtml}</div>` : ``}
       </div>
     `;
     container.appendChild(card);
   });
  }


  /** CSVロード（GitHub基本構成に従い content/circle-list.csv を使用） */
  async function loadCircles() {
    try {
      const text = await fetch("content/circle-list.csv", { cache: "no-store" })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        });
      const data = parseCirclesCsv(text);
      return data;
    } catch (err) {
      console.warn("CSVの読み込みに失敗しました:", err);
      return [];
    }
  }


  // グローバル公開
  window.renderCards = renderCards;

  // 初期化：CSVを読み込んでカード描画、データを保持
  document.addEventListener("DOMContentLoaded", async () => {
    const data = await loadCircles();
    window.circleData = Array.isArray(data) ? data : [];
    renderCards(window.circleData);
  });
})();
