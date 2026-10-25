import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { extractAnalysisSignals, type AnalysisSourceType } from "@/lib/analysis-structure";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["ACTIVE", "HOLD", "INVALID", "EXPIRED", "ARCHIVED"]);

async function database() {
  try {
    const cloudflare = await import("cloudflare:workers");
    return cloudflare.env.DB ?? null;
  } catch { return null; }
}

async function requireAdmin() {
  const user = await getChatGPTUser();
  const admins = new Set((process.env.FXRS_ADMIN_EMAILS ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean));
  if (!user) return { error: NextResponse.json({ error: "認証が必要です" }, { status: 401 }) };
  if (!admins.has(user.email.toLowerCase())) return { error: NextResponse.json({ error: "管理権限がありません" }, { status: 403 }) };
  return { user };
}

function text(value: unknown, max = 40) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

async function hash(parts: string[]) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\n").toLowerCase()));
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const db = await database();
  if (!db) return NextResponse.json({ error: "保存先を利用できません" }, { status: 503 });
  const now = Date.now();
  const analyses = await db.prepare(`SELECT id, created_at, publish_at, analysis_at, expires_at, headline, body,
    source_type, source_label, status, retention_days FROM market_analyses ORDER BY created_at DESC LIMIT 100`).all();
  const signals = await db.prepare(`SELECT id, analysis_id, pair, stance, level_low, level_high, trigger, condition_text,
    invalidation_text, message, environment, price_role, status, expires_at FROM analysis_signals ORDER BY created_at ASC LIMIT 500`).all();
  const signalRows = (signals.results ?? []) as Array<Record<string, unknown>>;
  return NextResponse.json({ now, analyses: ((analyses.results ?? []) as Array<Record<string, unknown>>).map((row) => {
    const own = signalRows.filter((signal) => signal.analysis_id === row.id);
    return {
      id: row.id, createdAt: row.created_at, publishAt: row.publish_at, analysisAt: row.analysis_at, expiresAt: row.expires_at,
      headline: row.headline, body: row.body, sourceType: row.source_type, sourceLabel: row.source_label,
      status: row.status, effectiveStatus: Number(row.expires_at) <= now && row.status === "ACTIVE" ? "EXPIRED" : row.status,
      retentionDays: row.retention_days, signals: own.map((signal) => ({
        id: signal.id, pair: signal.pair, stance: signal.stance, levelLow: signal.level_low, levelHigh: signal.level_high,
        trigger: signal.trigger, conditionText: signal.condition_text, invalidationText: signal.invalidation_text,
        message: signal.message, environment: signal.environment, priceRole: signal.price_role, status: signal.status,
        effectiveStatus: Number(signal.expires_at) <= now && signal.status === "ACTIVE" ? "EXPIRED" : signal.status,
      })),
    };
  }) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const db = await database();
  if (!db) return NextResponse.json({ error: "保存先を利用できません" }, { status: 503 });
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "JSON形式が不正です" }, { status: 400 }); }
  const action = text(payload.action, 20);
  const id = text(payload.id, 80);
  if (!id) return NextResponse.json({ error: "対象がありません" }, { status: 400 });

  if (action === "analysis-status" || action === "signal-status") {
    const status = text(payload.status, 16);
    if (!STATUSES.has(status)) return NextResponse.json({ error: "状態が不正です" }, { status: 400 });
    const table = action === "analysis-status" ? "market_analyses" : "analysis_signals";
    const statements = [db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).bind(status, id)];
    if (action === "analysis-status" && status !== "ACTIVE") statements.push(db.prepare("UPDATE analysis_signals SET status = ? WHERE analysis_id = ? AND status = 'ACTIVE'").bind(status, id));
    await db.batch(statements);
    return NextResponse.json({ ok: true });
  }

  if (action === "update-analysis") {
    const expiresAt = Number(payload.expiresAt);
    const retentionDays = Math.min(365, Math.max(7, Number(payload.retentionDays) || 90));
    if (!Number.isFinite(expiresAt)) return NextResponse.json({ error: "有効期限が不正です" }, { status: 400 });
    await db.batch([
      db.prepare("UPDATE market_analyses SET expires_at = ?, retention_days = ?, status = CASE WHEN status = 'EXPIRED' AND ? > ? THEN 'ACTIVE' ELSE status END WHERE id = ?").bind(expiresAt, retentionDays, expiresAt, Date.now(), id),
      db.prepare("UPDATE analysis_signals SET expires_at = ? WHERE analysis_id = ?").bind(expiresAt, id),
    ]);
    return NextResponse.json({ ok: true });
  }

  if (action === "reextract") {
    const row = await db.prepare("SELECT id, body, source_type, publish_at, analysis_at, expires_at FROM market_analyses WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!row) return NextResponse.json({ error: "原稿が見つかりません" }, { status: 404 });
    const extracted = extractAnalysisSignals({ body: String(row.body), sourceType: String(row.source_type) as AnalysisSourceType });
    const existing = await db.prepare("SELECT COUNT(*) AS count FROM analysis_signals WHERE analysis_id = ?").bind(id).first<{ count: number }>();
    if (Number(existing?.count ?? 0) > 0) return NextResponse.json({ error: "抽出情報が既にあるため再解析しません" }, { status: 409 });
    const statements = [];
    for (const signal of extracted) {
      const key = await hash([id, signal.pair, String(signal.levelLow), String(signal.levelHigh), signal.trigger, signal.priceRole]);
      statements.push(db.prepare(`INSERT OR IGNORE INTO analysis_signals
        (id, analysis_id, created_at, publish_at, analysis_at, expires_at, source_type, pair, stance, level_low, level_high,
        trigger, condition_text, invalidation_text, source_excerpt, message, environment, price_role, status, dedupe_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'HOLD', ?)`)
        .bind(crypto.randomUUID(), id, Date.now(), row.publish_at, row.analysis_at, row.expires_at, row.source_type,
          signal.pair, signal.stance, signal.levelLow, signal.levelHigh, signal.trigger, signal.conditionText,
          signal.invalidationText, signal.sourceExcerpt, signal.message, signal.environment, signal.priceRole, key));
    }
    if (statements.length) await db.batch(statements);
    return NextResponse.json({ ok: true, extracted: extracted.length, note: "安全のため保留で保存しました" });
  }
  return NextResponse.json({ error: "操作が不正です" }, { status: 400 });
}
