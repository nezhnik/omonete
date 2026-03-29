/**
 * Мягкая навигация Monnaie de Paris (Playwright): быстрее, чем networkidle на Magento.
 * Переопределение через env:
 *   MDP_GOTO_UNTIL — load | domcontentloaded | networkidle (по умолчанию load)
 *   MDP_GOTO_TIMEOUT_MS — таймаут goto (по умолчанию 60000)
 *   MDP_SEL_MAIN_MS — ожидание блока товара/таблицы (по умолчанию 14000)
 *   MDP_SEL_IMG_MS — ожидание картинки Fotorama (по умолчанию 22000)
 *   MDP_LISTING_GRID_MS — сетка товара на листинге (по умолчанию 60000)
 */

function mdpPageGotoOptions() {
  const waitUntil = process.env.MDP_GOTO_UNTIL || "load";
  const timeout = Math.max(5000, parseInt(process.env.MDP_GOTO_TIMEOUT_MS || "60000", 10) || 60000);
  return { waitUntil, timeout };
}

/** Для page.waitForLoadState после клика/перехода — то же имя фазы, что и у goto. */
function mdpPostNavigationLoadState() {
  const w = process.env.MDP_GOTO_UNTIL || "load";
  if (w === "networkidle" || w === "load" || w === "domcontentloaded") return w;
  return "load";
}

function mdpSelectorTimeoutsMs() {
  return {
    main: Math.max(3000, parseInt(process.env.MDP_SEL_MAIN_MS || "14000", 10) || 14000),
    img: Math.max(3000, parseInt(process.env.MDP_SEL_IMG_MS || "22000", 10) || 22000),
  };
}

function mdpListingGridTimeoutMs() {
  return Math.max(10000, parseInt(process.env.MDP_LISTING_GRID_MS || "60000", 10) || 60000);
}

module.exports = {
  mdpPageGotoOptions,
  mdpPostNavigationLoadState,
  mdpSelectorTimeoutsMs,
  mdpListingGridTimeoutMs,
};
