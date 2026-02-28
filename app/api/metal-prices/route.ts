import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CBR_SOAP_URL = "https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx";

type DataPoint = { label: string; value: number };

/** Кэш на 5 минут */
const cache = new Map<string, { data: unknown; until: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/** ЦБ РФ: CodMet 1=Золото, 2=Серебро, 3=Платина, 4=Палладий. Цены уже в руб/г. */
const CBR_COD_TO_SYMBOL: Record<number, "XAU" | "XAG" | "XPT" | "XPD"> = {
  1: "XAU", 2: "XAG", 3: "XPT", 4: "XPD",
};

/** Запрос к ЦБ РФ (SOAP DragMetDynamic). Учётные цены в руб/г, без лимитов. */
async function fetchCbrMetals(period: string): Promise<{ ok: true; period: string; source: "cbr"; XAU: DataPoint[]; XAG: DataPoint[]; XPT: DataPoint[]; XPD: DataPoint[] } | null> {
  const ranges = getDateRange(period);
  if (!ranges.length) return null;
  const all: { date: string; cod: number; price: number }[] = [];
  for (const { start, end } of ranges) {
    // ЦБ ожидает fromDate/ToDate в формате dateTime (иначе возвращает пустой ответ)
    const fromDateTime = `${start}T00:00:00`;
    const toDateTime = `${end}T00:00:00`;
    const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><DragMetDynamic xmlns="http://web.cbr.ru/"><fromDate>${fromDateTime}</fromDate><ToDate>${toDateTime}</ToDate></DragMetDynamic></soap:Body></soap:Envelope>`;
    try {
      const res = await fetch(CBR_SOAP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "SOAPAction": "http://web.cbr.ru/DragMetDynamic",
        },
        body,
      });
      const xml = await res.text();
      const drgMatches = xml.matchAll(/<DrgMet[^>]*>([\s\S]*?)<\/DrgMet>/gi);
      for (const m of drgMatches) {
        const block = m[1];
        const dateMet = block.match(/<DateMet[^>]*>([^<]+)</)?.[1];
        const codMet = block.match(/<CodMet[^>]*>([^<]+)</)?.[1];
        const price = block.match(/<price[^>]*>([^<]+)</)?.[1];
        if (dateMet && codMet && price) {
          const date = dateMet.slice(0, 10);
          all.push({ date, cod: Number(codMet), price: Number(price.replace(",", ".")) });
        }
      }
    } catch {
      return null;
    }
  }
  if (!all.length) return null;
  const byDate = new Map<string, { xau: number; xag: number; xpt: number; xpd: number }>();
  for (const { date, cod, price } of all) {
    const sym = CBR_COD_TO_SYMBOL[cod];
    if (!sym) continue;
    let row = byDate.get(date);
    if (!row) { row = { xau: 0, xag: 0, xpt: 0, xpd: 0 }; byDate.set(date, row); }
    if (sym === "XAU") row.xau = price;
    else if (sym === "XAG") row.xag = price;
    else if (sym === "XPT") row.xpt = price;
    else row.xpd = price;
  }
  const dates = Array.from(byDate.keys()).sort();
  const rows = dates.map((d) => ({ date: d, ...byDate.get(d)! }));
  let sampled: { label: string; xau: number; xag: number; xpt: number; xpd: number }[];
  if (period === "all") {
    const byMonth = new Map<string, (typeof rows)[0]>();
    for (const r of rows) {
      const key = r.date.slice(0, 7);
      byMonth.set(key, r);
    }
    const keys = Array.from(byMonth.keys()).sort();
    sampled = keys.map((k) => {
      const r = byMonth.get(k)!;
      const d = new Date(r.date + "T12:00:00");
      return {
        label: d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" }),
        xau: r.xau,
        xag: r.xag,
        xpt: r.xpt,
        xpd: r.xpd,
      };
    });
  } else if (period === "5y" || period === "10y") {
    // Одна точка за неделю (последний день недели по понедельнику)
    const getWeekKey = (dateStr: string) => {
      const d = new Date(dateStr + "T12:00:00");
      const day = d.getDay();
      const mon = new Date(d);
      mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      return mon.toISOString().slice(0, 10);
    };
    const byWeek = new Map<string, (typeof rows)[0]>();
    rows.forEach((r) => byWeek.set(getWeekKey(r.date), r));
    const keys = Array.from(byWeek.keys()).sort();
    sampled = keys.map((k) => {
      const r = byWeek.get(k)!;
      return { label: new Date(r.date).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "2-digit" }), xau: r.xau, xag: r.xag, xpt: r.xpt, xpd: r.xpd };
    });
  } else {
    // 1m, 1y — по дням
    sampled = rows.map((r) => {
      const d = new Date(r.date + "T12:00:00");
      const formatOptions =
        period === "1y"
          ? { day: "numeric", month: "short", year: "2-digit" }
          : { day: "numeric", month: "short" };
      return {
        label: d.toLocaleDateString("ru-RU", formatOptions),
        xau: r.xau,
        xag: r.xag,
        xpt: r.xpt,
        xpd: r.xpd,
      };
    });
  }
  return {
    ok: true,
    period,
    source: "cbr" as const,
    XAU: sampled.map((s) => ({ label: s.label, value: Math.round(s.xau * 100) / 100 })),
    XAG: sampled.map((s) => ({ label: s.label, value: Math.round(s.xag * 100) / 100 })),
    XPT: sampled.map((s) => ({ label: s.label, value: Math.round(s.xpt * 100) / 100 })),
    XPD: sampled.map((s) => ({ label: s.label, value: Math.round(s.xpd * 100) / 100 })),
  };
}

/** Период → интервал дат (для timeframe: макс 365 дней за запрос) */
function getDateRange(period: string): { start: string; end: string }[] {
  const end = new Date();
  const to = (d: Date) => d.toISOString().slice(0, 10);
  const CBR_FIRST_DATE = "2003-07-07";

  if (period === "1m") {
    const start = new Date(end); start.setMonth(start.getMonth() - 1);
    return [{ start: to(start), end: to(end) }];
  }
  if (period === "1y") {
    const start = new Date(end); start.setFullYear(start.getFullYear() - 1);
    return [{ start: to(start), end: to(end) }];
  }
  if (period === "5y") {
    return Array.from({ length: 5 }, (_, i) => {
      const yEnd = new Date(end); yEnd.setFullYear(yEnd.getFullYear() - (4 - i));
      const yStart = new Date(yEnd); yStart.setFullYear(yStart.getFullYear() - 1);
      return { start: to(yStart), end: to(yEnd) };
    });
  }
  if (period === "10y") {
    return Array.from({ length: 10 }, (_, i) => {
      const yEnd = new Date(end); yEnd.setFullYear(yEnd.getFullYear() - (9 - i));
      const yStart = new Date(yEnd); yStart.setFullYear(yStart.getFullYear() - 1);
      return { start: to(yStart), end: to(yEnd) };
    });
  }
  if (period === "all") {
    const endStr = to(end);
    const ranges: { start: string; end: string }[] = [];
    let cur = new Date(CBR_FIRST_DATE + "T12:00:00");
    while (cur < end) {
      const next = new Date(cur);
      next.setFullYear(next.getFullYear() + 1);
      const startStr = to(cur);
      const endStrChunk = next > end ? endStr : to(new Date(next.getTime() - 86400000));
      ranges.push({ start: startStr, end: endStrChunk });
      cur = next;
    }
    return ranges;
  }
  return [];
}

export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get("period") || "1y";
  const cached = cache.get(period);
  if (cached && cached.until > Date.now()) {
    return NextResponse.json(cached.data);
  }

  const ranges = getDateRange(period);
  if (!ranges.length) {
    return NextResponse.json({ ok: false, error: "invalid_period" }, { status: 400 });
  }

  const cbrResult = await fetchCbrMetals(period);
  if (cbrResult?.ok && cbrResult.XAU?.length) {
    cache.set(period, { data: cbrResult, until: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(cbrResult);
  }

  return NextResponse.json({ ok: false, error: "no_data" }, { status: 200 });
}
