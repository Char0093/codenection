import { isAuthError, isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/http/errors";

const invalidSessionCodes = new Set([
  "bad_jwt", "invalid_jwt", "no_authorization", "session_not_found", "session_expired",
  "refresh_token_not_found", "refresh_token_already_used", "user_not_found", "user_banned",
]);

export function authenticationError(error: unknown): AppError {
  if (isAuthError(error) && (
    isAuthSessionMissingError(error) ||
    ((error.status ?? 0) < 500 && error.status !== 429 && (
      error.status === 401 || error.status === 403 ||
      error.name === "AuthInvalidJwtError" || error.name === "AuthInvalidCredentialsError" ||
      invalidSessionCodes.has(error.code ?? "")
    ))
  )) {
    return new AppError(401, "Please sign in to continue.", "UNAUTHENTICATED");
  }
  return new AppError(503, "Sign-in is temporarily unavailable. Please try again.", "AUTH_UNAVAILABLE");
}

export async function verifiedUser(client: Pick<SupabaseClient, "auth">) {
  const result = await client.auth.getUser().catch((error: unknown) => {
    throw authenticationError(error);
  });
  if (result.error) throw authenticationError(result.error);
  if (!result.data.user) throw new AppError(401, "Please sign in to continue.", "UNAUTHENTICATED");
  return result.data.user;
}
