/**
 * Парсинг одной карточки Swissmint.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { saveBufferAsForeignUnified } = require("./lib/save-foreign-unified-webp.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
/** Витрина swissmintshop: три кадра — obv, rev, box (без pack). */
const SWISSMINT_SHOP_FILE_SUFFIXES = ["obv", "rev", "box"];
const SWISSMINT_SHOP_IMAGE_ROLES = ["obverse", "reverse", "box"];

function slugifyCoinTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/['\u2019\u2018]/g, "")
    .replace(/,/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Три кадра для shop после фильтра LQIP (полноразмерные кадры карусели). */
function swissmintShopPickFourLocals(local) {
  return local.slice(0, 3);
}

function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  u.search = "";
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

function slugFromUrl(url) {
  const u = new URL(url);
  const seg = u.pathname.split("/").filter(Boolean).pop() || "item";
  return seg.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/** Обрезка текста витрины swissmintshop: от «Legal face value» до «Reviews». */
function extractSwissmintShopSpecsBlob(text) {
  const s = String(text || "");
  const idx = s.search(/Legal face value:\s*/i);
  if (idx === -1) return s;
  const end = s.search(/\bReviews\s*\(\d+\)/i);
  return end === -1 ? s.slice(idx) : s.slice(idx, end);
}

function humanTitleFromUrl(sourceUrl) {
  try {
    const seg = decodeURIComponent(new URL(sourceUrl).pathname.split("/").filter(Boolean).pop() || "").trim();
    if (!seg || /^\d+$/.test(seg)) return null;
    return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return null;
  }
}

function salvageTitle(title, specsText, sourceUrl) {
  const bad = (t) =>
    !t ||
    /^Suggested Keywords$/i.test(String(t).trim()) ||
    /^Swissmint$/i.test(String(t).trim()) ||
    /^Skip to /i.test(String(t).trim()) ||
    /^Search$/i.test(String(t).trim());
  /** Слишком длинный заголовок (случайно схватили весь абзац с витрины) — перебираем структурные паттерны. */
  const tooLong = (t) => !t || String(t).length > 160 || /\bWith over \d+,?\d*\s+lakes\b/i.test(String(t));
  const ok = (t) => !bad(t) && !tooLong(t);

  const blob = String(specsText || "");
  let out;

  const m1 = blob.match(/Latest issue\s+(.+?)\s+Enlarge image/i);
  if (m1) {
    out = m1[1].replace(/\s+/g, " ").trim();
    if (ok(out)) return out;
  }
  const mShop = blob.match(/Home(?:Silver|Gold|Bimetal)\s+coins\s+(.+?),\s*proof\s+Enlarge image/i);
  if (mShop) {
    out = `${mShop[1].replace(/\s+/g, " ").trim()}, proof`;
    if (ok(out)) return out;
  }
  const m3 = blob.match(/Coin image:\s*(.+?)(?:\s+Legal face value:)/i);
  if (m3) {
    out = m3[1].replace(/\s+/g, " ").trim();
    if (ok(out)) return out;
  }
  const m2 = blob.match(/Product details\s+(.+?)(?:Since |The obverse|The reverse|Legal face value:|Coin image:)/is);
  if (m2) {
    out = m2[1].replace(/\s+/g, " ").trim();
    if (out.length > 140) out = out.slice(0, 140).replace(/\s+\S*$/, "");
    if (ok(out)) return out;
  }

  out = String(title || "").trim() || null;
  if (ok(out)) return out;
  return humanTitleFromUrl(sourceUrl);
}

function fileKindFromBuffer(buf) {
  if (!buf || buf.length < 12) return null;
  const head = buf.slice(0, 120).toString("utf8").trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) return "svg";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a
  )
    return "png";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

function parseSpecPairs(text) {
  const out = {};
  const raw = String(text || "");
  const lines = raw
    .split("\n")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^([^:]{2,80}):\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    if (key && val && !out[key]) out[key] = val;
  }
  const pick = (label, re) => {
    if (out[label]) return;
    const m = raw.match(re);
    if (m && m[1]) out[label] = String(m[1]).replace(/\s+/g, " ").trim();
  };
  pick("Legal face value", /Legal face value:\s*([^<\n]+?)(?:\s{2,}|Alloy:|Diameter:|Weight:|Date of issue:|Mintage|Prices|$)/i);
  pick("Alloy", /Alloy:\s*([^<\n]+?)(?:\s{2,}|Diameter:|Weight:|Date of issue:|Mintage|Prices|$)/i);
  pick("Diameter", /Diameter:\s*([^<\n]+?)(?:\s{2,}|Weight:|Date of issue:|Mintage|Prices|$)/i);
  pick("Weight", /Weight:\s*([^<\n]+?)(?:\s{2,}|Date of issue:|Mintage|Prices|$)/i);
  pick("Date of issue", /Date of issue:\s*([^<\n]+?)(?:\s{2,}|Mintage|Prices|$)/i);
  pick(
    "Mintage Proof in presentation case",
    /Mintage Proof in presentation case:\s*([^<\n]+?)(?:\s{2,}|Uncirculated:|Prices|$)/i
  );
  pick("Uncirculated", /Uncirculated:\s*([^<\n]+?)(?:\s{2,}|Prices|$)/i);
  return out;
}

function download(url, dst) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 30000, headers: { "user-agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dst));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(false);
      }
      const ws = fs.createWriteStream(dst);
      res.pipe(ws);
      ws.on("finish", () => ws.close(() => resolve(true)));
      ws.on("error", () => resolve(false));
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Порядок картинок sondermuenze: front/obverse перед back/reverse по имени файла. */
function orderSondermuenzeProductImages(urls) {
  const rank = (u) => {
    const s = String(u).toLowerCase();
    if (/-front-|\/front|_front_|-obv|obverse/i.test(s)) return 0;
    if (/-back-|\/back|_back_|-reverse/i.test(s)) return 1;
    return 2;
  };
  return [...urls].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return String(a).localeCompare(String(b));
  });
}

/** Убираем дубли srcset/retinа: один URL на «ствол» имени файла. */
function dedupeSondermuenzeImageUrls(urls) {
  const byStem = new Map();
  for (const u of urls) {
    try {
      const { pathname } = new URL(u);
      const stem = pathname
        .replace(/\.(png|jpe?g|webp)$/i, "")
        .replace(/-\d+x\d+$/i, "");
      if (!byStem.has(stem)) byStem.set(stem, u);
    } catch {
      if (!byStem.has(u)) byStem.set(u, u);
    }
  }
  return Array.from(byStem.values());
}

/** Клики по индикаторам карусели витрины — в DOM подгружаются hi-res картинки каждого слайда. */
async function primeSwissmintShopCarousel(page) {
  const tryClickEach = async (locator) => {
    const n = await locator.count();
    if (n < 2) return false;
    for (let i = 0; i < n; i++) {
      await locator.nth(i).click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(750);
    }
    return true;
  };
  if (await tryClickEach(page.locator("main .carousel-indicators button"))) return;
  if (await tryClickEach(page.locator("main [class*='carousel-indicators'] button"))) return;
  if (await tryClickEach(page.locator("main [class*='CarouselIndicators'] button"))) return;
  if (await tryClickEach(page.locator("main .owl-dots button"))) return;
  if (await tryClickEach(page.locator("main [role='tablist'] button"))) return;
  for (let k = 0; k < 6; k++) {
    await page
      .locator("main .carousel-control-next, main [class*='carousel-next'] button, main button[class*='next']")
      .first()
      .click({ timeout: 2500 })
      .catch(() => {});
    await page.waitForTimeout(500);
  }
}

/** Клики по индикаторам карусели внутри переданного корня (модалка «Enlarge image»). */
async function primeCarouselInRoot(locator, page) {
  const tryClickEach = async (sel) => {
    const l = locator.locator(sel);
    const n = await l.count();
    if (n < 2) return false;
    for (let i = 0; i < n; i++) {
      await l.nth(i).click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(650);
    }
    return true;
  };
  if (await tryClickEach(".carousel-indicators button")) return;
  if (await tryClickEach("[class*='carousel-indicators'] button")) return;
  if (await tryClickEach(".owl-dots button")) return;
  for (let k = 0; k < 5; k++) {
    await locator
      .locator(".carousel-control-next, [class*='carousel-next'] button")
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
    await page.waitForTimeout(450);
  }
}

/**
 * Модальное окно «Enlarge image» (cx-action-link) — там полноразмерные картинки (.cx-dialog-content).
 */
async function scrapeSwissmintShopModalImageUrls(page) {
  const dialogSel = ".cx-dialog-content, .modal-content.cx-dialog-content, [class*='cx-dialog-content']";

  const clickEnlarge = async () => {
    const tryLoc = async (loc) => {
      if ((await loc.count()) < 1) return false;
      return loc.first().click({ timeout: 6000 }).then(() => true).catch(() => false);
    };
    if (await tryLoc(page.getByRole("button", { name: /enlarge image|enlarge/i }))) return true;
    if (await tryLoc(page.getByRole("link", { name: /enlarge image|enlarge/i }))) return true;
    const candidates = [
      page.locator("main .btn.btn-link.cx-action-link.ng-star-inserted"),
      page.locator("main button.btn.cx-action-link.ng-star-inserted"),
      page.locator("main a.btn.cx-action-link.ng-star-inserted"),
      page.locator("main button.cx-action-link"),
      page.locator("main a.cx-action-link"),
    ];
    for (const loc of candidates) {
      if (await tryLoc(loc)) return true;
    }
    return false;
  };

  const opened = await clickEnlarge();
  if (!opened) return [];

  await page.waitForSelector(dialogSel, { state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);

  const dialogRoot = page.locator(dialogSel).first();
  const count = await dialogRoot.count();
  if (count === 0) return [];

  await primeCarouselInRoot(dialogRoot, page);
  await page.waitForTimeout(400);

  const grabDialogImageUrls = () =>
    page.evaluate(() => {
      const root =
        document.querySelector(".modal-content.cx-dialog-content") ||
        document.querySelector(".cx-dialog-content") ||
        document.querySelector("[class*='cx-dialog-content']");
      if (!root) return [];
      const acc = [];
      const pushUrl = (raw) => {
        if (!raw) return;
        for (const part of String(raw).split(",")) {
          const u = part.trim().split(" ")[0];
          if (!u || /^data:/i.test(u)) continue;
          if (/\.svg(\?|$)/i.test(u)) continue;
          if (/placeholder|spacer|1x1|blank/i.test(u)) continue;
          if (/logo|icon|favicon/i.test(u)) continue;
          if (/^https?:\/\//i.test(u)) acc.push(u);
          else if (u.startsWith("//")) acc.push("https:" + u);
          else if (u.startsWith("/")) acc.push(location.origin + u);
        }
      };
      const nodes = root.querySelectorAll(
        "picture source[srcset], picture img, img[src], img[data-src], img[data-lazy-src], source[srcset]"
      );
      for (const n of nodes) {
        pushUrl(n.getAttribute && n.getAttribute("data-lazy-src"));
        pushUrl(n.getAttribute && n.getAttribute("data-lazy-srcset"));
        pushUrl(n.getAttribute && n.getAttribute("src"));
        pushUrl(n.getAttribute && n.getAttribute("data-src"));
        pushUrl(n.getAttribute && n.getAttribute("srcset"));
      }
      return acc;
    });

  const urlSet = new Set(await grabDialogImageUrls());
  const ind = dialogRoot.locator(".carousel-indicators button");
  const nInd = await ind.count();
  if (nInd >= 2) {
    for (let i = 0; i < nInd; i++) {
      await ind.nth(i).click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
      for (const u of await grabDialogImageUrls()) urlSet.add(u);
    }
  }

  const urls = Array.from(urlSet);

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);
  await page
    .locator(".cx-dialog-content button.close, .cx-dialog-content .close, .cx-dialog-content [aria-label*='Close']")
    .first()
    .click({ timeout: 2000 })
    .catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});

  return urls;
}

async function parseProduct(page, sourceUrl) {
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  const isSonderListing = /sondermuenze\.ch/i.test(sourceUrl) && !/swissmintshop\.admin\.ch/i.test(sourceUrl);
  if (/swissmintshop\.admin\.ch/i.test(sourceUrl)) {
    await page.waitForTimeout(3500);
    await page.waitForSelector("main, [role='main']", { timeout: 20000 }).catch(() => {});
    await primeSwissmintShopCarousel(page);
    await page.waitForTimeout(600);
  } else if (isSonderListing) {
    await page.waitForTimeout(600);
    await page
      .waitForSelector(".row.intro-animation-container .col-l-4.col-m-6.col-xs-12 img, .col-l-4.col-m-6.col-xs-12 img", {
        timeout: 25000,
      })
      .catch(() => {});
    await page
      .evaluate(() => {
        const col =
          document.querySelector(".row.intro-animation-container .col-l-4.col-m-6.col-xs-12") ||
          document.querySelector(".col-l-4.col-m-6.col-xs-12.intro-animation");
        col?.scrollIntoView({ block: "center" });
      })
      .catch(() => {});
    await page.waitForTimeout(1400);
  } else {
    await page.waitForTimeout(1800);
  }
  const parsed = await page.evaluate(() => {
    const txt = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");
    const isSonder = /sondermuenze\.ch$/i.test(location.hostname);
    const isShop = /swissmintshop\.admin\.ch$/i.test(location.hostname);

    const textCol =
      document.querySelector(
        ".col-l-8.col-m-12.col-xs-12.intro-animation.intro-animation--bottom.intro-animation--visible"
      ) ||
      document.querySelector(".col-l-8.col-m-12.col-xs-12.intro-animation") ||
      document.querySelector(".col-l-8.col-m-12.col-xs-12");
    const imgCol =
      document.querySelector(
        ".row.intro-animation-container .col-l-4.col-m-6.col-xs-12.intro-animation.intro-animation--bottom.intro-animation--visible"
      ) ||
      document.querySelector(".row.intro-animation-container .col-l-4.col-m-6.col-xs-12") ||
      document.querySelector(
        ".col-l-4.col-m-6.col-xs-12.intro-animation.intro-animation--bottom.intro-animation--visible"
      ) ||
      document.querySelector(".col-l-4.col-m-6.col-xs-12.intro-animation") ||
      document.querySelector(".col-l-4.col-m-6.col-xs-12");
    const specsCol =
      document.querySelector(
        ".section__text.section__text--center.intro-animation.intro-animation--bottom.intro-animation--visible"
      ) ||
      document.querySelector(".section__text.section__text--center.intro-animation") ||
      document.querySelector(".section__text.section__text--center");

    const root =
      textCol ||
      document.querySelector(".section") ||
      document.querySelector("main") ||
      document.querySelector("[role='main']") ||
      document.body;

    const imgRoot =
      imgCol ||
      document.querySelector(".section") ||
      document.querySelector("main") ||
      document.querySelector("[role='main']") ||
      document.body;

    const badHeading = (t) =>
      !t ||
      /^Suggested Keywords$/i.test(t) ||
      /^Swissmint$/i.test(t) ||
      /^Skip to\b/i.test(t) ||
      /^Search$/i.test(t) ||
      t.length < 3;

    let title = null;
    const ogT = document.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim();
    if (ogT && !badHeading(ogT)) title = ogT;
    if (!title) {
      const heads = [...document.querySelectorAll("h1, h2")].map((h) => txt(h)).filter((t) => !badHeading(t));
      title = heads[0] || null;
    }
    if (!title) title = txt(root.querySelector("h1, h2, h3")) || txt(document.querySelector("h1")) || null;
    if (badHeading(title)) title = null;

    let description;
    if (isSonder && textCol) {
      description =
        txt(
          textCol.querySelector(
            ".section__text.section__text--lead.section__text--center p, .section__text.section__text--lead p"
          )
        ) || txt(textCol.querySelector(".section__text--lead p"));
      if (!description) {
        for (const p of textCol.querySelectorAll("p")) {
          const t = txt(p);
          if (t.length > 100 && !/^Legal face value:\s*/i.test(t) && !/^Mintage\b/i.test(t)) {
            description = t;
            break;
          }
        }
      }
      if (!description) {
        description =
          document.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() ||
          document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ||
          null;
      }
    } else {
      description =
        txt(
          root.querySelector(
            ".section__text.section__text--lead.section__text--center p, .section__text p, p"
          )
        ) || null;
    }

    let specsText;
    if (isSonder) {
      const teaserBlock = txt(document.querySelector(".teaser_special__content__inside") || null);
      const legalBlock = textCol ? txt(textCol) : "";
      const centerBlock = specsCol && (!textCol || !textCol.contains(specsCol)) ? txt(specsCol) : "";
      const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() || "";
      const leadBlock = txt(
        document.querySelector(
          ".section__text.section__text--lead, .section__text--lead .section__text--center"
        ) || document.querySelector(".section__text--lead")
      );
      specsText = [teaserBlock, leadBlock, centerBlock, ogDesc, legalBlock]
        .filter((s) => s && s.length > 15)
        .join("\n\n");
      if (!/Legal face value:\s*/i.test(specsText))
        specsText = [specsText, txt(document.body).slice(0, 12000)].join("\n\n");
    } else if (isShop) {
      const tabsSpecsEl =
        document.querySelector("main .Tabs.has-components.ng-star-inserted") ||
        document.querySelector("main .tabs.has-components.ng-star-inserted") ||
        document.querySelector("main [class*='Tabs'][class*='has-components'].ng-star-inserted");
      const containerSpecsEl = document.querySelector("main .container.ng-star-inserted");
      const tabsTxt = tabsSpecsEl ? txt(tabsSpecsEl) : "";
      const containerTxt =
        containerSpecsEl && (!tabsSpecsEl || !tabsSpecsEl.contains(containerSpecsEl))
          ? txt(containerSpecsEl)
          : "";
      specsText = [tabsTxt, containerTxt, txt(document.body).slice(0, 16000)]
        .filter((s) => s.length > 20)
        .join("\n\n");
    } else if (specsCol) {
      specsText = txt(specsCol);
    } else {
      specsText = txt(document.body);
    }

    const pushUrl = (imageSet, raw) => {
      if (!raw) return;
      for (const part of String(raw).split(",")) {
        const u = part.trim().split(" ")[0];
        if (!u || /^data:/i.test(u)) continue;
        if (/\.svg(\?|$)/i.test(u)) continue;
        if (/placeholder|spacer|1x1|blank/i.test(u)) continue;
        if (/logo|icon|favicon|eidgenoessische-muenzstaette/i.test(u)) continue;
        if (/^https?:\/\//i.test(u)) imageSet.add(u);
        else if (u.startsWith("//")) imageSet.add("https:" + u);
        else if (u.startsWith("/")) imageSet.add(location.origin + u);
      }
    };

    const imageSet = new Set();
    const collectFromInto = (container, into) => {
      const nodes = container.querySelectorAll(
        "picture source[srcset], picture img, img[src], img[data-src], img[data-lazy-src], source[srcset]"
      );
      for (const n of nodes) {
        pushUrl(into, n.getAttribute && n.getAttribute("data-lazy-src"));
        pushUrl(into, n.getAttribute && n.getAttribute("data-lazy-srcset"));
        pushUrl(into, n.getAttribute && n.getAttribute("src"));
        pushUrl(into, n.getAttribute && n.getAttribute("data-src"));
        pushUrl(into, n.getAttribute && n.getAttribute("srcset"));
      }
    };
    const collectFrom = (container) => collectFromInto(container, imageSet);

    const urlsFromColumnUploads = (col) => {
      const acc = new Set();
      collectFromInto(col, acc);
      return Array.from(acc).filter((u) => /\/wp-content\/uploads\//i.test(u));
    };
    const dedupeStemPickBest = (arr) => {
      const byStem = new Map();
      for (const u of arr) {
        try {
          const path = new URL(u).pathname;
          if (!/\/wp-content\/uploads\//i.test(path)) continue;
          const stem = path
            .replace(/\.(png|jpe?g|webp)$/i, "")
            .replace(/-\d+x\d+$/i, "");
          const prev = byStem.get(stem);
          if (!prev || path.length > new URL(prev).pathname.length) byStem.set(stem, u);
        } catch {
          /* skip */
        }
      }
      return Array.from(byStem.values());
    };

    const coinPairStem = (u) => {
      try {
        let p = new URL(u).pathname.replace(/\.(png|jpe?g|webp)$/i, "").replace(/-\d+x\d+$/i, "");
        return p.replace(/-(ws|bs)$/i, "");
      } catch {
        return "";
      }
    };

    let dualSonderUrls = null;
    if (isSonder) {
      for (const row of document.querySelectorAll(".row")) {
        const cols = Array.from(
          row.querySelectorAll(".col-m-6.col-xs-12.intro-animation.intro-animation--bottom.intro-animation--visible")
        ).filter((col) => urlsFromColumnUploads(col).length > 0);
        for (let i = 0; i < cols.length - 1; i++) {
          const u0 = dedupeStemPickBest(urlsFromColumnUploads(cols[i]))[0];
          const u1 = dedupeStemPickBest(urlsFromColumnUploads(cols[i + 1]))[0];
          const stem0 = coinPairStem(u0);
          if (u0 && u1 && stem0 && stem0 === coinPairStem(u1)) {
            dualSonderUrls = [u0, u1];
            break;
          }
        }
        if (dualSonderUrls) break;
      }
    }

    if (isSonder && dualSonderUrls) {
      const [revFirst, obvSecond] = dualSonderUrls;
      imageSet.add(obvSecond);
      imageSet.add(revFirst);
    } else if (isSonder && imgCol) {
      collectFrom(imgCol);
      if (imageSet.size === 0) {
        collectFrom(imgRoot);
        for (const n of document.querySelectorAll(
          "picture source[srcset], picture img, img[src], img[data-src], meta[property='og:image'][content]"
        )) {
          pushUrl(imageSet, n.getAttribute && n.getAttribute("src"));
          pushUrl(imageSet, n.getAttribute && n.getAttribute("data-src"));
          pushUrl(imageSet, n.getAttribute && n.getAttribute("srcset"));
          pushUrl(imageSet, n.getAttribute && n.getAttribute("content"));
        }
      }
    } else if (isShop) {
      const mainEl = document.querySelector("main") || document.body;
      const alsoHeading = Array.from(mainEl.querySelectorAll("h1, h2, h3, h4")).find((h) =>
        /you may also like|das könnte sie interessieren|voir aussi/i.test(txt(h))
      );
      const afterAlso = (el) =>
        alsoHeading && (alsoHeading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      const stopSell = (el) =>
        el.closest(
          "[class*='similar'], [class*='cross-sell'], [class*='recommend'], [class*='otherProducts'], .you-may-also"
        );
      const collectSlide = (root) => {
        if (!root || stopSell(root) || afterAlso(root)) return;
        collectFrom(root);
      };
      const slides = mainEl.querySelectorAll(".slide.ng-star-inserted");
      if (slides.length > 0) {
        for (const slide of slides) collectSlide(slide);
      } else {
        for (const slide of mainEl.querySelectorAll(".slide.active.ng-star-inserted")) collectSlide(slide);
        for (const slide of mainEl.querySelectorAll(".slide.ng-star-inserted:not(.active)")) collectSlide(slide);
      }
      if (imageSet.size < 2) {
        for (const img of mainEl.querySelectorAll("img[data-lazy-src], img[data-src], img[src]")) {
          if (stopSell(img) || afterAlso(img)) continue;
          pushUrl(imageSet, img.getAttribute("data-lazy-src"));
          pushUrl(imageSet, img.getAttribute("data-lazy-srcset"));
          pushUrl(imageSet, img.getAttribute("src"));
          pushUrl(imageSet, img.getAttribute("data-src"));
          pushUrl(imageSet, img.getAttribute("srcset"));
        }
      }
      if (imageSet.size < 2) {
        for (const wrap of mainEl.querySelectorAll(".container.ng-star-inserted")) {
          if (stopSell(wrap) || afterAlso(wrap)) continue;
          collectFrom(wrap);
        }
      }
      if (imageSet.size < 2) collectFrom(mainEl);
    } else {
      collectFrom(imgRoot);
      for (const n of document.querySelectorAll("img[src], img[data-src], source[srcset], meta[property='og:image'][content]")) {
        pushUrl(imageSet, n.getAttribute && n.getAttribute("src"));
        pushUrl(imageSet, n.getAttribute && n.getAttribute("data-src"));
        pushUrl(imageSet, n.getAttribute && n.getAttribute("srcset"));
        pushUrl(imageSet, n.getAttribute && n.getAttribute("content"));
      }
    }

    return {
      title,
      description,
      specsText,
      imageUrls: Array.from(imageSet),
      usedDualSonderColumns: Boolean(dualSonderUrls),
    };
  });

  let shopModalUrls = [];
  if (/swissmintshop\.admin\.ch/i.test(sourceUrl)) {
    try {
      shopModalUrls = await scrapeSwissmintShopModalImageUrls(page);
    } catch {
      shopModalUrls = [];
    }
  }

  const specsBlob =
    /swissmintshop\.admin\.ch/i.test(sourceUrl) ? extractSwissmintShopSpecsBlob(parsed.specsText) : parsed.specsText;
  const specs = parseSpecPairs(specsBlob);
  const title = salvageTitle(parsed.title, parsed.specsText, sourceUrl);
  let mergedImageUrls = parsed.imageUrls;
  if (shopModalUrls.length > 0) {
    const seen = new Set(shopModalUrls);
    mergedImageUrls = [...shopModalUrls, ...parsed.imageUrls.filter((u) => !seen.has(u))];
  }
  let imageUrls = mergedImageUrls.filter((u) =>
    /sondermuenze\.ch|swissmintshop\.admin\.ch|swissmint|\/uploads\/|bbl\.admin\.ch|\/medias\/|\/media\//i.test(u)
  );
  if (isSonderListing) {
    imageUrls = imageUrls.filter((u) => /\/wp-content\/uploads\//i.test(u) && !/\/wp-content\/themes\//i.test(u));
    imageUrls = dedupeSondermuenzeImageUrls(imageUrls);
    if (!parsed.usedDualSonderColumns) imageUrls = orderSondermuenzeProductImages(imageUrls);
  } else if (/swissmintshop\.admin\.ch/i.test(sourceUrl)) {
    imageUrls = imageUrls.filter((u) => !/icon|favicon|logo|1x1|placeholder|spacer/i.test(u));
    imageUrls = dedupeSondermuenzeImageUrls(imageUrls);
  }
  return {
    source_url: sourceUrl,
    title: title || parsed.title,
    description: parsed.description,
    specs,
    specsText: parsed.specsText,
    imageUrls,
    parsedAt: new Date().toISOString(),
  };
}

async function saveParsed(parsed) {
  const source = normalizeUrl(parsed.source_url);
  const slug = slugFromUrl(source);
  const isSwissmintShop = /swissmintshop\.admin\.ch/i.test(source);

  let local = [];
  for (let i = 0; i < (parsed.imageUrls || []).length; i++) {
    const u = parsed.imageUrls[i];
    const tmp = path.join(os.tmpdir(), `sws-${slug}-${i}-${Date.now()}`);
    if (!(await download(u, tmp))) continue;
    let buf;
    try {
      buf = fs.readFileSync(tmp);
    } catch {
      continue;
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* empty */
    }
    try {
      local.push(await saveBufferAsForeignUnified(buf, slug, i + 1));
    } catch {
      /* empty */
    }
  }

  const publicRoot = path.join(ROOT, "public");
  const fileSizeOnDisk = (rel) => {
    try {
      return fs.statSync(path.join(publicRoot, rel.replace(/^\//, ""))).size;
    } catch {
      return 0;
    }
  };
  /** Витрина swissmintshop: LQIP/blur webp часто <8 KB, полноразмерные кадры слайда — заметно больше. */
  if (local.length > 0) {
    const sizes = local.map(fileSizeOnDisk);
    const MIN_HI = 8000;
    const maxS = Math.max(...sizes);
    if (maxS >= MIN_HI) local = local.filter((rel) => fileSizeOnDisk(rel) >= MIN_HI);
  }

  /** Первый кадр с витрины часто отдаётся как SVG-плейсхолдер — для аверса берём первый растровый файл. */
  if (local.length >= 1 && /\.svg$/i.test(local[0])) {
    const idx = local.findIndex((p, i) => i > 0 && /\.(webp|jpe?g|png)$/i.test(p));
    if (idx > 0) {
      const [raster] = local.splice(idx, 1);
      local.unshift(raster);
    }
  }

  if (isSwissmintShop && local.length > 0) {
    const picked = swissmintShopPickFourLocals(local);
    const drop = new Set(local.filter((r) => !picked.includes(r)));
    for (const rel of drop) {
      const abs = path.join(publicRoot, rel.replace(/^\//, ""));
      try {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch {
        /* empty */
      }
    }
    local = picked;
  }

  const out = {
    coin: {
      ...parsed,
      source_url: source,
      slug,
      imageUrls: local,
      image_obverse: local[0] || null,
      image_reverse: local[1] || local[0] || null,
      ...(isSwissmintShop && local.length > 0
        ? { imageUrlRoles: [...SWISSMINT_SHOP_IMAGE_ROLES].slice(0, local.length) }
        : {}),
    },
  };
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, `swissmint-${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
  return { outFile, imageCount: local.length };
}

async function fetchOneWithPage(page, rawUrl) {
  const source = normalizeUrl(rawUrl);
  const parsed = await parseProduct(page, source);
  return saveParsed(parsed);
}

async function main() {
  const rawUrl = process.argv.find((x) => /^https?:\/\//i.test(x));
  if (!rawUrl) {
    console.error('Укажите URL: node scripts/fetch-swissmint-product.js "https://..."');
    process.exit(1);
  }
  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  const result = await fetchOneWithPage(page, rawUrl);
  await browser.close();
  console.log("Готово:", result.outFile, "Картинок:", result.imageCount);
}

module.exports = {
  normalizeUrl,
  slugFromUrl,
  parseProduct,
  fetchOneWithPage,
  extractSwissmintShopSpecsBlob,
  salvageTitle,
  parseSpecPairs,
  humanTitleFromUrl,
  fileKindFromBuffer,
  slugifyCoinTitle,
  swissmintShopPickFourLocals,
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

