// Single adoption policy used by the Speaker stream UI and shared snapshot API.
export type Rate = { price: number; timestamp: number };
export type RateMap = Record<string, Rate>;
export type RateSource = "OANDA" | "OANDA_SYNTHETIC" | "YAHOO";
export const OANDA_PRIMARY_STALE_MS = 60 * 1000;
export const RATE_CODES = ["USD/JPY", "EUR/USD", "GBP/USD", "AUD/USD", "EUR/JPY", "GBP/JPY", "AUD/JPY", "EUR/GBP", "EUR/AUD", "GBP/AUD"];
export function freshOandaRate(oandaRates: RateMap, code: string, now = Date.now()) {
    const rate = oandaRates[code];
    if (!rate) return null;
    const age = now - rate.timestamp * 1000;
    return age >= -20_000 && age <= OANDA_PRIMARY_STALE_MS ? rate : null;
  }

export function syntheticOandaRate(oandaRates: RateMap, code: string, now = Date.now()): Rate | null {
    const direct = (symbol: string) => freshOandaRate(oandaRates, symbol, now);
    const cross = (left: Rate | null, right: Rate | null, operation: "multiply" | "divide") => {
      if (!left || !right || (operation === "divide" && right.price === 0)) return null;
      const price = operation === "multiply" ? left.price * right.price : left.price / right.price;
      return Number.isFinite(price) && price > 0
        ? { price, timestamp: Math.min(left.timestamp, right.timestamp) }
        : null;
    };
    if (code === "EUR/USD") return cross(direct("EUR/JPY"), direct("USD/JPY"), "divide");
    if (code === "GBP/USD") return cross(direct("GBP/JPY"), direct("USD/JPY"), "divide");
    if (code === "AUD/USD") return cross(direct("AUD/JPY"), direct("USD/JPY"), "divide");
    if (code === "EUR/JPY") return cross(direct("EUR/USD"), direct("USD/JPY"), "multiply");
    if (code === "GBP/JPY") return cross(direct("GBP/USD"), direct("USD/JPY"), "multiply");
    if (code === "AUD/JPY") return cross(direct("AUD/USD"), direct("USD/JPY"), "multiply");
    if (code === "EUR/GBP") return cross(direct("EUR/USD"), direct("GBP/USD"), "divide");
    if (code === "EUR/AUD") return cross(direct("EUR/USD"), direct("AUD/USD"), "divide");
    if (code === "GBP/AUD") return cross(direct("GBP/USD"), direct("AUD/USD"), "divide");
    if (code === "USD/JPY") {
      return cross(direct("EUR/JPY"), direct("EUR/USD"), "divide")
        ?? cross(direct("GBP/JPY"), direct("GBP/USD"), "divide");
    }
    return null;
  }


export function selectAdoptedRates(oandaRates: RateMap, yahooRates: RateMap, now = Date.now()) {
  const rates: RateMap = {}, sources: Record<string, RateSource> = {};
  for (const code of RATE_CODES) {
    const direct = freshOandaRate(oandaRates, code, now);
    const synthetic = direct ? null : syntheticOandaRate(oandaRates, code, now);
    const rate = direct ?? synthetic ?? yahooRates[code];
    if (!rate) continue;
    rates[code] = rate;
    sources[code] = direct ? "OANDA" : synthetic ? "OANDA_SYNTHETIC" : "YAHOO";
  }
  return { rates, sources };
}
