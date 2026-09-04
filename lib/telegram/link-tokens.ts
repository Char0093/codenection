import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, databaseError } from "@/lib/http/errors";

export const TELEGRAM_LINK_TOKEN_BYTES = 32;
export const TELEGRAM_LINK_TOKEN_TTL_SECONDS = 15 * 60;

const tokenSchema = z.string().regex(/^wpt_[A-Za-z0-9_-]{43}$/);
const telegramIdSchema = z.string().regex(/^[1-9][0-9]{0,19}$/);
const displayNameSchema = z.string().trim().min(1).max(120);

export type TelegramLinkToken = {
  token: string;
  tokenHash: string;
  expiresAt: string;
};

export type LinkedTelegramMember = {
  tripId: string;
  memberId: string;
  role: "owner" | "planner" | "member" | "viewer";
  displayName: string;
};

const linkedMemberSchema = z.object({
  trip_id: z.string().uuid(),
  member_id: z.string().uuid(),
  role: z.enum(["owner", "planner", "member", "viewer"]),
  display_name: z.string().min(1),
});

export function generateTelegramLinkToken(now = new Date()): TelegramLinkToken {
  const token = `wpt_${randomBytes(TELEGRAM_LINK_TOKEN_BYTES).toString("base64url")}`;
  return {
    token,
    tokenHash: hashTelegramLinkToken(token),
    expiresAt: new Date(now.getTime() + TELEGRAM_LINK_TOKEN_TTL_SECONDS * 1000).toISOString(),
  };
}

export function hashTelegramLinkToken(token: string): string {
  const parsed = tokenSchema.parse(token);
  return createHash("sha256").update(parsed, "utf8").digest("hex");
}

export function equalTokenHash(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function mapLinkedMember(value: unknown): LinkedTelegramMember {
  const parsed = linkedMemberSchema.parse(Array.isArray(value) ? value[0] : value);
  return { tripId: parsed.trip_id, memberId: parsed.member_id, role: parsed.role, displayName: parsed.display_name };
}

export async function createTelegramLinkToken(
  client: SupabaseClient,
  tripId: string,
  memberId: string,
): Promise<TelegramLinkToken> {
  z.string().uuid().parse(tripId);
  z.string().uuid().parse(memberId);
  const token = generateTelegramLinkToken();
  const { error } = await client.rpc("create_telegram_link_token", {
    target_trip_id: tripId,
    target_member_id: memberId,
    token_hash: token.tokenHash,
    expires_at: token.expiresAt,
  });
  if (error) databaseError(error);
  return token;
}

export async function redeemTelegramLinkToken(
  client: SupabaseClient,
  token: string,
  telegramUserId: string,
  displayName: string,
): Promise<LinkedTelegramMember> {
  const tokenHash = hashTelegramLinkToken(token);
  const telegramId = telegramIdSchema.parse(telegramUserId);
  const name = displayNameSchema.parse(displayName);
  const { data, error } = await client.rpc("redeem_telegram_link_token", {
    token_hash: tokenHash,
    telegram_user_id: telegramId,
    display_name: name,
  });
  if (error) databaseError(error);
  if (!data) throw new AppError(404, "Telegram link token not found.", "NOT_FOUND");
  return mapLinkedMember(data);
}
