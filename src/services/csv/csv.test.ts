import { emptyState, minorToDecimal, newId, reduce, type Event, type LogEntry } from '@even/core';
import { describe, expect, it } from 'vitest';

import { createMemoryFileIO } from '../groupFile/memoryFileIO';
import {
  CSV_BOM,
  csvCell,
  exportGroupCsv,
  groupCsv,
  groupCsvRows,
  guardFormula,
  toCsv,
} from './csv';

describe('CSV safety and format', () => {
  it('guards cells a spreadsheet would run as a formula', () => {
    for (const hostile of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=1', '\r=1']) {
      expect(guardFormula(hostile)).toBe(`'${hostile}`);
    }
    for (const fine of ['Dinner', '12.34', "'quoted", ' =leading space', '']) {
      expect(guardFormula(fine)).toBe(fine);
    }
  });

  it('quotes per RFC 4180 after guarding', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });

  it('writes a BOM and CRLF line ends', () => {
    const text = toCsv([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text).toBe(`${CSV_BOM}a,b\r\n1,2\r\n`);
  });

  it('converts minor units exactly with the ISO exponent (core minorToDecimal)', () => {
    expect(minorToDecimal(1234, 'USD')).toBe('12.34');
    expect(minorToDecimal(5, 'USD')).toBe('0.05');
    expect(minorToDecimal(0, 'EUR')).toBe('0.00');
    expect(minorToDecimal(-1205, 'CAD')).toBe('-12.05');
    expect(minorToDecimal(1500, 'JPY')).toBe('1500');
    expect(minorToDecimal(1, 'KWD')).toBe('0.001');
    expect(minorToDecimal(1_000_000_000_000, 'USD')).toBe('10000000000.00');
    expect(minorToDecimal(Number.MAX_SAFE_INTEGER, 'USD')).toBe('90071992547409.91');
    expect(() => minorToDecimal(1, 'XXX')).toThrow(RangeError);
  });
});

describe('group CSV', () => {
  const maya = newId();
  const nathan = newId();
  const dev = newId();
  let ts = 1_760_000_000_000;
  const at = (): { sv: 1; ts: number; at: number; by: string; dev: string } => {
    ts += 1000;
    return { sv: 1, ts, at: ts, by: maya, dev };
  };
  const entry = (event: Event): LogEntry => ({ id: newId(), event });
  const deletedId = newId();
  const log: LogEntry[] = [
    entry({ ...at(), type: 'group.created', name: 'Banff', currency: 'CAD' }),
    entry({ ...at(), type: 'member.added', member: { id: maya, name: 'Maya' } }),
    entry({ ...at(), type: 'member.added', member: { id: nathan, name: 'Nathan, Jr.' } }),
    entry({
      ...at(),
      type: 'expense.added',
      expense: {
        id: newId(),
        title: '=HYPERLINK("http://evil","click")',
        amount: 9001,
        currency: 'CAD',
        paidBy: maya,
        date: '2026-02-02',
        category: 'food',
        note: 'line one\nline two',
        split: { [maya]: 4501, [nathan]: 4500 },
      },
    }),
    entry({
      ...at(),
      type: 'expense.added',
      expense: {
        id: newId(),
        title: 'Gas',
        amount: 5000,
        currency: 'CAD',
        paidBy: nathan,
        date: '2026-02-01',
        category: 'fuel',
        split: { [maya]: 5000 },
      },
    }),
    entry({
      ...at(),
      type: 'expense.added',
      expense: {
        id: deletedId,
        title: 'Deleted',
        amount: 100,
        currency: 'CAD',
        paidBy: maya,
        date: '2026-01-01',
        category: 'other',
        split: { [maya]: 100 },
      },
    }),
    entry({ ...at(), type: 'expense.deleted', id: deletedId }),
    entry({
      ...at(),
      type: 'payment.added',
      payment: {
        id: newId(),
        from: nathan,
        to: maya,
        amount: 4500,
        currency: 'CAD',
        date: '2026-02-03',
      },
    }),
  ];
  const state = reduce(log);

  it('lists live expenses and payments by date with per-member shares', () => {
    const rows = groupCsvRows(state);
    expect(rows[0]).toEqual([
      'Type',
      'Date',
      'Title',
      'Category',
      'Paid by',
      'Paid to',
      'Amount',
      'Currency',
      'Note',
      'Maya',
      'Nathan, Jr.',
    ]);
    expect(rows.slice(1).map((r) => r[2])).toEqual([
      'Gas',
      '=HYPERLINK("http://evil","click")',
      '',
    ]);
    expect(rows[1]).toEqual([
      'Expense',
      '2026-02-01',
      'Gas',
      'Fuel',
      'Nathan, Jr.',
      '',
      '50.00',
      'CAD',
      '',
      '50.00',
      '',
    ]);
    expect(rows[2]?.slice(6)).toEqual(['90.01', 'CAD', 'line one\nline two', '45.01', '45.00']);
    expect(rows[3]).toEqual([
      'Payment',
      '2026-02-03',
      '',
      '',
      'Nathan, Jr.',
      'Maya',
      '45.00',
      'CAD',
      '',
      '',
      '',
    ]);
  });

  it('the text guards the hostile title, quotes what needs it, and has a BOM', () => {
    const text = groupCsv(state);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text).toContain('"\'=HYPERLINK(""http://evil"",""click"")"');
    expect(text).toContain('"Nathan, Jr."');
    expect(text).toContain('"line one\nline two"');
    expect(text).not.toContain('Deleted');
    expect(text.split('\r\n')).toHaveLength(5); // header, 3 rows, trailing empty
  });

  it('an empty group exports just the header', () => {
    expect(groupCsvRows(emptyState())).toHaveLength(1);
  });

  it('exports through the share interface with a safe file name', async () => {
    const files = createMemoryFileIO();
    await exportGroupCsv(files, state, 'Banff / 2026: "trip"');
    expect(files.shared).toHaveLength(1);
    expect(files.shared[0]).toMatchObject({
      name: 'Banff - 2026- -trip-.csv',
      mimeType: 'text/csv',
    });
    expect(files.shared[0]?.contents).toBe(groupCsv(state));
  });
});
