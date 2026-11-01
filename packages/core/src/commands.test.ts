import { describe, expect, it } from 'vitest';
import { isCommand, parseCommand } from './commands';

describe('parseCommand', () => {
  it.each([
    ['//', { mode: 'auto', controls: {} }],
    ['  //  ', { mode: 'auto', controls: {} }],
    ['//flirty', { mode: 'reply', controls: { tone: 'flirty' } }],
    ['//ask out', { mode: 'auto', controls: { objective: 'ask_out' } }],
    ['//topic', { mode: 'topic', controls: {} }],
    ['//eng', { mode: 'reply', controls: { language: 'more_english' } }],
    ['//1', { mode: 'reply', controls: { length: 'one_liner' } }],
    ['//fix kya kar rahi ho', { mode: 'rewrite', controls: {}, draft: 'kya kar rahi ho' }],
    ['//? she left me on read', { mode: 'guide', controls: {}, directive: 'she left me on read' }],
    ['//she is stressed about viva', { mode: 'auto', controls: {}, directive: 'she is stressed about viva' }],
  ])('%s', (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it('returns null for normal messages and URLs', () => {
    expect(parseCommand('haha acha')).toBeNull();
    expect(parseCommand('/ single slash')).toBeNull();
    expect(parseCommand('//example.com/page')).toBeNull();
    expect(isCommand('hello //')).toBe(false);
  });
});
