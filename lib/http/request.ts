import { AppError } from "./errors";

function sameLoopbackOrigin(origin: URL, target: URL): boolean {
  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  return origin.protocol === target.protocol
    && origin.port === target.port
    && loopback.has(origin.hostname)
    && loopback.has(target.hostname);
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const target = new URL(request.url);
  let parsedOrigin: URL | null = null;
  try { parsedOrigin = origin ? new URL(origin) : null; } catch { /* handled below */ }
  if (!parsedOrigin || (parsedOrigin.origin !== target.origin && !sameLoopbackOrigin(parsedOrigin, target))) {
    throw new AppError(403, "This request must come from the trip app.", "INVALID_ORIGIN");
  }
}

export async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "A JSON request body is required.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) {
        await reader.cancel();
        throw new AppError(413, "The request is too large.", "PAYLOAD_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(text); }
  catch { throw new AppError(400, "The request must contain valid JSON.", "INVALID_JSON"); }
}
