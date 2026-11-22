/**
 * The only kinds of link the app hands to a browser or to the system: web
 * pages over https, e-mail and phone numbers (security audit APP-08). A link
 * that arrives in server data (an Atlas report, for example) could otherwise
 * carry `javascript:`, `intent:` or a plain-http page. Shared by both
 * `open-link` twins, which reject anything else.
 */
const ALLOWED_LINK = /^(https:\/\/[^\s]+|mailto:[^\s]+|tel:[^\s]+)$/i;

export function isAllowedLink(url: string): boolean {
  return ALLOWED_LINK.test(url.trim());
}
