export const dynamic = "force-dynamic";
export const runtime = "edge";

const OANDA_INSTRUMENTS = ["EUR_USD", "GBP_USD", "EUR_GBP"];

type OandaPrice = {
  type?: string;
  instrument?: string;
  time?: string;
  bids?: Array<{ price?: string }>;
  asks?: Array<{ price?: string }>;
};

function environmentBase(environment: string | undefined) {
  return environment?.toLowerCase() === "live"
    ? "https://stream-fxtrade.oanda.com"
    : "https://stream-fxpractice.oanda.com";
}

export async function GET(request: Request) {
  const token = process.env.OANDA_API_TOKEN;
  const accountId = process.env.OANDA_ACCOUNT_ID;
  if (!token || !accountId) {
    return Response.json({
      enabled: false,
      error: "OANDA shadow is not configured",
      requiredEnvironmentVariables: ["OANDA_API_TOKEN", "OANDA_ACCOUNT_ID", "OANDA_ENVIRONMENT"],
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const url = new URL(`/v3/accounts/${encodeURIComponent(accountId)}/pricing/stream`, environmentBase(process.env.OANDA_ENVIRONMENT));
  url.searchParams.set("instruments", OANDA_INSTRUMENTS.join(","));
  url.searchParams.set("snapshot", "true");

  const upstream = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Datetime-Format": "RFC3339",
      "OANDA-Agent": "FX-Rate-Speaker-shadow/1.0",
    },
    cache: "no-store",
    signal: request.signal,
  });
  if (!upstream.ok || !upstream.body) {
    return Response.json({ enabled: true, error: `OANDA stream error ${upstream.status}` }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let remainder = "";
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        if (remainder.trim()) controller.enqueue(encoder.encode(`data: ${remainder.trim()}\n\n`));
        controller.close();
        return;
      }
      remainder += decoder.decode(value, { stream: true });
      const lines = remainder.split("\n");
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line) as OandaPrice;
          if (item.type === "HEARTBEAT") {
            controller.enqueue(encoder.encode(`: heartbeat ${item.time ?? ""}\n\n`));
            continue;
          }
          const bid = Number(item.bids?.[0]?.price);
          const ask = Number(item.asks?.[0]?.price);
          if (!item.instrument || !item.time || !Number.isFinite(bid) || !Number.isFinite(ask)) continue;
          const payload = JSON.stringify({
            symbol: item.instrument.replace("_", "/"),
            bid,
            ask,
            mid: (bid + ask) / 2,
            providerTimestamp: item.time,
            receivedTimestamp: Date.now(),
          });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          // Ignore a malformed upstream line without closing the shadow stream.
        }
      }
    },
    async cancel() {
      await reader.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-cache, max-age=0",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
