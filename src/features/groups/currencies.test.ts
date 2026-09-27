import { CURRENCY_EXPONENTS } from '@even/core';
import { describe, expect, it } from 'vitest';

import {
  COMMON_CURRENCIES,
  currencyName,
  currencySections,
  REGION_CURRENCY,
  defaultCurrency,
  matchesCurrency,
  regionOf,
} from './currencies';
import { CURRENCY_NAMES_EN } from './currencyNames';

describe('currencies', () => {
  it('reads the region from a locale', () => {
    expect(regionOf('en-CA')).toBe('CA');
    expect(regionOf('zh-Hant-TW')).toBe('TW');
    expect(regionOf('fr')).toBeNull();
  });

  it('defaults from the region, with USD when there is none', () => {
    expect(defaultCurrency('en-CA')).toBe('CAD');
    expect(defaultCurrency('de-AT')).toBe('EUR');
    expect(defaultCurrency('ja-JP')).toBe('JPY');
    expect(defaultCurrency('en')).toBe('USD');
  });

  it('names a currency in sentence case, singular', () => {
    expect(currencyName('CAD', 'en')).toBe('Canadian dollar');
    expect(currencyName('EUR', 'en')).toBe('Euro');
  });

  it('lists Common as drawn (the region currency leads), then every other code A–Z, each once', () => {
    const { common, all } = currencySections('CAD');
    expect(common).toEqual(['CAD', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'MXN', 'INR']);
    // The board draws AED, AFN, ALL, AMD, ARS; core's ISO table also carries ANG and AOA between them.
    expect(all.slice(0, 7)).toEqual(['AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS']);
    const list = [...common, ...all];
    expect(new Set(list).size).toBe(list.length);
    expect([...list].sort()).toEqual(Object.keys(CURRENCY_EXPONENTS).sort());
    expect(currencySections('USD').common).toEqual([
      'USD',
      'EUR',
      'GBP',
      'JPY',
      'AUD',
      'MXN',
      'INR',
    ]);
  });

  it('has an English name for every accepted code', () => {
    for (const code of Object.keys(CURRENCY_EXPONENTS)) {
      expect(CURRENCY_NAMES_EN[code], code).toMatch(/^[A-Z]/);
    }
    expect(Object.keys(CURRENCY_NAMES_EN).sort()).toEqual(Object.keys(CURRENCY_EXPONENTS).sort());
    expect(CURRENCY_NAMES_EN.CAD).toBe('Canadian dollar');
  });

  it('maps regions and lists common codes only to accepted codes', () => {
    for (const code of COMMON_CURRENCIES) expect(CURRENCY_EXPONENTS[code]).toBeDefined();
    for (const code of Object.values(REGION_CURRENCY))
      expect(CURRENCY_EXPONENTS[code]).toBeDefined();
    expect(Object.keys(REGION_CURRENCY).length).toBeGreaterThan(240);
  });

  it('searches by code prefix or name word', () => {
    expect(matchesCurrency('CAD', 'Canadian dollar', 'ca')).toBe(true);
    expect(matchesCurrency('CAD', 'Canadian dollar', 'dollar')).toBe(true);
    expect(matchesCurrency('JPY', 'Japanese yen', 'dollar')).toBe(false);
  });
});
