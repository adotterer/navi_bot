/**
 * Single source of truth for which commands are allowed in the ask-navi channel
 * without being deleted. Must stay in sync with /admin/commands documentation.
 *
 * Includes:
 * - ask-navi or Mod/Legend: !mu, !mq, !q, !sq, !fdq, !gt
 * - Any channel: !fd, !sl, !s, !stats, !docs, !faq, !aliases, !canonical
 */
const content = (msg) => (msg || '').trim().toLowerCase();

/** Matcher functions; each returns true if the message matches that command. */
const matchers = [
  (c) => c.startsWith('!mu-notes'),
  (c) => c.startsWith('!mu-question'),
  (c) => c.startsWith('!mu-q '),
  (c) => c.startsWith('!muq '),
  (c) => c === '!mq' || c.startsWith('!mq '),
  (c) => c.startsWith('!mu'), // !mu, !mu falco, etc.
  (c) => c.startsWith('!fdq '),
  (c) => c.startsWith('!fd '),
  (c) => c.startsWith('!gt '),
  (c) => c === '!sl',
  (c) => c.startsWith('!q '),
  (c) => c.startsWith('!sq '),
  (c) => c.startsWith('!s ') || c === '!s',
  (c) => c.startsWith('!stats ') || c === '!stats',
  (c) => c === '!docs',
  (c) => c === '!faq',
  (c) => c === '!aliases',
  (c) => c === '!canonical',
];

/**
 * Returns true if the message content matches an allowed command in ask-navi.
 * Used by the first messageCreate listener to avoid deleting allowed messages.
 */
export function isAllowedInAskNavi(messageContent) {
  const c = content(messageContent);
  if (!c || !c.startsWith('!')) return false;
  return matchers.some((m) => m(c));
}
