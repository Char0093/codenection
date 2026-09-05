// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelinePane } from "@/features/timeline/timeline-pane";
import type { ActiveItineraryItem } from "@/lib/itinerary/repository";

const { listActiveItineraryItems } = vi.hoisted(() => ({ listActiveItineraryItems: vi.fn() }));
vi.mock("@/lib/itinerary/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/itinerary/repository")>();
  return { ...actual, listActiveItineraryItems };
});

const fakeChannel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), unsubscribe: vi.fn() };
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ channel: () => fakeChannel, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { revision: 2 }, error: null }) }) }) }) }),
}));

const tripId = "12345678-1234-4123-8123-123456789012";

function item(overrides: Partial<ActiveItineraryItem> = {}): ActiveItineraryItem {
  return {
    id: "item-1", dayId: "day-1", title: "Museum", category: "culture",
    localDate: "2026-10-01", localStartTime: "09:00:00", localEndTime: "10:00:00", sortOrder: 0,
    ...overrides,
  };
}

class FakeDataTransfer {
  private store = new Map<string, string>();
  setData(format: string, value: string) {
    this.store.set(format, value);
  }
  getData(format: string) {
    return this.store.get(format) ?? "";
  }
}

function dragAndDrop(source: HTMLElement, target: HTMLElement) {
  const dataTransfer = new FakeDataTransfer();
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  listActiveItineraryItems.mockReset();
});

describe("TimelinePane", () => {
  it("groups items into day columns across the trip's date range, including empty days", async () => {
    listActiveItineraryItems.mockResolvedValue([item()]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-02" revision={1} />);
    expect(await screen.findByText("Museum")).toBeInTheDocument();
    expect(screen.getByLabelText("Day 2026-10-01")).toBeInTheDocument();
    expect(screen.getByLabelText("Day 2026-10-02")).toBeInTheDocument();
    expect(screen.getByText("Drop an activity here")).toBeInTheDocument();
  });

  it("moves an activity to a later day by dragging it into that day's column", async () => {
    listActiveItineraryItems.mockResolvedValue([item()]);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ item: item({ localDate: "2026-10-02", localStartTime: "09:00:00" }), revision: 2 }),
    });
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-02" revision={1} />);
    const card = await screen.findByText("Museum");
    const targetColumn = screen.getByLabelText("Day 2026-10-02").querySelector(".day-column-list") as HTMLElement;

    dragAndDrop(card.closest("li")!, targetColumn);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/itinerary/reorder"),
      expect.objectContaining({ method: "POST" }),
    ));
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toMatchObject({ itemId: "item-1", newDate: "2026-10-02" });
  });

  it("rolls back and shows the reason when the server refuses a drop", async () => {
    listActiveItineraryItems.mockResolvedValue([item(), item({ id: "item-2", title: "Cafe", localStartTime: "11:00:00", localEndTime: "12:00:00" })]);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({ error: "Overlaps another activity that day", code: "VALIDATION_FAILED" }) });
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    const card = await screen.findByText("Museum");
    const column = screen.getByLabelText("Day 2026-10-01").querySelector(".day-column-list") as HTMLElement;
    dragAndDrop(card.closest("li")!, column);
    expect(await screen.findByText("Overlaps another activity that day")).toBeInTheDocument();
  });

  it("refetches instead of guessing when the server reports a stale revision", async () => {
    listActiveItineraryItems.mockResolvedValueOnce([item()]).mockResolvedValueOnce([item({ localStartTime: "10:00:00", localEndTime: "11:00:00" })]);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({ error: "Trip revision changed", code: "CONFLICT" }) });
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    const card = await screen.findByText("Museum");
    const column = screen.getByLabelText("Day 2026-10-01").querySelector(".day-column-list") as HTMLElement;
    dragAndDrop(card.closest("li")!, column);
    await waitFor(() => expect(listActiveItineraryItems).toHaveBeenCalledTimes(2));
  });

  it("nudges an activity's time with the keyboard", async () => {
    listActiveItineraryItems.mockResolvedValue([item()]);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ item: item({ localStartTime: "09:30:00" }), revision: 2 }) });
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    const card = (await screen.findByText("Museum")).closest("li") as HTMLElement;
    card.focus();
    fireEvent.keyDown(card, { key: "ArrowDown" });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.newStartTime).toBe("09:30");
  });
});
