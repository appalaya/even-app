/**
 * CSV export of a group's expenses and payments (design.md "Group settings": export CSV; "Key patterns": CSV safety).
 *
 * - UTF-8 with a byte-order mark, so spreadsheet apps pick the right encoding for names and emoji.
 * - RFC 4180: CRLF line ends; a field containing a comma, a double quote, CR or LF is wrapped in double quotes with
 *   inner quotes doubled.
 * - Formula-injection guard: a cell beginning with `=`, `+`, `-` or `@` is prefixed with `'`, so a spreadsheet does
 *   not execute another member's title. (Tab and CR, which some spreadsheets also treat as formula starts, are
 *   guarded the same way.)
 * - Amounts are plain decimals in the group currency ("12.34", "1500" for JPY), converted exactly from minor units
 *   with the ISO 4217 exponent; no symbol and no grouping, so a spreadsheet reads them as numbers.
 *
 * The file is decrypted content: `FileIO.share` writes it to a temporary file and deletes it when the sheet closes.
 */
import { CATEGORY_LABEL, exponentOf, type GroupState } from '@even/core';

import { fileBaseName } from '../groupFile/groupFile';
import type { FileIO } from '../groupFile/fileIO';

export const CSV_BOM = '﻿';
export const CSV_MIME = 'text/csv';
export const CSV_UTI = 'public.comma-separated-values-text';

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** Prefixes `'` to a cell a spreadsheet would read as a formula. */
export function guardFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** One RFC 4180 field, formula-guarded. */
export function csvCell(value: string): string {
  const guarded = guardFormula(value);
  return NEEDS_QUOTES.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Rows to CSV text: BOM, fields joined by commas, lines ended with CRLF. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(',') + '\r\n').join('');
}

/**
 * Minor units as a plain decimal string with the currency's ISO exponent ("-12.05", "1500"). Exact for any safe
 * integer (BigInt and string operations, no floating point). Throws RangeError for an unknown currency.
 */
export function minorToDecimal(amount: number, currency: string): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError('amount must be a safe integer');
  const exp = exponentOf(currency);
  const negative = amount < 0;
  const digits = BigInt(negative ? -amount : amount).toString();
  if (exp === 0) return `${negative ? '-' : ''}${digits}`;
  const padded = digits.padStart(exp + 1, '0');
  return `${negative ? '-' : ''}${padded.slice(0, -exp)}.${padded.slice(-exp)}`;
}

function amountText(amount: number, currency: string): string {
  try {
    return minorToDecimal(amount, currency);
  } catch {
    return String(amount); // a shape-valid but unknown currency: the raw integer, never a crash
  }
}

interface Line {
  date: string;
  at: number;
  id: string;
  cells: string[];
}

/**
 * The group's live expenses and payments, oldest first (by date, then when they were added). Columns: Type, Date,
 * Title, Category, Paid by, Paid to, Amount, Currency, Note, then one column per member with that member's share of
 * each expense. Deleted expenses and payments are not exported.
 */
export function groupCsvRows(state: GroupState): string[][] {
  const members = [...state.members.values()];
  const nameOf = (id: string): string => state.members.get(id)?.name ?? 'Unknown';
  const header = [
    'Type',
    'Date',
    'Title',
    'Category',
    'Paid by',
    'Paid to',
    'Amount',
    'Currency',
    'Note',
    ...members.map((m) => m.name),
  ];
  const lines: Line[] = [];
  for (const e of state.expenses.values()) {
    lines.push({
      date: e.date,
      at: e.addedAt,
      id: e.id,
      cells: [
        'Expense',
        e.date,
        e.title,
        CATEGORY_LABEL[e.category],
        nameOf(e.paidBy),
        '',
        amountText(e.amount, e.currency),
        e.currency,
        e.note ?? '',
        ...members.map((m) => {
          const share = Object.prototype.hasOwnProperty.call(e.split, m.id)
            ? e.split[m.id]
            : undefined;
          return share === undefined ? '' : amountText(share, e.currency);
        }),
      ],
    });
  }
  for (const p of state.payments.values()) {
    lines.push({
      date: p.date,
      at: p.addedAt,
      id: p.id,
      cells: [
        'Payment',
        p.date,
        '',
        '',
        nameOf(p.from),
        nameOf(p.to),
        amountText(p.amount, p.currency),
        p.currency,
        p.note ?? '',
        ...members.map(() => ''),
      ],
    });
  }
  lines.sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date
        ? -1
        : 1
      : a.at !== b.at
        ? a.at - b.at
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
  );
  return [header, ...lines.map((line) => line.cells)];
}

export function groupCsv(state: GroupState): string {
  return toCsv(groupCsvRows(state));
}

/** Builds the CSV and opens the share sheet. */
export async function exportGroupCsv(
  files: FileIO,
  state: GroupState,
  groupName: string,
): Promise<void> {
  await files.share({
    name: `${fileBaseName(groupName)}.csv`,
    contents: groupCsv(state),
    mimeType: CSV_MIME,
    uti: CSV_UTI,
  });
}
