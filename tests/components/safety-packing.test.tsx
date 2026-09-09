// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SafetyView } from "@/features/prototype/safety-view";
import { PackingView } from "@/features/prototype/packing-view";
import { DEMO_PACKING, DEMO_VQA } from "@/lib/prototype/demo-features";

afterEach(cleanup);

describe("SafetyView", () => {
  it("refuses the dish and names the member whose constraint it breaks", async () => {
    const user = userEvent.setup();
    render(<SafetyView />);
    await user.click(screen.getByRole("button", { name: /check this dish/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByRole("alert")).toHaveTextContent(DEMO_VQA.headline);
    expect(screen.getByText(DEMO_VQA.constraint)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(DEMO_VQA.alternative.slice(0, 24)))).toBeInTheDocument();
  });

  it("marks exactly the risky ingredients, not every detection", async () => {
    const user = userEvent.setup();
    render(<SafetyView />);
    await user.click(screen.getByRole("button", { name: /check this dish/i }));
    await waitFor(() => expect(document.querySelectorAll(".vqa-detected li").length)
      .toBe(DEMO_VQA.detected.length), { timeout: 3000 });
    const risky = document.querySelectorAll('.vqa-detected li[data-risk="true"]');
    expect(risky).toHaveLength(DEMO_VQA.detected.filter((d) => d.risk).length);
  });
});

describe("PackingView", () => {
  it("groups items with the reason each one is on the list", () => {
    render(<PackingView />);
    for (const group of DEMO_PACKING) {
      expect(screen.getByText(group.title)).toBeInTheDocument();
      expect(screen.getByText(group.source)).toBeInTheDocument();
      for (const item of group.items) expect(screen.getByText(item.reason)).toBeInTheDocument();
    }
  });

  it("counts ticked items", async () => {
    const user = userEvent.setup();
    render(<PackingView />);
    const total = DEMO_PACKING.flatMap((g) => g.items).length;
    expect(screen.getByText(`0/${total}`)).toBeInTheDocument();
    await user.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText(`1/${total}`)).toBeInTheDocument();
  });
});
