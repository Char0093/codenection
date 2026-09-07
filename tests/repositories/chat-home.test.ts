import { describe, expect, it, vi } from "vitest";
import { getChatHome } from "@/lib/repositories/chat-home";

const client = (rows: unknown[]) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
  rpc: vi.fn(async () => ({ data: rows, error: null })),
});

const row = (over: Record<string, unknown> = {}) => ({
  id: "12345678-1234-4123-8123-123456789012",
  name: "Melaka crew",
  status: "ready",
  destination_name: "Melaka",
  start_date: "2026-12-12",
  end_date: "2026-12-14",
  trip_mode: "balanced",
  planned_duration_days: null,
  proposed_budget_tier: "standard",
  member_count: 2,
  member_avatars: [{ id: "12345678-1234-4123-8123-1234567890ab", displayName: "A" }],
  latest_message_body: "  see   you  at  9  ",
  latest_message_at: "2026-12-01T08:00:00Z",
  activity_at: "2026-12-01T08:00:00Z",
  ...over,
});

describe("getChatHome", () => {
  it("maps rows to the chat-home contract with a collapsed bounded preview and assigned avatar colors", async () => {
    const home = await getChatHome(client([row()]) as never);
    expect(home.trips).toHaveLength(1);
    expect(home.trips[0]).toMatchObject({
      name: "Melaka crew",
      status: "ready",
      tripMode: "balanced",
      proposedBudgetTier: "standard",
      memberCount: 2,
      latestMessage: { preview: "see you at 9" },
    });
    expect(home.trips[0].latestMessage?.at).toBe("2026-12-01T08:00:00.000Z");
    expect(home.trips[0].memberAvatars[0]).toMatchObject({ displayName: "A" });
    expect(typeof home.trips[0].memberAvatars[0].color).toBe("string");
    expect(home.trips[0].unread).toBeNull();
  });

  it("keeps latestMessage null when there is no message and passes a draft/duration frame", async () => {
    const home = await getChatHome(client([row({
      status: "draft", start_date: null, end_date: null, planned_duration_days: 5,
      proposed_budget_tier: null, trip_mode: "relaxed",
      latest_message_body: null, latest_message_at: null,
    })]) as never);
    expect(home.trips[0]).toMatchObject({ status: "draft", plannedDurationDays: 5, proposedBudgetTier: null });
    expect(home.trips[0].latestMessage).toBeNull();
  });

  it("caps avatars at CHAT_HOME_MAX_AVATARS", async () => {
    const many = Array.from({ length: 12 }, (_unused, i) => ({
      id: `${String(i).padStart(8, "0")}-1234-4123-8123-1234567890ab`, displayName: `M${i}`,
    }));
    const home = await getChatHome(client([row({ member_avatars: many })]) as never);
    expect(home.trips[0].memberAvatars).toHaveLength(8);
  });
});
