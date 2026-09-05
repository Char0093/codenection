// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelinePane } from "@/features/timeline/timeline-pane";
import type { ActiveItineraryItem } from "@/lib/itinerary/repository";
import type { PoolCandidate } from "@/lib/poi/choice-pool";

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
const poiId = "aaaaaaaa-1111-4111-8111-111111111111";

function item(overrides: Partial<ActiveItineraryItem> = {}): ActiveItineraryItem {
  return {
    id: "item-1", dayId: "day-1", title: "Museum", category: "culture",
    localDate: "2026-10-01", localStartTime: "09:00:00", localEndTime: "10:00:00", sortOrder: 0,
    fixedCommitment: false, travelMinutes: 0, poiId: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<PoolCandidate> = {}): PoolCandidate {
  return {
    key: poiId, poiId, providerPlaceId: null,
    name: "Stadthuys", latitude: 2.194, longitude: 102.249,
    category: "heritage", trust: "curated",
    shortDescription: "Dutch colonial administrative building.", providerDescription: null, attribution: null,
    officialUrl: null, googleMapsUri: null, sourceUrl: "https://example.invalid/s", sourceNote: "Reviewed", verifiedAt: "2026-09-05",
    costTier: "budget", halalStatus: "unknown", allergenRisk: [], allergenDataUnknown: true, dressCode: "none",
    servesFood: false, defaultDurationMinutes: 90,
    openingStatus: { kind: "open", intervals: [{ startMinute: 540, endMinute: 1020 }] },
    eligibility: { result: "pass", reasons: [] },
    travelMinutesFromPrevious: null,
    ...overrides,
  };
}

/** The pane fetches the pool on mount and on every date change, so every test needs that route. */
function mockFetch(options: { candidates?: PoolCandidate[]; onWrite?: (url: string, body: unknown) => unknown } = {}) {
  const writes: { url: string; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.includes("/poi-choices")) {
      return { ok: true, json: async () => ({ candidates: options.candidates ?? [], region: "Old Town/Melaka" }) };
    }
    const body = init?.body ? JSON.parse(init.body) : {};
    writes.push({ url, body });
    const custom = options.onWrite?.(url, body);
    if (custom) return custom;
    return { ok: true, json: async () => ({ item: item({ ...body, id: "item-new", poiId: body.poiId ?? null }), revision: 3, poiId: body.poiId ?? poiId }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { writes, fetchMock };
}

function block(title: string): HTMLElement {
  return screen.getByText(title).closest(".cal-block") as HTMLElement;
}

beforeEach(() => { mockFetch(); });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  listActiveItineraryItems.mockReset();
  // @ts-expect-error -- jsdom does not define this by default; undo any per-test assignment.
  delete document.elementFromPoint;
});

describe("TimelinePane date selection", () => {
  it("renders only the selected day, not every trip day at once", async () => {
    listActiveItineraryItems.mockResolvedValue([
      item(),
      item({ id: "item-2", title: "Cafe", localDate: "2026-10-02", localStartTime: "12:00:00", localEndTime: "13:00:00" }),
    ]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-02" revision={1} />);
    await screen.findByText("Museum");

    expect(screen.getByLabelText("Day 2026-10-01")).toBeInTheDocument();
    expect(screen.queryByLabelText("Day 2026-10-02")).not.toBeInTheDocument();
    expect(screen.queryByText("Cafe")).not.toBeInTheDocument();
  });

  it("switches days from the date strip and shows that day's blocks", async () => {
    listActiveItineraryItems.mockResolvedValue([
      item(),
      item({ id: "item-2", title: "Cafe", localDate: "2026-10-02", localStartTime: "12:00:00", localEndTime: "13:00:00" }),
    ]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-02" revision={1} />);
    await screen.findByText("Museum");

    fireEvent.click(screen.getByRole("tab", { name: /2026-10-02/ }));
    expect(await screen.findByText("Cafe")).toBeInTheDocument();
    expect(screen.queryByText("Museum")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Day 2026-10-02")).toBeInTheDocument();
  });

  it("moves between dates with the arrow keys and keeps a roving tab index", async () => {
    listActiveItineraryItems.mockResolvedValue([item()]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-03" revision={1} />);
    await screen.findByText("Museum");

    const first = screen.getByRole("tab", { name: /2026-10-01/ });
    expect(first).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("tab", { name: /2026-10-02/ })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: /2026-10-01/ })).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(screen.getByRole("tab", { name: /2026-10-02/ }), { key: "End" });
    await waitFor(() => expect(screen.getByRole("tab", { name: /2026-10-03/ })).toHaveAttribute("aria-selected", "true"));
  });

  it("shows how many blocks each day already has", async () => {
    listActiveItineraryItems.mockResolvedValue([item(), item({ id: "item-2", title: "Cafe", localStartTime: "11:00:00", localEndTime: "12:00:00" })]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-02" revision={1} />);
    await screen.findByText("Museum");
    expect(within(screen.getByRole("tab", { name: /2026-10-01/ })).getByText("2 planned")).toBeInTheDocument();
    expect(within(screen.getByRole("tab", { name: /2026-10-02/ })).getByText("Nothing planned")).toBeInTheDocument();
  });
});

describe("POI choice pool", () => {
  it("lists candidates with an owned description and category, filtered by tab and search", async () => {
    mockFetch({ candidates: [
      candidate(),
      candidate({ key: "food-1", poiId: "bbbbbbbb-1111-4111-8111-111111111111", name: "Nancy's Kitchen", category: "food", servesFood: true, shortDescription: "Peranakan restaurant." }),
    ] });
    listActiveItineraryItems.mockResolvedValue([]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);

    expect(await screen.findByText("Stadthuys")).toBeInTheDocument();
    expect(screen.getByText("Dutch colonial administrative building.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Food" }));
    expect(screen.queryByText("Stadthuys")).not.toBeInTheDocument();
    expect(screen.getByText("Nancy's Kitchen")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    fireEvent.change(screen.getByLabelText("Search places"), { target: { value: "colonial" } });
    expect(screen.getByText("Stadthuys")).toBeInTheDocument();
    expect(screen.queryByText("Nancy's Kitchen")).not.toBeInTheDocument();
  });

  it("hides gate-failed candidates behind an Unavailable disclosure and never makes them draggable", async () => {
    mockFetch({ candidates: [candidate({
      name: "Unknown Halal Diner", category: "food", servesFood: true,
      eligibility: { result: "fail", reasons: [{ dimension: "halal", message: "Halal is a confirmed constraint but the item's halal_status is 'unknown'." }] },
    })] });
    listActiveItineraryItems.mockResolvedValue([]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);

    const toggle = await screen.findByRole("button", { name: /1 unavailable place/ });
    expect(screen.queryByText("Unknown Halal Diner")).not.toBeInTheDocument();
    fireEvent.click(toggle);

    const card = screen.getByText("Unknown Halal Diner").closest(".poi-card") as HTMLElement;
    expect(card).toHaveAttribute("draggable", "false");
    expect(within(card).getByText(/Unavailable for this trip/)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Add to day" })).not.toBeInTheDocument();
  });

  it("labels provider content as the provider's rather than as WanderSync's own", async () => {
    mockFetch({ candidates: [candidate({
      poiId: null, key: "provider:places/x", trust: "provider",
      shortDescription: null, providerDescription: "Provider blurb.", attribution: "Data © Google",
    })] });
    listActiveItineraryItems.mockResolvedValue([]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);

    expect(await screen.findByText(/Provider blurb\. \(Data © Google\)/)).toBeInTheDocument();
    expect(screen.getByText("From Google Places")).toBeInTheDocument();
  });

  it("opens a detail sheet with hours, sources and verification date", async () => {
    mockFetch({ candidates: [candidate()] });
    listActiveItineraryItems.mockResolvedValue([]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);

    fireEvent.click(await screen.findByRole("button", { name: /View details/ }));
    const sheet = screen.getByRole("dialog", { name: /Stadthuys details/ });
    expect(within(sheet).getByText("09:00–17:00")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Safety-data source" })).toBeInTheDocument();
    expect(within(sheet).getByText(/Verified 2026-09-05/)).toBeInTheDocument();
  });

  it("warns rather than claiming open when the provider has no hours", async () => {
    mockFetch({ candidates: [candidate({ openingStatus: { kind: "unknown" } })] });
    listActiveItineraryItems.mockResolvedValue([]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    expect(await screen.findByText("Hours unverified")).toBeInTheDocument();
  });
});

describe("scheduling from the pool", () => {
  it("schedules a candidate at the first open time from the keyboard-accessible Add action", async () => {
    const { writes } = mockFetch({ candidates: [candidate()] });
    listActiveItineraryItems.mockResolvedValue([]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add to day" }));
    await waitFor(() => expect(writes.some((write) => write.url.includes("/itinerary/schedule"))).toBe(true));
    expect(writes.at(-1)!.body).toMatchObject({
      poiId, localDate: "2026-10-01", startTime: "09:00", durationMinutes: 90,
    });
  });

  it("schedules at the dropped time when a card is dragged onto the timeline", async () => {
    const { writes } = mockFetch({ candidates: [candidate()] });
    listActiveItineraryItems.mockResolvedValue([]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    await screen.findByText("Stadthuys");

    const day = screen.getByLabelText("Day 2026-10-01");
    day.getBoundingClientRect = () => ({ top: 0, left: 0, right: 200, bottom: 1728, width: 200, height: 1728, x: 0, y: 0, toJSON: () => ({}) });
    const data = new Map<string, string>([["application/x-wandersync-poi", poiId]]);
    const dataTransfer = { getData: (format: string) => data.get(format) ?? "", setData: (f: string, v: string) => data.set(f, v), effectAllowed: "", dropEffect: "" };

    // 654 px at 1.2 px/min = minute 545, which snaps to the 30-minute grid at 09:00. jsdom does not
    // implement DragEvent, so fireEvent's init drops clientY -- it has to be defined on the event.
    const dropEvent = createEvent.drop(day, { dataTransfer });
    Object.defineProperty(dropEvent, "clientY", { value: 654 });
    fireEvent(day, dropEvent);

    await waitFor(() => expect(writes.some((write) => write.url.includes("/itinerary/schedule"))).toBe(true));
    expect(writes.at(-1)!.body).toMatchObject({ poiId, startTime: "09:00" });
  });

  it("refuses a drop outside opening hours and explains why, without calling the server", async () => {
    const { writes } = mockFetch({ candidates: [candidate({ openingStatus: { kind: "closed_that_day" } })] });
    listActiveItineraryItems.mockResolvedValue([]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add to day" }));
    expect(await screen.findByText(/closed on the selected day/i)).toBeInTheDocument();
    expect(writes.some((write) => write.url.includes("/itinerary/schedule"))).toBe(false);
  });

  it("requires explicit confirmation before scheduling the same place twice", async () => {
    const { writes } = mockFetch({ candidates: [candidate()] });
    listActiveItineraryItems.mockResolvedValue([item({ id: "item-1", poiId, title: "Stadthuys" })]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add to day" }));
    expect(await screen.findByText(/already on this trip/i)).toBeInTheDocument();
    expect(writes.some((write) => write.url.includes("/itinerary/schedule"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Add anyway" }));
    await waitFor(() => expect(writes.some((write) => write.url.includes("/itinerary/schedule"))).toBe(true));
  });
});

describe("returning a block to the pool", () => {
  it("unschedules a pool-scheduled block without deleting the place", async () => {
    const { writes } = mockFetch({ candidates: [candidate()] });
    listActiveItineraryItems.mockResolvedValue([item({ poiId, title: "Scheduled Stadthuys" })]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    await screen.findByText("Scheduled Stadthuys");

    fireEvent.click(screen.getByRole("button", { name: "Return to pool" }));
    await waitFor(() => expect(writes.some((write) => write.url.includes("/itinerary/unschedule"))).toBe(true));
    expect(writes.at(-1)!.body).toMatchObject({ itemId: "item-1" });
  });

  it("offers no pool return for a Gemini block, which has no catalog row to return to", async () => {
    listActiveItineraryItems.mockResolvedValue([item({ poiId: null })]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    await screen.findByText("Museum");
    expect(screen.queryByRole("button", { name: "Return to pool" })).not.toBeInTheDocument();
    expect(block("Museum")).toHaveAttribute("draggable", "false");
  });

  it("keeps a persistent unverified-hours warning on a block whose place has no hours", async () => {
    mockFetch({ candidates: [candidate({ openingStatus: { kind: "unknown" } })] });
    listActiveItineraryItems.mockResolvedValue([item({ poiId, title: "Scheduled Stadthuys" })]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    await screen.findByText("Scheduled Stadthuys");
    expect(within(block("Scheduled Stadthuys")).getByText(/Hours unverified/)).toBeInTheDocument();
  });
});

describe("timeline block editing", () => {
  it("positions a block by start time and sizes its height proportional to duration", async () => {
    listActiveItineraryItems.mockResolvedValue([item({ localStartTime: "09:00:00", localEndTime: "10:30:00" })]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    await screen.findByText("Museum");
    const card = block("Museum");
    expect(card.style.top).toBe((540 * 1.2) + "px");
    expect(card.style.height).toBe((90 * 1.2) + "px");
  });

  it("commits one move request on release, not one per pointermove", async () => {
    const { writes } = mockFetch();
    listActiveItineraryItems.mockResolvedValue([item()]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    await screen.findByText("Museum");
    const handle = block("Museum").querySelector(".cal-block-handle") as HTMLElement;

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 });
    for (let step = 1; step <= 10; step += 1) fireEvent.pointerMove(handle, { pointerId: 1, clientY: 100 + step * 6 });
    expect(writes.filter((write) => write.url.includes("/reorder"))).toHaveLength(0);

    fireEvent.pointerUp(handle, { pointerId: 1 });
    await waitFor(() => expect(writes.filter((write) => write.url.includes("/reorder"))).toHaveLength(1));
  });

  it("nudges time by 30 minutes and resizes by 15 with the keyboard", async () => {
    const { writes } = mockFetch();
    listActiveItineraryItems.mockResolvedValue([item()]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    await screen.findByText("Museum");
    const card = block("Museum");
    card.focus();

    fireEvent.keyDown(card, { key: "ArrowDown" });
    await waitFor(() => expect(writes.at(-1)?.body).toMatchObject({ newStartTime: "09:30" }));
    // An in-flight edit marks the block pending, which correctly ignores further input, so the
    // resize can only be sent once the move has settled.
    await waitFor(() => expect(block("Museum")).not.toHaveAttribute("data-pending"));

    fireEvent.keyDown(block("Museum"), { key: "ArrowDown", shiftKey: true });
    await waitFor(() => expect(writes.at(-1)?.body).toMatchObject({ durationMinutes: 75 }));
  });

  it("rolls back and shows the reason when the server refuses an edit", async () => {
    mockFetch({ onWrite: () => ({ ok: false, json: async () => ({ error: "Overlaps another activity that day", code: "VALIDATION_FAILED" }) }) });
    listActiveItineraryItems.mockResolvedValue([item()]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    await screen.findByText("Museum");
    const card = block("Museum");
    card.focus();
    fireEvent.keyDown(card, { key: "ArrowDown" });
    expect(await screen.findByText("Overlaps another activity that day")).toBeInTheDocument();
  });

  it("refetches instead of guessing when the server reports a stale revision", async () => {
    mockFetch({ onWrite: () => ({ ok: false, json: async () => ({ error: "Trip revision changed", code: "CONFLICT" }) }) });
    listActiveItineraryItems.mockResolvedValueOnce([item()]).mockResolvedValueOnce([item({ localStartTime: "10:00:00", localEndTime: "11:00:00" })]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    await screen.findByText("Museum");
    const card = block("Museum");
    card.focus();
    fireEvent.keyDown(card, { key: "ArrowDown" });
    await waitFor(() => expect(listActiveItineraryItems).toHaveBeenCalledTimes(2));
  });

  it("locks a fixed-commitment block until it is explicitly unlocked", async () => {
    const { writes } = mockFetch();
    listActiveItineraryItems.mockResolvedValue([item({ fixedCommitment: true })]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    await screen.findByText("Museum");
    const card = block("Museum");
    expect(card).toHaveAttribute("data-locked", "true");
    expect(card.querySelector(".cal-resize-bottom")).not.toBeInTheDocument();

    card.focus();
    fireEvent.keyDown(card, { key: "ArrowDown" });
    expect(writes.filter((write) => write.url.includes("/reorder"))).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    await waitFor(() => expect(writes.some((write) => write.url.includes("/itinerary/unlock"))).toBe(true));
  });

  it("renders a travel block only when travel time is known", async () => {
    listActiveItineraryItems.mockResolvedValue([
      item({ id: "with-travel", title: "Cafe", travelMinutes: 20 }),
      item({ id: "without-travel", title: "Museum", localStartTime: "11:00:00", localEndTime: "12:00:00", travelMinutes: 0 }),
    ]);
    render(<TimelinePane tripId={tripId} startDate="2026-10-01" endDate="2026-10-01" revision={1} />);
    await screen.findByText("Cafe");
    expect(screen.getByLabelText(/Travel to Cafe/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Travel to Museum/)).not.toBeInTheDocument();
  });
});
