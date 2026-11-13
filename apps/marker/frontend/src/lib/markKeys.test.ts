import { describe, expect, it } from 'vitest';
import { applyDigit, isMarkDigitKey } from './markKeys';

describe('applyDigit', () => {
  it('starts a number, and replaces it after a pause', () => {
    expect(applyDigit({ text: '', at: 0 }, '3', 1000, 6)).toBe('3');
    expect(applyDigit({ text: '3', at: 1000 }, '5', 3000, 6)).toBe('5');
  });
  it('joins digits typed quickly when the result is still a possible mark', () => {
    expect(applyDigit({ text: '1', at: 1000 }, '0', 1300, 12)).toBe('10');
    expect(applyDigit({ text: '1', at: 1000 }, '0', 1300, 6)).toBe('0');
  });
  it('does not make 05 out of 0 then 5', () => {
    expect(applyDigit({ text: '0', at: 1000 }, '5', 1200, 12)).toBe('5');
  });
});

const key = (over: Partial<Parameters<typeof isMarkDigitKey>[0]> = {}) =>
  ({ key: '4', ctrlKey: false, metaKey: false, altKey: false, target: { tagName: 'DIV' }, ...over });

describe('isMarkDigitKey', () => {
  it('accepts a bare digit on the page', () => expect(isMarkDigitKey(key(), 'tick')).toBe(true));
  it('ignores other keys and shortcuts', () => {
    expect(isMarkDigitKey(key({ key: 'a' }), 'tick')).toBe(false);
    expect(isMarkDigitKey(key({ ctrlKey: true }), 'tick')).toBe(false);
    expect(isMarkDigitKey(key({ metaKey: true }), 'tick')).toBe(false);
  });
  it('leaves typing in a field alone', () => {
    expect(isMarkDigitKey(key({ target: { tagName: 'INPUT' } }), 'tick')).toBe(false);
    expect(isMarkDigitKey(key({ target: { tagName: 'TEXTAREA' } }), 'tick')).toBe(false);
  });
  it('is off while the Text tool is selected', () => expect(isMarkDigitKey(key(), 'text')).toBe(false));
});

import { isSaveEnterKey } from './markKeys';

const enter = (over: Record<string, unknown> = {}) =>
  ({ key: 'Enter', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, target: { tagName: 'DIV' }, ...over });

describe('isSaveEnterKey', () => {
  it('saves and moves on from the page or the Marks box', () => {
    expect(isSaveEnterKey(enter(), 'tick')).toBe(true);
    expect(isSaveEnterKey(enter({ target: { tagName: 'INPUT', id: 'marks' } }), 'tick')).toBe(true);
  });
  it('leaves Enter alone with the Text tool, in other fields and on controls', () => {
    expect(isSaveEnterKey(enter(), 'text')).toBe(false);
    expect(isSaveEnterKey(enter({ target: { tagName: 'INPUT', id: 'other' } }), 'tick')).toBe(false);
    expect(isSaveEnterKey(enter({ target: { tagName: 'BUTTON' } }), 'tick')).toBe(false);
    expect(isSaveEnterKey(enter({ target: { tagName: 'SELECT' } }), 'tick')).toBe(false);
    expect(isSaveEnterKey(enter({ target: { tagName: 'TEXTAREA' } }), 'tick')).toBe(false);
  });
  it('ignores held keys, repeats and other keys', () => {
    expect(isSaveEnterKey(enter({ repeat: true }), 'tick')).toBe(false);
    expect(isSaveEnterKey(enter({ ctrlKey: true }), 'tick')).toBe(false);
    expect(isSaveEnterKey(enter({ key: 'a' }), 'tick')).toBe(false);
  });
});
