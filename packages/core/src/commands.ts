/**
 * Slash-command parser for commands typed in the platform compose box
 * (docs/01-product-scope.md §4). Pure function: returns null if the draft is not a command.
 *
 *   //                 -> auto suggestions
 *   //flirty           -> tone
 *   //ask out          -> objective
 *   //topic | //guide  -> mode
 *   //fix <draft>      -> rewrite the given draft
 *   //eng | //urdu     -> language mix
 *   //short | //1      -> length
 *   //? <question>     -> free-text directive (guide mode)
 *   anything else      -> free-text directive with auto mode, e.g. "//she left me on read"
 */
import type { Controls, LanguageMix, Length, Objective, SuggestMode, Tone } from './model';

export const COMMAND_PREFIX = '//';

export interface ParsedCommand {
  mode: SuggestMode;
  controls: Controls;
  directive?: string;
  draft?: string;
}

const TONES: Record<string, Tone> = {
  chill: 'chill',
  playful: 'playful',
  flirty: 'flirty',
  flirt: 'flirty',
  sweet: 'sweet',
  sincere: 'sincere',
  deep: 'sincere',
  funny: 'funny',
  sorry: 'apologetic',
  apologetic: 'apologetic',
  confident: 'confident',
};

const OBJECTIVES: Record<string, Objective> = {
  'keep going': 'keep_going',
  rapport: 'build_rapport',
  deepen: 'deepen',
  'flirt up': 'flirt_up',
  'ask out': 'ask_out',
  'ask her out': 'ask_out',
  'ask him out': 'ask_out',
  date: 'ask_out',
  recover: 'recover',
  'slow down': 'slow_down',
  bye: 'end_gracefully',
  end: 'end_gracefully',
};

const LANGS: Record<string, LanguageMix> = {
  eng: 'more_english',
  english: 'more_english',
  urdu: 'more_urdu_hindi',
  hindi: 'more_urdu_hindi',
};

const LENGTHS: Record<string, Length> = {
  short: 'short',
  '1': 'one_liner',
  oneliner: 'one_liner',
  long: 'normal',
};

export function isCommand(draft: string): boolean {
  return draft.trimStart().startsWith(COMMAND_PREFIX);
}

export function parseCommand(draft: string): ParsedCommand | null {
  const trimmed = draft.trim();
  if (!trimmed.startsWith(COMMAND_PREFIX)) return null;
  // A URL like "//example.com" pasted alone is not a command: require no dot in the first token.
  const body = trimmed.slice(COMMAND_PREFIX.length).trim();
  const firstToken = body.split(/\s+/)[0] ?? '';
  if (/^[\w-]+\.[a-z]{2,}/i.test(firstToken)) return null;

  const lower = body.toLowerCase();
  if (lower === '') return { mode: 'auto', controls: {} };

  if (lower.startsWith('?')) {
    const q = body.slice(1).trim();
    return { mode: 'guide', controls: {}, ...(q ? { directive: q } : {}) };
  }
  if (lower === 'fix' || lower.startsWith('fix ')) {
    const d = body.slice(3).trim();
    return d ? { mode: 'rewrite', controls: {}, draft: d } : { mode: 'rewrite', controls: {} };
  }
  if (lower === 'topic' || lower === 'topics') return { mode: 'topic', controls: {} };
  if (lower === 'guide' || lower === 'help') return { mode: 'guide', controls: {} };

  const tone = TONES[lower];
  if (tone) return { mode: 'reply', controls: { tone } };
  const objective = OBJECTIVES[lower];
  if (objective) return { mode: 'auto', controls: { objective } };
  const language = LANGS[lower];
  if (language) return { mode: 'reply', controls: { language } };
  const length = LENGTHS[lower];
  if (length) return { mode: 'reply', controls: { length } };

  return { mode: 'auto', controls: {}, directive: body };
}
