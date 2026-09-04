import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthInvalidJwtError, AuthInvalidTokenResponseError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { anonKey, cookieName, encodedCookie, session, supabaseUrl, user } from "./auth-fixtures";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();
  return {
    ...actual,
    createServerClient: (...args: Parameters<typeof actual.createServerClient>) => actual.createServerClient(
      args[0], args[1], { ...args[2], global: { fetch: mocks.fetch } },
    ),
  };
});

import { middleware } from "@/middleware";
import { createClient } from "@/lib/supabase/server";
import { authenticationError } from "@/lib/supabase/auth";
import { SupabaseTripRepository } from "@/lib/repositories/supabase-trip-repository";
import { GET as callback } from "@/app/auth/callback/route";
import { POST as signout } from "@/app/auth/signout/route";
import { POST as mockSignIn } from "@/app/auth/mock/route";

let store: ResponseCookies;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey);
  store = new ResponseCookies(new Headers());
  mocks.cookies.mockResolvedValue(store);
  mocks.fetch.mockImplementation(async (url: RequestInfo | URL) => {
    throw new Error(`Unexpected network request: ${String(url)}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

function request(path = "/api/trips", authSession = session()) {
  return new NextRequest(`https://trip.test${path}`, { headers: { cookie: `${cookieName}=${encodedCookie(authSession)}` } });
}

describe("auth error classification", () => {
  it.each([
    new AuthSessionMissingError(), new AuthInvalidJwtError("invalid signature"),
    new AuthApiError("expired", 401, "bad_jwt"), new AuthApiError("revoked", 400, "refresh_token_not_found"),
    new AuthApiError("reused", 400, "refresh_token_already_used"), new AuthApiError("missing", 403, "session_not_found"),
  ])("classifies missing/invalid sessions as 401: %s", (error) => {
    expect(authenticationError(error)).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });
  it.each([
    new AuthRetryableFetchError("network secret", 0), new AuthApiError("unavailable", 503, "unexpected_failure"),
    new AuthApiError("throttled", 429, "over_request_rate_limit"), new TypeError("fetch failed"),
    new AuthInvalidTokenResponseError(),
  ])("classifies unavailable verification as 503: %s", (error) => {
    expect(authenticationError(error)).toMatchObject({ status: 503, code: "AUTH_UNAVAILABLE" });
    expect(authenticationError(error).message).toBe("Sign-in is temporarily unavailable. Please try again.");
  });
});

describe("middleware with Supabase SSR", () => {
  it("verifies the session with Auth using the user token and anon key", async () => {
    const authSession = session();
    mocks.fetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${supabaseUrl}/auth/v1/user`);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${authSession.access_token}`);
      expect(new Headers(init?.headers).get("apikey")).toBe(anonKey);
      return Response.json(user);
    });
    const response = await middleware(request("/api/trips", authSession));
    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(["/api/trips", "/"])("returns 503 without deleting a valid cookie or redirecting on an outage: %s", async (path) => {
    mocks.fetch.mockResolvedValue(Response.json({ message: "private provider failure" }, { status: 503 }));
    const incoming = request(path);
    const originalCookie = incoming.cookies.get(cookieName)?.value;
    const response = await middleware(incoming);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Sign-in is temporarily unavailable. Please try again.", code: "AUTH_UNAVAILABLE" });
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(incoming.cookies.get(cookieName)?.value).toBe(originalCookie);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns 401 for a server-rejected token even when the cookie claims a user", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ code: "bad_jwt", message: "Invalid token" }, { status: 401 }));
    const response = await middleware(request());
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("UNAUTHENTICATED");
  });

  it("handles a rejected network fetch without discarding the session", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.fetch.mockRejectedValue(new TypeError("private network failure"));
      const response = await middleware(request());
      expect(response.status).toBe(503);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).not.toContain("private network failure");
    } finally { logged.mockRestore(); }
  });

  it.each(["/login", "/auth/callback"])("keeps the public auth route accessible during an outage: %s", async (path) => {
    mocks.fetch.mockResolvedValue(Response.json({ message: "Auth unavailable" }, { status: 503 }));
    const response = await middleware(request(path));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each([["/api/trips", 401], ["/", 200], ["/login", 200], ["/auth/callback", 200]] as const)("handles missing sessions at %s", async (path, status) => {
    const response = await middleware(new NextRequest(`https://trip.test${path}`));
    expect(response.status).toBe(status);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows missing-session pages to render login without changing the browser host", async () => {
    const response = await middleware(new NextRequest("http://localhost:3103/", { headers: { Host: "127.0.0.1:3103" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("propagates rotated cookies to both downstream request headers and the browser", async () => {
    const renewed = session();
    mocks.fetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/token?grant_type=refresh_token")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ refresh_token: "test-refresh-token" });
        return Response.json(renewed);
      }
      expect(String(url)).toBe(`${supabaseUrl}/auth/v1/user`);
      return Response.json(user);
    });
    const incoming = request("/api/trips", session(Math.floor(Date.now() / 1000) - 120));
    const response = await middleware(incoming);
    expect(response.status).toBe(200);
    expect(incoming.cookies.get(cookieName)?.value).toBe(encodedCookie(renewed));
    expect(response.cookies.get(cookieName)?.value).toBe(encodedCookie(renewed));
    expect(response.headers.get("x-middleware-request-cookie")).toContain(encodedCookie(renewed));
    expect(response.cookies.get(cookieName)).toMatchObject({ path: "/", sameSite: "lax" });
  });

  it("retains a successful refresh if the subsequent user verification is unavailable", async () => {
    const renewed = session();
    mocks.fetch.mockImplementation(async (url: RequestInfo | URL) => String(url).includes("/token?")
      ? Response.json(renewed)
      : Response.json({ message: "Auth unavailable" }, { status: 503 }));
    const response = await middleware(request("/api/trips", session(Math.floor(Date.now() / 1000) - 120)));
    expect(response.status).toBe(503);
    expect(response.cookies.get(cookieName)?.value).toBe(encodedCookie(renewed));
    expect(response.cookies.get(cookieName)?.maxAge).toBeGreaterThan(0);
  });

  it("forwards session deletion on a definitive missing-session error", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ code: "session_not_found", message: "Session gone" }, { status: 400, headers: { "x-supabase-api-version": "2024-01-01" } }));
    const response = await middleware(request());
    expect(response.status).toBe(401);
    expect(response.cookies.get(cookieName)).toMatchObject({ value: "", maxAge: 0 });
  });

  it("cleans old cookie chunks when a refresh succeeds before a user lookup outage", async () => {
    const renewed = session();
    mocks.fetch.mockImplementation(async (url: RequestInfo | URL) => String(url).includes("/token?")
      ? Response.json(renewed)
      : Response.json({ message: "Auth unavailable" }, { status: 503 }));
    const encoded = encodedCookie(session(Math.floor(Date.now() / 1000) - 120));
    const incoming = new NextRequest("https://trip.test/api/trips", { headers: {
      cookie: `${cookieName}.0=${encoded.slice(0, 200)}; ${cookieName}.1=${encoded.slice(200)}`,
    } });
    const response = await middleware(incoming);
    expect(response.status).toBe(503);
    expect(response.cookies.get(cookieName)?.value).toBe(encodedCookie(renewed));
    for (const suffix of [".0", ".1"]) {
      expect(response.cookies.get(cookieName + suffix)).toMatchObject({ value: "", maxAge: 0 });
      expect(incoming.cookies.get(cookieName + suffix)).toBeUndefined();
    }
  });
});

describe("server repository authentication", () => {
  it.each([503, 401])("classifies an Auth HTTP %s before any storage request", async (status) => {
    store.set(cookieName, encodedCookie(session()));
    mocks.fetch.mockImplementation(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe(`${supabaseUrl}/auth/v1/user`);
      return Response.json({ code: status === 401 ? "bad_jwt" : "unexpected_failure", message: "private detail" }, { status });
    });
    const repo = new SupabaseTripRepository(await createClient());
    await expect(repo.listTrips()).rejects.toMatchObject({ status, code: status === 401 ? "UNAUTHENTICATED" : "AUTH_UNAVAILABLE" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing session before contacting storage", async () => {
    const repo = new SupabaseTripRepository(await createClient());
    await expect(repo.listTrips()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("fails cleanly when server authentication is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    await expect(createClient()).rejects.toMatchObject({ status: 503, code: "NOT_CONFIGURED" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("signout with Supabase SSR", () => {
  it("returns 503 without a success redirect when Supabase logout fails", async () => {
    const signedIn = session();
    store.set(cookieName, encodedCookie(signedIn));
    mocks.fetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = new URL(String(url));
      expect(endpoint.pathname).toBe("/auth/v1/logout");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${signedIn.access_token}`);
      return Response.json({ message: "private auth service failure" }, { status: 503 });
    });
    const response = await signout(new Request("https://trip.test/auth/signout", { method: "POST", headers: { Origin: "https://trip.test" } }));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: "Sign-in is temporarily unavailable. Please try again.", code: "AUTH_UNAVAILABLE" });
  });

  it("clears session cookies and redirects after successful logout", async () => {
    store.set(cookieName, encodedCookie(session()));
    mocks.fetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = new URL(String(url));
      expect(endpoint.pathname).toBe("/auth/v1/logout");
      expect(endpoint.searchParams.get("scope")).toBe("global");
      expect(init?.method).toBe("POST");
      return new Response(null, { status: 204 });
    });
    const response = await signout(new Request("https://trip.test/auth/signout", { method: "POST", headers: { Origin: "https://trip.test" } }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://trip.test/login");
    expect(store.get(cookieName)).toMatchObject({ value: "", maxAge: 0, path: "/" });
    const repo = new SupabaseTripRepository(await createClient());
    await expect(repo.listTrips()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("mock account auth", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("ENABLE_MOCK_ACCOUNTS", "true");
  });

  it("sets a mock account cookie for a selected role", async () => {
    const form = new FormData();
    form.set("account", "22222222-2222-4222-8222-222222222222");
    const response = await mockSignIn(new Request("http://localhost:3001/auth/mock", { method: "POST", headers: { Origin: "http://127.0.0.1:3001" }, body: form }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3001/");
    expect(response.headers.get("set-cookie")).toContain("waypoint_mock_account=22222222-2222-4222-8222-222222222222");
  });

  it("clears mock cookies on signout without contacting Supabase", async () => {
    const response = await signout(new Request("http://localhost:3001/auth/signout", { method: "POST", headers: { Origin: "http://127.0.0.1:3001" } }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3001/login");
    expect(response.headers.get("set-cookie")).toContain("waypoint_mock_account=");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("allows a signed-in mock account through middleware without Supabase", async () => {
    const incoming = new NextRequest("https://trip.test/", {
      headers: { cookie: "waypoint_mock_account=33333333-3333-4333-8333-333333333333" },
    });
    const response = await middleware(incoming);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("allows unconfigured protected pages to render their disabled login state without redirecting", async () => {
    const incoming = new NextRequest("http://localhost:3103/", { headers: { Host: "127.0.0.1:3103" } });
    const response = await middleware(incoming);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("PKCE auth callback", () => {
  it("exchanges the code with the cookie verifier and persists the session for the next authenticated request", async () => {
    store.set(`${cookieName}-code-verifier`, encodedCookie("test-verifier"));
    const signedIn = session();
    mocks.fetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/token?grant_type=pkce")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ auth_code: "test-code", code_verifier: "test-verifier" });
        return Response.json(signedIn);
      }
      expect(String(url)).toBe(`${supabaseUrl}/auth/v1/user`);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${signedIn.access_token}`);
      return Response.json(user);
    });
    const response = await callback(new Request("https://trip.test/auth/callback?code=test-code&next=%2F%3Ftrip%3D123"));
    expect(response.headers.get("location")).toBe("https://trip.test/?trip=123");
    expect(store.get(cookieName)?.value).toBe(encodedCookie(signedIn));
    expect(store.get(`${cookieName}-code-verifier`)?.value).toBe("");
    const next = new NextRequest("https://trip.test/api/trips", { headers: { cookie: `${cookieName}=${store.get(cookieName)?.value}` } });
    expect((await middleware(next)).status).toBe(200);
  });

  it.each(["//evil.test", "/\\evil.test", "https://evil.test"])("keeps callback redirects internal: %s", async (next) => {
    store.set(`${cookieName}-code-verifier`, encodedCookie("test-verifier"));
    mocks.fetch.mockImplementation(async () => Response.json(session()));
    const response = await callback(new Request(`https://trip.test/auth/callback?code=test-code&next=${encodeURIComponent(next)}`));
    expect(response.headers.get("location")).toBe("https://trip.test/");
  });

  it.each(["missing-code", "missing-verifier", "rejected-code"])("does not create a session for %s", async (failure) => {
    if (failure === "rejected-code") {
      store.set(`${cookieName}-code-verifier`, encodedCookie("test-verifier"));
      mocks.fetch.mockResolvedValue(Response.json({ code: "flow_state_expired", message: "private detail" }, { status: 400 }));
    }
    const response = await callback(new Request(`https://trip.test/auth/callback${failure === "missing-code" ? "" : "?code=test-code"}`));
    expect(response.headers.get("location")).toBe("https://trip.test/login?error=link_expired");
    expect(store.get(cookieName)).toBeUndefined();
    if (failure !== "rejected-code") expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps client initialization failures out of the public callback response", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const response = await callback(new Request("https://trip.test/auth/callback?code=test-code"));
    expect(response.headers.get("location")).toBe("https://trip.test/login?error=link_expired");
    expect(store.get(cookieName)).toBeUndefined();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
