// circles-cards.js (refactor: 可読性・保守性向上 / 挙動・表示は変更しない)
// サークル一覧の「カード描画」と「CSVロード」を担当
// NOTE: 既存の挙動・出力HTMLは一切変更しない（関数名・公開スコープも据え置き）

(() => {
  "use strict";

  // =============================================================
  // 定数・内部状態
  // =============================================================
  /** 1ページの表示件数（※既存既定：21件） */
  const PAGE_SIZE = 21; // 変更不可：UIの見え方に直結

  /** 何件描画済みか（ページング位置） */
  let renderedCount = 0; // 先頭からの描画済みインデックス

  // =============================================================
  // 型定義（JSDoc）※エディタ補完用。実行時には影響なし
  // =============================================================
  /**
   * @typedef {Object} CircleRow
   * @property {string} name  - サークル名
   * @property {string} pn    - ペンネーム
   * @property {string} space - スペース番号
   * @property {string} cat   - 種別（旧CSVでは type が cat に相当）
   * @property {string} [thumb] - サムネイル画像パス
   * @property {string} [cut]   - 旧CSVでのカット画像パス
   * @property {string} [kana]  - 50音キー（新CSV）
   * @property {string|Object<string,string>} [sns] - 文字列("url | url")またはオブジェクト({ x: url, ... })
   */

  // =============================================================
  // CSV パース系ユーティリティ
  // =============================================================

  /**
   * 1行テキスト → セル配列（簡易CSV。ダブルクォート対応の軽処理）
   * - ダブルクォートで囲まれたカンマは区切りとみなさない
   * - 連続する "" はエスケープとして 1 つの '"' に変換
   * @param {string} line
   * @returns {string[]}
   */
  function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { // エスケープ（""）
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (ch === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  /**
   * 旧12列CSV → オブジェクトへ変換
   * 期待順: name, pn, space, type, cut, x, pixiv, booth, web, instagram, bluesky, tumblr
   * @param {string[]} cells
   * @returns {CircleRow}
   */
  function mapOld12(cells) {
    const [
      name = "", pn = "", space = "", type = "",
      cut = "", x = "", pixiv = "", booth = "",
      web = "", instagram = "", bluesky = "", tumblr = ""
    ] = cells.map(s => s?.trim() ?? "");

    return {
      name,
      pn,
      space,
      cat: type,      // 新式の cat に揃える
      cut,
      thumb: cut,     // 両対応（thumb が無い場合のフォールバック）
      kana: "",
      sns: { x, pixiv, booth, web, instagram, bluesky, tumblr }
    };
  }

  /**
   * 新7列CSV → オブジェクトへ変換
   * 期待順: name, pn, space, cat, thumb, kana, sns
   * @param {string[]} cells
   * @returns {CircleRow}
   */
  function mapNew7(cells) {
    const [
      name = "", pn = "", space = "", cat = "",
      thumb = "", kana = "", sns = ""
    ] = cells.map(s => s?.trim() ?? "");
    return { name, pn, space, cat, thumb, kana, sns };
  }

  /**
   * CSVテキスト → サークル配列（旧/新の両方に対応）
   * - 先頭行がヘッダーかどうかは簡易判定（name/space/sns 等の単語で判別）
   * @param {string} text
   * @returns {CircleRow[]}
   */
  function parseCirclesCsv(text) {
    const lines = text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];

    const firstCells = splitCsvLine(lines[0]).map(s => s.toLowerCase());
    const hasHeader = firstCells.some(s => [
      "name","space","sns","cat","type","thumb","cut","kana","pn"
    ].includes(s));

    const startIdx = hasHeader ? 1 : 0;
    const out = [];

    for (let i = startIdx; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i]);
      // 列数で旧/新のどちらかを推定（旧: >=12, 新: >=7）
      const row = (cells.length >= 12) ? mapOld12(cells) : mapNew7(cells);
      out.push(row);
    }
    return out;
  }

  // =============================================================
  // 表示系ユーティリティ
  // =============================================================

  /**
   * Google S2 由来の favicon URL を生成
   * @param {string} href - 対象URL
   * @param {number} [size=16] - 取得サイズ
   * @returns {string} URL 失敗時は空文字
   */
  function faviconUrl(href, size = 16) {
    try {
      const u = new URL(href);
      return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=${size}`;
    } catch {
      return "";
    }
  }

  /**
   * SNS ラベル推定（キー名 or URLドメイン → alt/aria用の短い名称）
   * @param {string} hrefOrKey
   * @returns {string}
   */
  function guessLabel(hrefOrKey) {
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

    // URL からの推定（try/catch 内で厳格パース）
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
    } catch {/* noop */}

    return "Web"; // フォールバック
  }

  /**
   * SNSリンクHTMLを生成
   * - 文字列形式: "url | url" で区切り（空白単体では区切らない）
   * - オブジェクト形式: { x: "url", pixiv: "url", ... }
   * - 返り値は <a><img></a> のみ（テキストは出力しない）
   * @param {string|Object<string,string>|undefined|null} sns
   * @returns {string} HTML文字列（空なら ""）
   */
  function buildSnsLinks(sns) {
    if (sns == null || sns === "") return "";

    /** @type {Array<[string,string]>} */
    let pairs = [];

    if (typeof sns === "string") {
      // 文字列は "|" 区切り。空要素は除去
      const parts = sns.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
      pairs = parts.map(href => [href, href]);
    } else if (typeof sns === "object" && !Array.isArray(sns)) {
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
      const iconImg = ico
        ? `<img src="${ico}" alt="${label}" width="16" height="16" loading="lazy">`
        : ""; // 取得失敗時はテキストも出さず、そのまま空
      // アクセシビリティのため aria-label を付与
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${label}">${iconImg}</a>`;
    });

    // 既存仕様：区切り記号は表示しない（アイコンのみ）。
    return anchors.join("");
  }

  /**
   * カードDOMを1枚生成（左: 画像 / 右: 情報）
   * @param {CircleRow} c
   * @returns {HTMLDivElement}
   */
  function createCard(c) {
    const card = document.createElement("div");
    card.className = "circle-card"; // スタイルはCSSに集約

    const thumb = c.thumb || c.cut || "assets/img/noimage.png"; // フォールバック
    const snsHtml = buildSnsLinks(c.sns);

    // 既存の構造・クラス名・属性を厳密維持
    card.innerHTML = `
      <div class="thumb">
        <img src="${thumb}" alt="" />
      </div>
      <div class="meta">
        <div class="name">${c.name || ""}</div>
        <div class="space">${c.space || ""}</div>
        <div class="pn">${c.pn || ""}</div>
        ${snsHtml ? `<div class="sns">${snsHtml}</div>` : ``}
      </div>
    `;
    return card;
  }

  // =============================================================
  // ページング描画
  // =============================================================

  /**
   * 「さらに読み込む」ボタンを取得（無ければ生成）
   * @returns {HTMLButtonElement}
   */
  function ensureLoadMoreButton() {
    let btn = /** @type {HTMLButtonElement|null} */(document.getElementById("loadMoreCircles"));
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "loadMoreCircles";
      btn.type = "button";
      btn.textContent = "さらに読み込む";
      btn.style.display = "block";
      btn.style.margin = "16px auto";
      const host = document.getElementById("circleList");
      if (host) host.after(btn);
    }
    return btn;
  }

  /**
   * データの一部（max 件）を追記描画
   * @param {CircleRow[]} data 全件配列
   * @param {number} [max=PAGE_SIZE] 今回追加する件数
   */
  function appendPage(data, max = PAGE_SIZE) {
    const container = document.getElementById("circleList");
    if (!container || !Array.isArray(data)) return;

    const end = Math.min(renderedCount + max, data.length);
    for (let i = renderedCount; i < end; i++) {
      container.appendChild(createCard(data[i]));
    }
    renderedCount = end;

    // ボタンの表示/非表示制御
    const btn = ensureLoadMoreButton();
    btn.style.display = (renderedCount < data.length) ? "block" : "none";
  }

  /**
   * 初期描画（PAGE_SIZE件）＋「さらに読み込む」ハンドラ設定
   * - 他JSからも呼べるように window へ公開（API維持）
   * @param {CircleRow[]} data
   */
  function renderCards(data) {
    const container = document.getElementById("circleList");
    if (!container) return;

    // 初期化
    container.innerHTML = "";
    renderedCount = 0;

    // 先頭 PAGE_SIZE 件を描画
    appendPage(data, PAGE_SIZE);

    // ボタンのハンドラ設定
    const btn = ensureLoadMoreButton();
    btn.onclick = () => appendPage(data, PAGE_SIZE);
  }

  // =============================================================
  // データロード
  // =============================================================

  /**
   * CSVロード（GitHub基本構成に従い content/circle-list.csv を使用）
   * - 既存の構成を維持：フォールバックは実装しない
   * @returns {Promise<CircleRow[]>}
   */
  async function loadCircles() {
    try {
      const res = await fetch("content/circle-list.csv", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return parseCirclesCsv(text);
    } catch (err) {
      console.warn("CSVの読み込みに失敗しました:", err);
      return [];
    }
  }

  // =============================================================
  // 公開・初期化
  // =============================================================

  // グローバル公開（既存互換）
  // 他JSから renderCards(window.circleData) を呼べるようにする
  // @ts-ignore
  window.renderCards = renderCards;

  // 初期化：CSVを読み込んでカード描画、データを保持（既存互換）
  document.addEventListener("DOMContentLoaded", async () => {
    const data = await loadCircles();
    // @ts-ignore - デバッグ/他ビュー連携のために window へ保持
    window.circleData = Array.isArray(data) ? data : [];
    renderCards(window.circleData);
  });
})();
