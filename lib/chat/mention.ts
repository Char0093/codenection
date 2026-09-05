/** Task 3.2/3.3: the assistant answers only when addressed, never on every message. No
 * server-only dependency here -- both the client composer and the server route need this check. */
export function shouldAddressAssistant(body: string): boolean {
  return /(^|\s)@ai(\s|$|[.,!?])/i.test(body);
}
