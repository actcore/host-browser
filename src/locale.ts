import type { LocalizedString } from './generated/interfaces/act-core-types.js';

export interface ResolveLocalizedStringOptions {
  /**
   * BCP 47 language tag declared by the component under
   * `act:component.std.default-language`. Used as a fallback when none of
   * the user's preferred locales is present.
   */
  defaultLanguage?: string;
  /**
   * Caller-preferred locales in priority order. Defaults to
   * `navigator.languages` if available, else `[navigator.language]`,
   * else `[]`.
   */
  userLocales?: readonly string[];
}

/**
 * Resolve an {@link LocalizedString} to a concrete UTF-8 string.
 *
 * Resolution order:
 * 1. If `plain` — return `val` (language undefined; callers may assume it
 *    matches `act:component.std.default-language` if declared).
 * 2. Each entry in `userLocales` (BCP 47), preferring exact match
 *    (`en-US` → `en-US`), then language-only match (`en-US` → `en`).
 * 3. `defaultLanguage`, same matching rules.
 * 4. `en`, same matching rules.
 * 5. First entry in the list.
 * 6. Empty string if the list is empty.
 *
 * Matching is case-insensitive on language tags.
 */
export function resolveLocalizedString(
  loc: LocalizedString,
  options: ResolveLocalizedStringOptions = {},
): string {
  if (loc.tag === 'plain') return loc.val;

  const entries = loc.val;
  if (entries.length === 0) return '';

  const userLocales = options.userLocales ?? defaultUserLocales();

  const candidates: string[] = [];
  for (const l of userLocales) if (l) candidates.push(l);
  if (options.defaultLanguage) candidates.push(options.defaultLanguage);
  candidates.push('en');

  for (const candidate of candidates) {
    const hit = matchLocale(entries, candidate);
    if (hit !== undefined) return hit;
  }

  return entries[0]![1];
}

function matchLocale(
  entries: ReadonlyArray<readonly [string, string]>,
  candidate: string,
): string | undefined {
  const want = candidate.toLowerCase();
  for (const [lang, text] of entries) {
    if (lang.toLowerCase() === want) return text;
  }
  const wantPrimary = primarySubtag(want);
  for (const [lang, text] of entries) {
    if (primarySubtag(lang.toLowerCase()) === wantPrimary) return text;
  }
  return undefined;
}

function primarySubtag(tag: string): string {
  const dash = tag.indexOf('-');
  return dash === -1 ? tag : tag.slice(0, dash);
}

function defaultUserLocales(): readonly string[] {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  if (!nav) return [];
  if (nav.languages && nav.languages.length > 0) return nav.languages;
  if (nav.language) return [nav.language];
  return [];
}
