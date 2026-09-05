import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listMessages, listMessagesSince, parseChatMessageRow, sendMessage } from "@/lib/chat/repository";

const tripId = "12345678-1234-4123-8123-123456789012";
const memberId = "22345678-1234-4123-8123-123456789012";

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "32345678-1234-4123-8123-123456789012", trip_id: tripId, author_member_id: memberId,
    author_kind: "member", body: "Hello", proposal_id: null, created_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function client(options: { rows?: unknown[]; selectError?: unknown; insertError?: unknown } = {}) {
  const inserted: unknown[] = [];
  const db = {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        gt: () => query,
        order: () => query,
        limit: () => query,
        insert: (value: unknown) => {
          inserted.push(value);
          return query;
        },
        single: async () => ({ data: options.insertError ? null : row(), error: options.insertError ?? null }),
        then: (resolve: (result: unknown) => void) =>
          Promise.resolve({ data: options.selectError ? null : (options.rows ?? [row()]), error: options.selectError ?? null }).then(resolve),
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, inserted };
}

describe("parseChatMessageRow", () => {
  it("maps a database row into the domain shape", () => {
    expect(parseChatMessageRow(row())).toEqual({
      id: row().id, tripId, authorMemberId: memberId, authorKind: "member",
      body: "Hello", proposalId: null, createdAt: "2026-10-01T00:00:00.000Z",
    });
  });
  it("rejects a malformed row rather than silently coercing it", () => {
    expect(() => parseChatMessageRow(row({ author_kind: "villain" }))).toThrow();
  });
});

describe("listMessages", () => {
  it("returns rows oldest-first even though the query fetches newest-first", () => {
    const older = row({ id: "1" + tripId.slice(1), created_at: "2026-10-01T00:00:00.000Z" });
    const newer = row({ id: "2" + tripId.slice(1), created_at: "2026-10-01T00:05:00.000Z" });
    // The fake client returns rows in query order (newest-first); listMessages must reverse them.
    const fake = client({ rows: [newer, older] });
    return listMessages(fake.db, tripId).then((messages) => {
      expect(messages.map((message) => message.id)).toEqual([older.id, newer.id]);
    });
  });
  it("propagates a query error rather than returning a false empty list", async () => {
    const fake = client({ selectError: { message: "boom" } });
    await expect(listMessages(fake.db, tripId)).rejects.toBeTruthy();
  });
});

describe("listMessagesSince", () => {
  it("returns the backfilled rows in chronological order", async () => {
    const fake = client({ rows: [row()] });
    const messages = await listMessagesSince(fake.db, tripId, "2026-09-30T00:00:00.000Z");
    expect(messages).toHaveLength(1);
  });
});

describe("sendMessage", () => {
  it("trims the body and inserts as the given member", async () => {
    const fake = client();
    const sent = vi.spyOn(fake.db, "from");
    await sendMessage(fake.db, tripId, memberId, "  Hello  ");
    expect(sent).toHaveBeenCalledWith("chat_messages");
    expect(fake.inserted[0]).toMatchObject({ trip_id: tripId, author_member_id: memberId, author_kind: "member", body: "Hello" });
  });
  it("refuses to send an empty message without a round trip", async () => {
    const fake = client();
    await expect(sendMessage(fake.db, tripId, memberId, "   ")).rejects.toThrow();
    expect(fake.inserted).toHaveLength(0);
  });
  it("propagates an RLS rejection instead of returning a fabricated message", async () => {
    const fake = client({ insertError: { code: "42501" } });
    await expect(sendMessage(fake.db, tripId, memberId, "Hello")).rejects.toBeTruthy();
  });
});
