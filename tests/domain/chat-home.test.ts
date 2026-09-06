import { describe, expect, it } from "vitest";
import {
  chatHomeTripSchema,
  chatHomeSchema,
  toLatestMessagePreview,
  LATEST_MESSAGE_PREVIEW_MAX,
  CHAT_HOME_MAX_AVATARS,
} from "@/lib/domain/chat-home";

const uuid = "12345678-1234-4123-8123-123456789012";
const avatar = (n: number) => ({
  id: `1234567${n}-1234-4123-8123-123456789012`,
  displayName: `Member ${n}`,
  color: "#182544",
});

const readyTrip = {
  id: uuid,
  name: "Melaka crew",
  status: "ready" as const,
  destinationName: "Melaka",
  startDate: "2026-12-12",
  endDate: "2026-12-14",
  latestMessage: { preview: "see you at 9", at: "2026-12-01T08:00:00.000Z" },
  memberAvatars: [avatar(0), avatar(1)],
  unread: 3,
};

const draftTrip = {
  id: uuid,
  name: "Someday trip",
  status: "draft" as const,
  destinationName: null,
  startDate: null,
  endDate: null,
  latestMessage: null,
  memberAvatars: [],
  unread: null,
};

describe("chatHomeTripSchema", () => {
  it("accepts a fully populated ready group and a name-only draft", () => {
    expect(chatHomeTripSchema.parse(readyTrip)).toEqual(readyTrip);
    expect(chatHomeTripSchema.parse(draftTrip)).toEqual(draftTrip);
  });

  it.each([
    { status: "archived" },
    { id: "not-a-uuid" },
    { startDate: "2026-13-01" },
    { endDate: "not-a-date" },
    { memberAvatars: Array.from({ length: CHAT_HOME_MAX_AVATARS + 1 }, (_unused, i) => avatar(i)) },
    { latestMessage: { preview: "x".repeat(LATEST_MESSAGE_PREVIEW_MAX + 1), at: "2026-12-01T08:00:00.000Z" } },
    { latestMessage: { preview: "hi", at: "not-a-timestamp" } },
    { unread: -1 },
    { unread: 1.5 },
    { extra: true },
  ])("rejects invalid or extra fields %j", (patch) => {
    expect(chatHomeTripSchema.safeParse({ ...readyTrip, ...patch }).success).toBe(false);
  });

  it("wraps a bounded list in chatHomeSchema and rejects extras", () => {
    expect(chatHomeSchema.parse({ trips: [readyTrip, draftTrip] }).trips).toHaveLength(2);
    expect(chatHomeSchema.safeParse({ trips: [readyTrip], extra: 1 }).success).toBe(false);
  });
});

describe("toLatestMessagePreview", () => {
  it("returns null for an empty or whitespace-only body", () => {
    expect(toLatestMessagePreview("")).toBeNull();
    expect(toLatestMessagePreview("   \n\t ")).toBeNull();
  });

  it("collapses whitespace and keeps a short message intact", () => {
    expect(toLatestMessagePreview("  meet   at\nthe   gate ")).toBe("meet at the gate");
  });

  it("hard-caps a long message at the limit with an ellipsis", () => {
    const out = toLatestMessagePreview("a".repeat(400));
    expect(out).not.toBeNull();
    expect(out!.length).toBe(LATEST_MESSAGE_PREVIEW_MAX);
    expect(out!.endsWith("…")).toBe(true);
  });

  it("produces a preview the schema will accept", () => {
    const preview = toLatestMessagePreview("word ".repeat(200))!;
    expect(
      chatHomeTripSchema.safeParse({
        ...readyTrip,
        latestMessage: { preview, at: "2026-12-01T08:00:00.000Z" },
      }).success,
    ).toBe(true);
  });
});
