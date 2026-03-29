/**
 * У картинок каталога monnaiedeparis.fr Magento часто отдаёт миниатюру (120×120)
 * для последнего слайда при том же basename — подменяем на типичный PDP-размер 700×700.
 * Используются: патч JSON, можно вызывать из других скриптов.
 */

function upgradeMdpCatalogProductUrl(u) {
  if (!u || typeof u !== "string") return u;
  const s = u.trim();
  if (!/\/media\/catalog\/product\//i.test(s)) return u;
  try {
    const url = new URL(s);
    const w = parseInt(url.searchParams.get("width") || "0", 10);
    const h = parseInt(url.searchParams.get("height") || "0", 10);
    if ((w > 0 && w < 400) || (h > 0 && h < 400)) {
      url.searchParams.set("optimize", "medium");
      url.searchParams.set("fit", "bounds");
      url.searchParams.set("height", "700");
      url.searchParams.set("width", "700");
      url.searchParams.set("canvas", "700:700");
    }
    return url.toString();
  } catch {
    return u;
  }
}

module.exports = { upgradeMdpCatalogProductUrl };
