import { z } from "zod";
import { isLocal, sha256, type AuthEnv } from "./auth.ts";
import {
  backupSchema,
  captureSchema,
  eventId,
  localDay,
  normalize,
  reviewSchema,
  schedule,
  type Card,
} from "./domain.ts";

export interface Env extends AuthEnv {
  DB: D1Database;
  ASSETS: Fetcher;
}
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const json = (value: unknown, status = 200) => Response.json(value, { status });
async function body(request: Request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new ApiError(415, "Use application/json");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Missing JSON body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 5_000_000) {
      await reader.cancel();
      throw new ApiError(413, "Request exceeds 5 MB");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
}
async function mutation(
  db: D1Database,
  id: string,
  kind: string,
  payload: object,
) {
  const text = JSON.stringify(payload);
  await db
    .prepare("insert or ignore into mutations values (?, ?, ?)")
    .bind(id, kind, text)
    .run();
  const saved = await db
    .prepare("select kind, payload from mutations where id = ?")
    .bind(id)
    .first<{ kind: string; payload: string }>();
  if (saved?.kind !== kind || saved.payload !== text)
    throw new ApiError(409, "Event ID already used with different data");
}
async function capture(request: Request, env: Env, manual = false) {
  if (!manual) {
    const bearer = request.headers
      .get("Authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (
      !bearer ||
      !(await env.DB.prepare(
        "select id from tokens where hash = ? and revoked is null",
      )
        .bind(await sha256(bearer))
        .first())
    )
      throw new ApiError(401, "Invalid or revoked capture token");
  }
  const input = captureSchema.parse(await body(request));
  const normalized = normalize(input.sourceText);
  const payload = JSON.stringify({
    ...input,
    cardId: await sha256(normalized),
    normalized,
  });
  await env.DB.prepare("insert or ignore into captures values (?, ?, ?)")
    .bind(input.eventId, payload, Date.now())
    .run();
  const saved = await env.DB.prepare(
    "select payload from captures where id = ?",
  )
    .bind(input.eventId)
    .first<{ payload: string }>();
  if (saved?.payload !== payload)
    throw new ApiError(409, "Event ID already used with different data");
  return json({ status: "accepted", eventId: input.eventId });
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const db = env.DB;
  if (path === "/api/captures" && request.method === "POST")
    return capture(request, env);
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = isLocal(request, env) ? url.origin : env.APP_ORIGIN;
    if (url.origin !== origin || request.headers.get("Origin") !== origin)
      throw new ApiError(403, "Same-origin request required");
  }
  if (path === "/api/manual" && request.method === "POST")
    return capture(request, env, true);
  if (path === "/api/state" && request.method === "GET") {
    const now = Date.now();
    const day = localDay(now);
    const result = await db.batch<Record<string, unknown>>([
      db.prepare("select * from cards order by updated desc"),
      db.prepare("select daily_limit from settings where id = 1"),
      db
        .prepare(
          "select count(*) as n from reviews where day = ? and was_new = 1",
        )
        .bind(day),
      db.prepare(
        "select id, created, revoked from tokens order by created desc",
      ),
      db.prepare("select count(*) as n from reviews where day = ?").bind(day),
    ]);
    const cards = result[0].results as Card[];
    const limit = Number(result[1].results[0].daily_limit);
    const introduced = Number(result[2].results[0].n);
    const due = cards
      .filter(
        (c) => c.status === "active" && c.introduced !== null && c.due <= now,
      )
      .sort((a, b) => a.due - b.due);
    const fresh = cards
      .filter((c) => c.status === "active" && c.introduced === null)
      .sort((a, b) => a.created - b.created)
      .slice(0, Math.max(0, limit - introduced));
    return json({
      cards,
      queue: [...due, ...fresh],
      dueCount: due.length,
      newRemaining: Math.max(0, limit - introduced),
      introduced,
      dailyLimit: limit,
      reviewed: result[4].results[0].n,
      tokens: result[3].results,
      day,
      local: isLocal(request, env),
    });
  }
  if (path === "/api/reviews" && request.method === "POST") {
    const input = reviewSchema.parse(await body(request));
    const prior = await db
      .prepare("select * from reviews where id = ?")
      .bind(input.eventId)
      .first();
    if (prior) {
      if (prior.card_id !== input.cardId || prior.grade !== input.grade)
        throw new ApiError(409, "Event ID already used with different data");
      return json({ status: "recorded", duplicate: true });
    }
    const card = await db
      .prepare("select * from cards where id = ?")
      .bind(input.cardId)
      .first<Card>();
    if (!card || card.version !== input.version || card.status !== "active")
      throw new ApiError(409, "Card changed. Refresh your review.");
    const now = Date.now();
    const next = schedule(card.step, input.grade, now);
    // Version predicate is evaluated inside the insertion, not merely the pre-read.
    const result = await db
      .prepare(
        `insert into reviews (id, card_id, grade, at, day, was_new, before_step, after_step, due)
      select ?, id, ?, ?, ?, introduced is null, step, ?, ? from cards where id = ? and version = ? and status = 'active' and due <= ?`,
      )
      .bind(
        input.eventId,
        input.grade,
        now,
        localDay(now),
        next.step,
        next.due,
        card.id,
        input.version,
        now,
      )
      .run();
    if (!result.meta.changes)
      throw new ApiError(409, "Card changed. Refresh your review.");
    return json({ status: "recorded", ...next });
  }
  if (path === "/api/settings" && request.method === "POST") {
    const input = z
      .object({ eventId, dailyLimit: z.number().int().min(0).max(100) })
      .strict()
      .parse(await body(request));
    await mutation(db, input.eventId, "settings", {
      dailyLimit: input.dailyLimit,
    });
    return json({ status: "saved" });
  }
  if (path === "/api/cards" && request.method === "POST") {
    const input = z
      .object({
        eventId,
        cardId: z.string(),
        status: z.enum(["active", "suspended", "deleted"]),
      })
      .strict()
      .parse(await body(request));
    if (
      !(await db
        .prepare("select id from cards where id = ?")
        .bind(input.cardId)
        .first())
    )
      throw new ApiError(404, "Card not found");
    await mutation(db, input.eventId, "card", {
      cardId: input.cardId,
      status: input.status,
    });
    return json({ status: "saved" });
  }
  if (path === "/api/tokens" && request.method === "POST") {
    const input = z
      .object({ eventId, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict()
      .parse(await body(request));
    const hash = await sha256(input.token);
    await db
      .prepare("insert or ignore into tokens (id,hash,created) values (?,?,?)")
      .bind(input.eventId, hash, Date.now())
      .run();
    const saved = await db
      .prepare("select hash,revoked from tokens where id = ?")
      .bind(input.eventId)
      .first();
    if (saved?.hash !== hash || saved.revoked !== null)
      throw new ApiError(409, "Pairing ID already used");
    return json({ status: "paired", id: input.eventId });
  }
  if (path === "/api/tokens/revoke" && request.method === "POST") {
    const input = z
      .object({ eventId, tokenId: z.string() })
      .strict()
      .parse(await body(request));
    // Use a stable payload; retries must not depend on a new timestamp.
    await mutation(db, input.eventId, "revoke", {
      tokenId: input.tokenId,
      at: 1,
    });
    return json({ status: "revoked" });
  }
  if (path === "/api/backup" && request.method === "GET") {
    const results = await db.batch<Record<string, unknown>>([
      db.prepare("select * from cards"),
      db.prepare("select * from reviews"),
      db.prepare("select * from captures"),
      db.prepare("select daily_limit from settings where id = 1"),
    ]);
    const backup = {
      format: "lookup-vocab/1",
      cards: results[0].results,
      reviews: results[1].results,
      captures: results[2].results,
      dailyLimit: results[3].results[0].daily_limit,
    };
    if (new TextEncoder().encode(JSON.stringify(backup)).length > 1_000_000)
      throw new ApiError(
        413,
        "Collection exceeds the 1 MB portable backup limit. Use a D1 SQL export; see setup instructions.",
      );
    return json(backup);
  }
  if (path === "/api/restore" && request.method === "POST") {
    const input = z
      .object({ eventId, backup: backupSchema })
      .strict()
      .parse(await body(request));
    if (
      new TextEncoder().encode(JSON.stringify(input.backup)).length > 1_000_000
    )
      throw new ApiError(
        413,
        "Portable backups are limited to 1 MB. Use a D1 SQL restore for larger collections.",
      );
    const hash = await sha256(JSON.stringify(input.backup));
    const prior = await db
      .prepare("select payload from mutations where id = ?")
      .bind(input.eventId)
      .first();
    if (prior) {
      if (prior.payload !== hash)
        throw new ApiError(409, "Restore ID already used");
      return json({ status: "restored", duplicate: true });
    }
    const b = input.backup;
    if (
      new Set(b.cards.map((c) => c.id)).size !== b.cards.length ||
      new Set(b.cards.map((c) => c.normalized)).size !== b.cards.length ||
      b.cards.some((c) => normalize(c.source) !== c.normalized)
    )
      throw new ApiError(400, "Invalid backup card identities");
    for (const card of b.cards) {
      if (card.id !== (await sha256(card.normalized)))
        throw new ApiError(400, "Invalid canonical card ID");
    }
    const ids = new Set(b.cards.map((c) => c.id));
    if (
      new Set(b.reviews.map((r) => r.id)).size !== b.reviews.length ||
      new Set(b.captures.map((c) => c.id)).size !== b.captures.length
    )
      throw new ApiError(400, "Duplicate backup event IDs");
    if (b.reviews.some((r) => !ids.has(r.card_id)))
      throw new ApiError(400, "Review references missing card");
    for (const c of b.captures) {
      let payload;
      try {
        payload = JSON.parse(c.payload);
      } catch {
        throw new ApiError(400, "Invalid capture backup");
      }
      if (!payload || typeof payload !== "object")
        throw new ApiError(400, "Invalid capture backup");
      captureSchema.parse({
        eventId: payload.eventId,
        sourceText: payload.sourceText,
        translatedText: payload.translatedText,
        sourceLanguage: payload.sourceLanguage,
        targetLanguage: payload.targetLanguage,
        capturedAt: payload.capturedAt,
      });
      if (
        payload.eventId !== c.id ||
        payload.normalized !== normalize(payload.sourceText) ||
        payload.cardId !== (await sha256(payload.normalized)) ||
        !ids.has(payload.cardId)
      )
        throw new ApiError(400, "Invalid capture backup identity");
    }
    // D1 batch is atomic; suppression prevents import from replaying captures/reviews.
    await db.batch([
      db.prepare("update settings set restoring = 1 where id = 1"),
      db.prepare("delete from reviews"),
      db.prepare("delete from captures"),
      db.prepare("delete from cards"),
      db
        .prepare(
          `insert into cards select json_extract(value,'$.id'),json_extract(value,'$.normalized'),json_extract(value,'$.source'),json_extract(value,'$.translation'),json_extract(value,'$.status'),json_extract(value,'$.step'),json_extract(value,'$.due'),json_extract(value,'$.introduced'),json_extract(value,'$.version'),json_extract(value,'$.lookups'),json_extract(value,'$.created'),json_extract(value,'$.updated') from json_each(?)`,
        )
        .bind(JSON.stringify(b.cards)),
      db
        .prepare(
          `insert into reviews select json_extract(value,'$.id'),json_extract(value,'$.card_id'),json_extract(value,'$.grade'),json_extract(value,'$.at'),json_extract(value,'$.day'),json_extract(value,'$.was_new'),json_extract(value,'$.before_step'),json_extract(value,'$.after_step'),json_extract(value,'$.due') from json_each(?)`,
        )
        .bind(JSON.stringify(b.reviews)),
      db
        .prepare(
          `insert into captures select json_extract(value,'$.id'),json_extract(value,'$.payload'),json_extract(value,'$.at') from json_each(?)`,
        )
        .bind(JSON.stringify(b.captures)),
      db
        .prepare(
          "update settings set daily_limit = ?, restoring = 0 where id = 1",
        )
        .bind(b.dailyLimit),
      db
        .prepare("insert into mutations values (?, ?, ?)")
        .bind(input.eventId, "restore", hash),
    ]);
    return json({ status: "restored" });
  }
  if (path.startsWith("/api/")) throw new ApiError(404, "Endpoint not found");
  if (!["GET", "HEAD"].includes(request.method))
    throw new ApiError(405, "Method not allowed");
  return env.ASSETS.fetch(request);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      if (error instanceof ApiError)
        response = json({ error: error.message }, error.status);
      else if (error instanceof z.ZodError)
        response = json(
          {
            error:
              "Invalid request. Check text length, language, timestamp and fields.",
          },
          400,
        );
      else if (
        error instanceof Error &&
        /daily_limit|stale_review|UNIQUE constraint/.test(error.message)
      )
        response = json(
          {
            error:
              "Review changed or daily new-card limit reached. Refresh and try again.",
          },
          409,
        );
      else
        response = json(
          { error: "Storage unavailable. Retry the same event ID." },
          503,
        );
    }
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Frame-Options", "DENY");
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    return new Response(response.body, { status: response.status, headers });
  },
};
