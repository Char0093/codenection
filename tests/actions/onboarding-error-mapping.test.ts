import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http/errors";

// Ruling T4-a: reach the non-exported `mapRpcError` SQLSTATE -> AppError table
// through the *real* `submitOnboarding`. This file deliberately does NOT mock
// `@/app/actions/onboarding`; only Supabase is stubbed.
const { rpcMock, stubClient } = vi.hoisted(() => {
  const rpcMock = vi.fn();
  return {
    rpcMock,
    stubClient: {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
      rpc: rpcMock,
    },
  };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => stubClient }));

import { submitOnboarding } from "@/app/actions/onboarding";

const tripId = "12345678-1234-4123-8123-123456789012";
const validBody = {
  expectedRevision: 0,
  answers: {
    mode: "quick",
    dealbreakers: { dietary: [], religiousAccess: [], mobility: [] },
    walkingCapM: null,
    budgetLean: "standard",
  },
};

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (value) => {
      throw new Error(`expected submitOnboarding to reject, but it resolved with ${JSON.stringify(value)}`);
    },
    (reason: unknown) => reason,
  );
}

type Case = { name: string; error: { code: string; message?: string }; status: number; code: string };

const cases: readonly Case[] = [
  { name: "42501 -> 403 FORBIDDEN", error: { code: "42501" }, status: 403, code: "FORBIDDEN" },
  { name: "40001 -> 409 STALE_PROFILE", error: { code: "40001" }, status: 409, code: "STALE_PROFILE" },
  {
    name: "P0001 + PENDING_CONSTRAINT_CONFLICT -> 409 PENDING_CONSTRAINT",
    error: { code: "P0001", message: "PENDING_CONSTRAINT_CONFLICT" },
    status: 409,
    code: "PENDING_CONSTRAINT",
  },
  {
    name: "P0001 + other message -> falls through to databaseError (409 CONFLICT)",
    error: { code: "P0001", message: "something else" },
    status: 409,
    code: "CONFLICT",
  },
  { name: "22023 -> 422 INVALID_ONBOARDING", error: { code: "22023" }, status: 422, code: "INVALID_ONBOARDING" },
  {
    name: "23505 (unmapped) -> falls through to databaseError (503 STORAGE_UNAVAILABLE)",
    error: { code: "23505" },
    status: 503,
    code: "STORAGE_UNAVAILABLE",
  },
];

describe("submitOnboarding surfaces mapRpcError's SQLSTATE table", () => {
  beforeEach(() => rpcMock.mockReset());

  it.each(cases)("maps $name", async ({ error, status, code }) => {
    rpcMock.mockResolvedValue({ data: null, error });
    const thrown = await rejectionOf(submitOnboarding(tripId, validBody));
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(status);
    expect((thrown as AppError).code).toBe(code);
  });

  it("returns the new profile revision on a successful RPC", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    await expect(submitOnboarding(tripId, validBody)).resolves.toEqual({ profileRevision: 3, needsOnboarding: false });
  });
});
