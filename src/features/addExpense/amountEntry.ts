/**
 * Keypad entry (Add expense, Split cells, Settle): the typed text, and its value in integer minor units. Pure.
 *
 * The text is what the keypad has built ("36", "36.5", "0.05"); money never leaves integers: `entryToMinor` splits
 * on the point and pads the fraction to the currency's exponent, with no floating arithmetic. The same rules type a
 * percentage in basis points (exponent 2, at most 10,000 = 100%).
 */
import { LIMITS } from '@even/core';

import type { KeypadKey } from '@/components/Keypad';

/** Minor units for `text` at `exponent` fraction digits ('' reads 0). */
export function entryToMinor(text: string, exponent: number): number {
  if (text === '' || text === '.') return 0;
  const [whole = '', fraction = ''] = text.split('.');
  const digits = `${whole === '' ? '0' : whole}${fraction.padEnd(exponent, '0').slice(0, exponent)}`;
  return Number.parseInt(digits, 10);
}

/** The text that re-enters `minor` on the keypad: 3600 → "36", 3650 → "36.5", 5 → "0.05" (exponent 2). */
export function minorToEntry(minor: number, exponent: number): string {
  if (!Number.isSafeInteger(minor) || minor <= 0) return '';
  if (exponent === 0) return String(minor);
  const padded = String(minor).padStart(exponent + 1, '0');
  const whole = padded.slice(0, -exponent);
  const fraction = padded.slice(-exponent).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/**
 * One key press. Digits past the exponent, a second point, a point in a currency without minor units, and any key
 * that would take the value above `max` are ignored; leading zeros collapse ("0" then "5" is "5").
 */
export function applyKey(
  text: string,
  key: KeypadKey,
  exponent: number,
  max: number = LIMITS.amountMax,
): string {
  if (key === 'delete') return text.slice(0, -1);
  if (key === '.') {
    if (exponent === 0 || text.includes('.')) return text;
    return text === '' ? '0.' : `${text}.`;
  }
  const point = text.indexOf('.');
  if (point >= 0 && text.length - point - 1 >= exponent) return text;
  const next = text === '0' ? key : `${text}${key}`;
  if (next === '0' && text === '') return text; // a lone leading zero adds nothing
  return entryToMinor(next, exponent) > max ? text : next;
}
