import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { type Env } from "../src/worker.ts";
import { localDay, normalize, schedule } from "../src/domain.ts";

// Real SQLite executes the actual migration and triggers. Only D1 transport is adapted.
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(new URL("../migrations/0001.sql", import.meta.url), "utf8"),
  );
  class Statement {
    sql: string;
    values: SQLInputValue[];
    constructor(sql: string, values: SQLInputValue[] = []) {
      this.sql = sql;
      this.values = values;
    }
    bind(...values: SQLInputValue[]) {
      return new Statement(this.sql, values);
    }
    async first() {
      return sqlite.prepare(this.sql).get(...this.values) ?? null;
    }
    async run() {
      const result = sqlite.prepare(this.sql).run(...this.values);
      return {
        success: true,
        results: [],
        meta: { changes: Number(result.changes) },
      };
    }
    async all() {
      return {
        success: true,
        results: sqlite.prepare(this.sql).all(...this.values),
        meta: { changes: 0 },
      };
    }
  }
  const db = {
    prepare(sql: string) {
      return new Statement(sql);
    },
    async batch(statements: Statement[]) {
      sqlite.exec("begin");
      try {
        const results = [];
        for (const s of statements)
          results.push(/^select/i.test(s.sql) ? await s.all() : await s.run());
        sqlite.exec("commit");
        return results;
      } catch (error) {
        sqlite.exec("rollback");
        throw error;
      }
    },
  };
  const env = {
    DB: db,
    LOCAL_DEV: "true",
    APP_ORIGIN: "https://vocab.lelouvincx.com",
    ASSETS: { fetch: async () => new Response("page") },
  } as unknown as Env;
  const request = async (
    path: string,
    data?: unknown,
    headers: Record<string, string> = {},
    local = true,
  ) => {
    const origin = local ? "http://127.0.0.1" : env.APP_ORIGIN;
    const response = await worker.fetch(
      new Request(origin + "/api/" + path, {
        method: data ? "POST" : "GET",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...headers,
        },
        body: data ? JSON.stringify(data) : undefined,
      }),
      local ? env : { ...env, LOCAL_DEV: undefined },
    );
    return { status: response.status, body: (await response.json()) as any };
  };
  const capture = (sourceText = "keep in mind", id = crypto.randomUUID()) => ({
    eventId: id,
    sourceText,
    translatedText: "ghi nhớ",
    sourceLanguage: "en",
    targetLanguage: "vi",
    capturedAt: "2026-10-17T12:00:00Z",
  });
  return { sqlite, request, capture };
}
test("scheduler, conservative identity and Vietnam midnight", () => {
  assert.equal(normalize("  Keep\n in  mind "), "Keep in mind");
  assert.notEqual(normalize("US"), normalize("us"));
  for (let step = 0; step <= 5; step++) {
    assert.equal(
      schedule(step, "remembered", 0).due,
      [1, 3, 7, 14, 30, 30][step] * 86400000,
    );
    assert.deepEqual(schedule(step, "forgot", 0), { step: 0, due: 600000 });
  }
  assert.equal(localDay(Date.parse("2026-10-17T16:59:59Z")), "2026-10-17");
  assert.equal(localDay(Date.parse("2026-10-17T17:00:00Z")), "2026-10-18");
});
test("capture retry is exactly-once; true repeat preserves history and pulls due; suspension is sticky", async () => {
  const { request, capture, sqlite } = fixture();
  const input = capture();
  assert.equal((await request("manual", input)).status, 200);
  assert.equal((await request("manual", input)).status, 200);
  let s = (await request("state")).body;
  assert.equal(s.cards.length, 1);
  assert.equal(s.cards[0].lookups, 1);
  const card = s.queue[0];
  const review = {
    eventId: crypto.randomUUID(),
    cardId: card.id,
    version: card.version,
    grade: "remembered",
  };
  assert.equal((await request("reviews", review)).status, 200);
  assert.equal((await request("reviews", review)).status, 200);
  assert.equal((await request("manual", capture())).status, 200);
  s = (await request("state")).body;
  assert.equal(s.cards[0].lookups, 2);
  assert.equal(s.queue[0].step, 1);
  assert.equal(s.dueCount, 1);
  assert.equal(sqlite.prepare("select count(*) as n from reviews").get()?.n, 1);
  assert.equal(
    (
      await request("cards", {
        eventId: crypto.randomUUID(),
        cardId: card.id,
        status: "suspended",
      })
    ).status,
    200,
  );
  await request("manual", capture());
  s = (await request("state")).body;
  assert.equal(s.cards[0].status, "suspended");
  assert.equal(s.queue.length, 0);
  assert.equal(
    (await request("manual", { ...input, translatedText: "different" })).status,
    409,
  );
});
test("new-card cap blocks only introductions; repeat reviews remain available; stale grades fail", async () => {
  const { request, capture } = fixture();
  await request("settings", { eventId: crypto.randomUUID(), dailyLimit: 1 });
  await request("manual", capture("one"));
  await request("manual", capture("two"));
  let s = (await request("state")).body;
  assert.equal(s.queue.length, 1);
  const c = s.queue[0];
  const review = {
    eventId: crypto.randomUUID(),
    cardId: c.id,
    version: c.version,
    grade: "forgot",
  };
  assert.equal((await request("reviews", review)).status, 200);
  s = (await request("state")).body;
  assert.equal(s.queue.length, 0);
  assert.equal(s.introduced, 1);
  const blocked = s.cards.find((c: any) => c.introduced === null);
  assert.equal(
    (
      await request("reviews", {
        eventId: crypto.randomUUID(),
        cardId: blocked.id,
        version: blocked.version,
        grade: "remembered",
      })
    ).status,
    409,
  );
  await request("manual", capture("one"));
  s = (await request("state")).body;
  assert.equal(s.queue.length, 1);
  assert.equal(s.dueCount, 1);
  assert.equal(
    (await request("reviews", { ...review, eventId: crypto.randomUUID() }))
      .status,
    409,
  );
});
test("anonymous production access, same-origin mutations and capture bearer enforcement", async () => {
  const { request, capture } = fixture();
  const token = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url");
  const id = crypto.randomUUID();
  await request("tokens", { eventId: id, token });
  assert.equal(
    (await request("captures", capture(), { Authorization: "Bearer " + token }))
      .status,
    200,
  );
  for (const path of ["state", "backup"])
    assert.equal(
      (await request(path, undefined, { Authorization: "Bearer " + token }))
        .status,
      200,
    );
  assert.equal(
    (
      await request(
        "settings",
        { eventId: crypto.randomUUID(), dailyLimit: 100 },
        { Authorization: "Bearer " + token },
      )
    ).status,
    200,
  );
  assert.equal((await request("state", undefined, {}, false)).status, 200);
  assert.equal((await request("backup", undefined, {}, false)).status, 200);
  assert.equal(
    (
      await request(
        "settings",
        { eventId: crypto.randomUUID(), dailyLimit: 10 },
        {},
        false,
      )
    ).status,
    200,
  );
  assert.equal((await request("captures", capture(), {}, false)).status, 401);
  for (const Origin of ["https://evil.example", "", "null"]) {
    assert.equal(
      (
        await request(
          "settings",
          { eventId: crypto.randomUUID(), dailyLimit: 100 },
          { Origin },
          false,
        )
      ).status,
      403,
    );
  }
  assert.equal(
    (
      await request(
        "settings",
        { eventId: crypto.randomUUID(), dailyLimit: 100 },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  await request("tokens/revoke", { eventId: crypto.randomUUID(), tokenId: id });
  assert.equal(
    (await request("captures", capture(), { Authorization: "Bearer " + token }))
      .status,
    401,
  );
});
test("backup restores history without replaying triggers; invalid identities and duplicate receipts rejected atomically", async () => {
  const { request, capture } = fixture();
  await request("manual", capture());
  let s = (await request("state")).body;
  const c = s.queue[0];
  await request("reviews", {
    eventId: crypto.randomUUID(),
    cardId: c.id,
    version: c.version,
    grade: "remembered",
  });
  const backup = (await request("backup")).body;
  await request("manual", capture("another"));
  const restore = { eventId: crypto.randomUUID(), backup };
  assert.equal((await request("restore", restore)).status, 200);
  assert.equal((await request("restore", restore)).status, 200);
  assert.deepEqual((await request("backup")).body, backup);
  const corrupt = structuredClone(backup);
  corrupt.cards[0].id = "bad";
  assert.equal(
    (
      await request("restore", {
        eventId: crypto.randomUUID(),
        backup: corrupt,
      })
    ).status,
    400,
  );
  const duplicate = structuredClone(backup);
  duplicate.captures.push(duplicate.captures[0]);
  assert.equal(
    (
      await request("restore", {
        eventId: crypto.randomUUID(),
        backup: duplicate,
      })
    ).status,
    400,
  );
  assert.deepEqual((await request("backup")).body, backup);
});
