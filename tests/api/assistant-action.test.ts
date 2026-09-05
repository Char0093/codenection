import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  askAssistant: vi.fn(),
  listMessages: vi.fn(),
  verifiedUser: vi.fn(),
  getTrip: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/chat/assistant", () => ({ askAssistant: mocks.askAssistant }));
vi.mock("@/lib/chat/repository", () => ({ listMessages: mocks.listMessages }));
vi.mock("@/lib/supabase/auth", () => ({ verifiedUser: mocks.verifiedUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/repositories/server", () => ({ tripRepository: async () => ({ getTrip: mocks.getTrip }) }));

import { askTripAssistant } from "@/app/actions/assistant";

const tripId = "12345678-1234-4123-8123-123456789012";
const memberId = "22345678-1234-4123-8123-123456789012";
const trip = { id: tripId, destinationName: "Melaka", startDate: "2026-12-12", endDate: "2026-12-12", budgetTier: "standard", pace: "balanced", revision: 1, activeProposalId: null, role: "member", ownerUserId: "owner" };

function queryFor(table: string) {
  return {
    select: () => queryFor(table),
    eq: () => queryFor(table),
    maybeSingle: async () => ({ data: { id: memberId }, error: null }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verifiedUser.mockResolvedValue({ id: "user-1" });
  mocks.from.mockImplementation((table: string) => queryFor(table));
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.getTrip.mockResolvedValue(trip);
  mocks.listMessages.mockResolvedValue([]);
});

describe("askTripAssistant", () => {
  it("rejects a caller who is not a member of the trip", async () => {
    mocks.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    }));
    await expect(askTripAssistant(tripId, "How's the weather?")).rejects.toMatchObject({ status: 403 });
    expect(mocks.askAssistant).not.toHaveBeenCalled();
  });

  it("creates a pending chat proposal (never activates it) when the assistant proposes a change", async () => {
    mocks.askAssistant.mockResolvedValue({ message: "Here's a revised plan.", proposal: { summary: "x", activities: [], assumptions: [] } });
    const result = await askTripAssistant(tripId, "Replan the day");
    expect(mocks.rpc).toHaveBeenCalledWith("save_chat_proposal", expect.objectContaining({
      target_trip_id: tripId, author_member_id: memberId, announcement: "Here's a revised plan.",
    }));
    expect(mocks.rpc).not.toHaveBeenCalledWith("post_assistant_message", expect.anything());
    expect(result).toEqual({ message: "Here's a revised plan.", proposed: true });
  });

  it("posts a plain assistant message when there is no proposal", async () => {
    mocks.askAssistant.mockResolvedValue({ message: "Jonker Street opens at 6pm.", proposal: null });
    const result = await askTripAssistant(tripId, "When does the market open?");
    expect(mocks.rpc).toHaveBeenCalledWith("post_assistant_message", { target_trip_id: tripId, body: "Jonker Street opens at 6pm." });
    expect(result).toEqual({ message: "Jonker Street opens at 6pm.", proposed: false });
  });

  it("leaves everything unchanged when the provider call fails", async () => {
    mocks.askAssistant.mockRejectedValue(new Error("provider down"));
    await expect(askTripAssistant(tripId, "hi")).rejects.toThrow("provider down");
    expect(mocks.rpc).toHaveBeenCalledTimes(1); // only the rate-limit reservation, never a proposal or message write
    expect(mocks.rpc).toHaveBeenCalledWith("reserve_generation", { target_trip_id: tripId });
  });

  it("enforces the shared rate limit before ever calling the model", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0003", message: "rate_limit" } });
    await expect(askTripAssistant(tripId, "hi")).rejects.toMatchObject({ status: 429 });
    expect(mocks.askAssistant).not.toHaveBeenCalled();
  });

  it("rejects an empty question before any network or database work", async () => {
    await expect(askTripAssistant(tripId, "   ")).rejects.toMatchObject({ status: 422 });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.askAssistant).not.toHaveBeenCalled();
  });
});
