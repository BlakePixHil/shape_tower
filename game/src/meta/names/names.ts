// Ladder names (gameplay.md §12.3): the rules a name must pass, and the filter that keeps rude, hateful,
// sexual and personal names off the ladder. Pure, so the phone, the game page and the server all run
// the same code; the server's check is the one that counts, and every name is checked again when shown.

import { ALLOW, STRONG, WEAK } from './words.ts';

export const NAME_MIN = 3;
export const NAME_MAX = 16;

export type NameProblem = 'short' | 'long' | 'chars' | 'letter' | 'spacing' | 'repeat' | 'contact' | 'blocked' | 'reserved';

/** What the name box says for each problem (never echoing the word that tripped the filter). */
export const NAME_HINT: Record<NameProblem | 'taken' | 'renamed', string> = {
  short: `At least ${NAME_MIN} characters`,
  long: `${NAME_MAX} characters at most`,
  chars: 'Letters, numbers, spaces, - and _ only',
  letter: 'Needs at least one letter',
  spacing: 'Start with a letter or number, and one space or symbol at a time',
  repeat: 'No more than 3 of the same character in a row',
  contact: 'No links, emails or phone numbers',
  blocked: "That name isn't allowed. Try another one.",
  reserved: "That name is reserved. Try another one.",
  taken: 'Someone already has that name',
  renamed: 'You can change your name once a week',
};

/** Folds runs of spaces and trims: what the player meant to type. */
export function tidyName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** The first problem with a name, or null when it may go on the ladder (being free is the server's check). */
export function nameProblem(raw: string): NameProblem | null {
  const name = tidyName(raw);
  if (name.length < NAME_MIN) return 'short';
  if (name.length > NAME_MAX) return 'long';
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) return 'chars';
  if (!/[A-Za-z]/.test(name)) return 'letter';
  if (!/^[A-Za-z0-9]/.test(name) || /[ _-][ _-]/.test(name) || /[ _-]$/.test(name)) return 'spacing';
  if (/(.)\1\1\1/i.test(name)) return 'repeat';
  if (contactLike(name)) return 'contact';
  if (isBlocked(name)) return 'blocked';
  if (isReserved(name)) return 'reserved';
  return null;
}

/** Whether a name may be shown: names on the ladder are checked again on every device, with today's lists. */
export const nameShowable = (name: string): boolean => nameProblem(name) === null;

/**
 * The key two names collide on: lower case, no spaces or symbols, and look-alikes folded together
 * (0 and o, 1, i and l, rn and m...), so nobody can pass as "B1ake" next to "Blake".
 */
export function nameKey(name: string): string {
  return tidyName(name).toLowerCase().replace(/[ _-]/g, '')
    .replace(/[0-9]/g, d => KEY_DIGITS[d]).replace(/i/g, 'l').replace(/rn/g, 'm').replace(/vv/g, 'w');
}
const KEY_DIGITS: Record<string, string> = { 0: 'o', 1: 'l', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g' };

/** The generated name shown for a player with no name, or one hidden by reports: "Builder 4821". */
export function placeholderName(id: string): string {
  const n = parseInt(id.slice(0, 8), 16) || 0;
  return `Builder ${1000 + (n % 9000)}`;
}

// ------------------------------------------------------------------------------------------------
// The filter

const rot13 = (s: string): string => s.replace(/[a-z]/g, c => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const list = (s: string): string[] => rot13(s).split(' ').filter(Boolean);
// A strong word's letters may each be stretched ("fuuuck"); doubled letters stay doubled, so "as" never
// reads as "ass". A weak word only stretches its last letter ("asss"), or "rapping" would read as one.
const stretch = (w: string): string => [...w].map(c => `${c}+`).join('');
const STRONG_RE = new RegExp(list(STRONG).map(stretch).join('|'));
const WEAK_RE = new RegExp(`^(?:${list(WEAK).map(w => `${w}+`).join('|')})(?:e?s|z)?$`);
const ALLOW_RE = new RegExp(list(ALLOW).join('|'), 'g');
// A word stretched all over ("cooock", "ccoocckk") is read with its runs squeezed, against the weak words squeezed.
const squeeze = (w: string): string => w.replace(/(.)\1+/g, '$1');
const WEAK_SQUEEZED = new Set(list(WEAK).map(squeeze));
const stretched = (w: string): boolean => /(.)\1\1/.test(w) || (w.match(/(.)\1/g) ?? []).length >= 2;
// Read backwards too, but only the worst few: short words backwards hide in too many real ones ("tulsi").
const BACKWARDS_RE = new RegExp(rot13('shpx phag avttre snttbg ovgpu juber cravf chffl').split(' ').map(stretch).join('|'));

const LEET: Record<string, string> = { 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g' };
const leet = (s: string, one = 'i'): string => s.replace(/[0-9]/g, d => (d === '1' ? one : LEET[d]));

/**
 * The ways a run of letters and digits might be read: leetspeak both ways for 1, digits dropped, and
 * each again with v for u and ph for f. Innocent words (ALLOW) come out first, so "Phuket" stays a place.
 */
function readings(s: string): string[] {
  return [leet(s), leet(s, 'l'), s.replace(/[0-9]/g, '')].flatMap(r => {
    const clean = r.replace(ALLOW_RE, '|');
    return [clean, clean.replace(/v/g, 'u').replace(/ph/g, 'f')];
  });
}

/** The name's words: split at spaces and symbols, lower-to-upper case changes and letter-digit changes. */
function words(name: string): string[] {
  return name.split(/[ _-]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/).map(w => w.toLowerCase()).filter(Boolean);
}

function isBlocked(name: string): boolean {
  const flat = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/1488/.test(flat)) return true;
  for (const r of readings(flat)) {
    if (STRONG_RE.test(r) || BACKWARDS_RE.test([...r].reverse().join(''))) return true;
    if (WEAK_RE.test(r)) return true; // "A S S", "a_s_s"
  }
  for (const w of words(name)) {
    for (const r of readings(w)) {
      if (r && WEAK_RE.test(r)) return true;
      if (stretched(r) && WEAK_SQUEEZED.has(squeeze(r).replace(/s$/, ''))) return true;
    }
  }
  return false;
}

const CONTACT = new Set(['www', 'http', 'https', 'dotcom', 'gmail', 'hotmail', 'yahoo', 'outlook', 'icloud', 'email', 'whatsapp', 'telegram']);
/** Links, emails and phone numbers: personal details and spam stay off the ladder. */
function contactLike(name: string): boolean {
  if ((name.match(/[0-9]/g) ?? []).length >= 7) return true;
  return words(name).some(w => CONTACT.has(w));
}

const RESERVED = new Set(['admin', 'administrator', 'moderator', 'mod', 'mods', 'staff', 'support', 'help', 'helpdesk', 'official', 'dev', 'developer', 'developers',
  'gm', 'gamemaster', 'system', 'server', 'root', 'owner', 'null', 'undefined', 'anonymous', 'unknown', 'player', 'guest', 'you', 'everyone',
  'anthropic', 'shapetower', 'blockling', 'blocklings']);
const RESERVED_IN = ['admin', 'moderator', 'official', 'shapetower'];
/** Names that pass for the game or its staff, and the "Builder 1234" stand-ins. */
function isReserved(name: string): boolean {
  const k = nameKey(name), plain = tidyName(name).toLowerCase().replace(/[ _-]/g, '');
  if (RESERVED.has(k) || RESERVED.has(plain) || /^bul?lder[olzeasgtb]*$/.test(k)) return true;
  return RESERVED_IN.some(w => k.includes(nameKey(w)) || plain.includes(w));
}
