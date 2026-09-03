export const supabaseUrl = "https://auth-test.supabase.co";
export const anonKey = "test-anon-key";
export const cookieName = "sb-auth-test-auth-token";
export const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "owner@example.test" };

export function session(expiresAt = Math.floor(Date.now() / 1000) + 3600) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expiresAt, role: "authenticated" })}.test-signature`,
    refresh_token: "test-refresh-token", expires_at: expiresAt, expires_in: 3600,
    token_type: "bearer", user,
  };
}

export function encodedCookie(value: unknown) {
  return "base64-" + Buffer.from(JSON.stringify(value)).toString("base64url");
}
