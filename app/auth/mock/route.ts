import { NextResponse } from "next/server";
import { findMockAccount, mockAccountCookie, mockAccountsEnabled } from "@/lib/mock/accounts";
import { AppError, errorResponse } from "@/lib/http/errors";
import { requireSameOrigin } from "@/lib/http/request";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (!mockAccountsEnabled()) throw new AppError(404, "Mock accounts are not enabled.", "NOT_FOUND");
    const form = await request.formData();
    const account = findMockAccount(String(form.get("account") ?? ""));
    if (!account) throw new AppError(422, "Choose a mock account.", "VALIDATION_FAILED");
    const response = NextResponse.redirect(new URL("/", request.headers.get("origin") ?? request.url), 303);
    response.cookies.set(mockAccountCookie, account.id, { httpOnly: true, sameSite: "lax", path: "/" });
    return response;
  } catch (error) { return errorResponse(error); }
}
