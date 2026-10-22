import { GET as yahooSnapshot } from "../route";
import { RATE_CODES, selectAdoptedRates, type RateMap } from "@/lib/adopted-rates";

export const dynamic = "force-dynamic";
export const runtime = "edge";
const CACHE_MS = 5000;
type Snapshot = ReturnType<typeof selectAdoptedRates> & { fetchedAt: number; pollSeconds: number; policy: string };
let cached: { at: number; value: Snapshot } | undefined;
let pending: Promise<Snapshot> | undefined;

async function fetchOandaSnapshot(): Promise<RateMap> {
  const token = process.env.OANDA_API_TOKEN, account = process.env.OANDA_ACCOUNT_ID;
  if (!token || !account) return {};
  const base = process.env.OANDA_ENVIRONMENT?.toLowerCase() === "live"
    ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com";
  const url = new URL(`/v3/accounts/${encodeURIComponent(account)}/pricing`, base);
  url.searchParams.set("instruments", RATE_CODES.map(c => c.replace("/", "_")).join(","));
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(7000), headers: {
      Authorization: `Bearer ${token}`, "Accept-Datetime-Format": "RFC3339", "OANDA-Agent": "FX-Rate-Speaker-shared/1.0",
    }});
    if (!response.ok) return {};
    const data = await response.json() as { prices?: Array<{ instrument: string; time: string; bids?: Array<{price: string}>; asks?: Array<{price: string}> }> };
    const rates: RateMap = {};
    for (const item of data.prices ?? []) {
      const bid = Number(item.bids?.[0]?.price), ask = Number(item.asks?.[0]?.price), timestamp = Math.floor(Date.parse(item.time) / 1000);
      if (bid > 0 && ask > 0 && Number.isFinite(timestamp)) rates[item.instrument.replace("_", "/")] = {price:(bid+ask)/2, timestamp};
    }
    return rates;
  } catch { return {}; }
}

export async function currentSnapshot(): Promise<Snapshot> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    const oanda = await fetchOandaSnapshot();
    // Reuse the existing Yahoo direct/cross/meta-vs-close endpoint only when needed.
    let yahoo: RateMap = {};
    if (Object.keys(selectAdoptedRates(oanda, {}).rates).length < RATE_CODES.length) {
      try {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const response = await Promise.race([yahooSnapshot(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Yahoo snapshot timeout")), 7000); })]);
          if (response.ok) yahoo = (await response.json()).rates ?? {};
        } finally { clearTimeout(timeout); }
      } catch { /* Partial OANDA data remains usable. */ }
    }
    const value = {...selectAdoptedRates(oanda, yahoo), fetchedAt:Math.floor(Date.now()/1000), pollSeconds:10,
      policy:"Speaker shared adoption: OANDA mid > OANDA cross > Yahoo existing direct/cross"};
    cached = {at:Date.now(), value};
    return value;
  })();
  try { return await pending; } finally { pending = undefined; }
}

export async function GET() {
  const snapshot = await currentSnapshot();
  return Response.json(snapshot, {status:Object.keys(snapshot.rates).length ? 200 : 502,
    headers:{"Cache-Control":"no-store", "CDN-Cache-Control":"no-store"}});
}
