export function safeRedirectPath(path: string | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\x00-\x1f]|%5c|%2f/i.test(path)) return "/";
  return path;
}
