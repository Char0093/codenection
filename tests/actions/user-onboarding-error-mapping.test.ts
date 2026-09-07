import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http/errors";

// Reach the non-exported `mapUserRpcError` SQLSTATE -> AppError table through the *real*
// `submitUserOnboarding`. Only Supabase is stubbed.
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

import { submitUserOnboarding } from "@/app/actions/user-onboarding";

const validBody = {
  expectedRevision: 0,
  answers: { dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, surpriseDial: null },
};
const reject = (promise: Promise<unknown>) =>
  promise.then((value) => { throw new Error(`expected rejection, resolved ${JSON.stringify(value)}`); }, (reason) => reason);

beforeEach(() => vi.resetAllMocks());

describe("submitUserOnboarding SQLSTATE mapping", () => {
  it.each([
    ["42501", 401, "UNAUTHENTICATED"],
    ["40001", 409, "STALE_PROFILE"],
    ["22023", 422, "INVALID_ONBOARDING"],
  ])("maps %s -> %d/%s", async (code, status, appCode) => {
    rpcMock.mockResolvedValue({ data: null, error: { code } });
    expect(await reject(submitUserOnboarding(validBody))).toMatchObject({ status, code: appCode });
  });

  it("falls through an unmapped SQLSTATE to databaseError", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "23505" } });
    expect(await reject(submitUserOnboarding(validBody))).toBeInstanceOf(AppError);
  });

  it("returns the new revision on success", async () => {
    rpcMock.mockResolvedValue({ data: 4, error: null });
    expect(await submitUserOnboarding(validBody)).toEqual({ profileRevision: 4, needsOnboarding: false });
  });

  it("rejects a malformed body before touching Supabase", async () => {
    await reject(submitUserOnboarding({ expectedRevision: -1, answers: {} }));
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
