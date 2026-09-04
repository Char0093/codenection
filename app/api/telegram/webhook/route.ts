import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { errorResponse, AppError } from "@/lib/http/errors";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { redeemTelegramLinkToken } from "@/lib/telegram/link-tokens";

export const dynamic = "force-dynamic";

const telegramUpdateSchema = z.object({
  message: z.object({
    text: z.string().optional(),
    from: z.object({
      id: z.number().int().positive(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      username: z.string().optional(),
    }).optional(),
  }).optional(),
}).passthrough();

function requireTelegramSecret(request: Request): void {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expected) throw new AppError(503, "Telegram webhook is not configured.", "NOT_CONFIGURED");
  if (request.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    throw new AppError(401, "Telegram webhook secret is invalid.", "UNAUTHENTICATED");
  }
}

function displayName(from: NonNullable<NonNullable<z.infer<typeof telegramUpdateSchema>["message"]>["from"]>): string {
  return [from.first_name, from.last_name].filter(Boolean).join(" ").trim()
    || from.username?.trim()
    || `Telegram ${from.id}`;
}

function startToken(text: string | undefined): string | null {
  const match = text?.trim().match(/^\/start(?:@\w+)?\s+(wpt_[A-Za-z0-9_-]{43})$/);
  return match?.[1] ?? null;
}

export async function POST(request: Request) {
  try {
    requireTelegramSecret(request);
    if (!isSupabaseConfigured()) throw new AppError(503, "Trip storage is unavailable. Please try again.", "STORAGE_UNAVAILABLE");
    const update = telegramUpdateSchema.parse(await request.json());
    const token = startToken(update.message?.text);
    const from = update.message?.from;
    if (!token || !from) return Response.json({ ok: true, handled: false });
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const member = await redeemTelegramLinkToken(client, token, String(from.id), displayName(from));
    return Response.json({ ok: true, handled: true, tripId: member.tripId, role: member.role });
  } catch (error) { return errorResponse(error); }
}
