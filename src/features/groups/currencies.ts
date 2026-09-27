/**
 * Currency choices for Create group: the default from the device's region (through `Intl`), display names, the
 * picker's order, and its search. ISO 4217 codes only, from core's `CURRENCY_EXPONENTS` (the codes the validator
 * accepts). Pure; `Intl` is injected where a test needs to vary it.
 */
import { CURRENCY_EXPONENTS, isCurrency } from '@even/core';

import { CURRENCY_NAMES_EN } from './currencyNames';

/**
 * Region (ISO 3166-1 alpha-2) → the currency people there split a dinner in (ISO 4217). `Intl` exposes the device
 * locale's region but no region → currency table, so this is it. A region missing here falls back to USD.
 */
export const REGION_CURRENCY: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    (
      'AD:EUR AE:AED AF:AFN AG:XCD AI:XCD AL:ALL AM:AMD AO:AOA AR:ARS AS:USD AT:EUR AU:AUD AW:AWG AX:EUR AZ:AZN ' +
      'BA:BAM BB:BBD BD:BDT BE:EUR BF:XOF BG:BGN BH:BHD BI:BIF BJ:XOF BL:EUR BM:BMD BN:BND BO:BOB BQ:USD BR:BRL ' +
      'BS:BSD BT:BTN BW:BWP BY:BYN BZ:BZD CA:CAD CC:AUD CD:CDF CF:XAF CG:XAF CH:CHF CI:XOF CK:NZD CL:CLP CM:XAF ' +
      'CN:CNY CO:COP CR:CRC CU:CUP CV:CVE CW:XCG CX:AUD CY:EUR CZ:CZK DE:EUR DJ:DJF DK:DKK DM:XCD DO:DOP DZ:DZD ' +
      'EC:USD EE:EUR EG:EGP EH:MAD ER:ERN ES:EUR ET:ETB FI:EUR FJ:FJD FK:FKP FM:USD FO:DKK FR:EUR GA:XAF GB:GBP ' +
      'GD:XCD GE:GEL GF:EUR GG:GBP GH:GHS GI:GIP GL:DKK GM:GMD GN:GNF GP:EUR GQ:XAF GR:EUR GT:GTQ GU:USD GW:XOF ' +
      'GY:GYD HK:HKD HN:HNL HR:EUR HT:HTG HU:HUF ID:IDR IE:EUR IL:ILS IM:GBP IN:INR IO:USD IQ:IQD IR:IRR IS:ISK ' +
      'IT:EUR JE:GBP JM:JMD JO:JOD JP:JPY KE:KES KG:KGS KH:KHR KI:AUD KM:KMF KN:XCD KP:KPW KR:KRW KW:KWD KY:KYD ' +
      'KZ:KZT LA:LAK LB:LBP LC:XCD LI:CHF LK:LKR LR:LRD LS:LSL LT:EUR LU:EUR LV:EUR LY:LYD MA:MAD MC:EUR MD:MDL ' +
      'ME:EUR MF:EUR MG:MGA MH:USD MK:MKD ML:XOF MM:MMK MN:MNT MO:MOP MP:USD MQ:EUR MR:MRU MS:XCD MT:EUR MU:MUR ' +
      'MV:MVR MW:MWK MX:MXN MY:MYR MZ:MZN NA:NAD NC:XPF NE:XOF NF:AUD NG:NGN NI:NIO NL:EUR NO:NOK NP:NPR NR:AUD ' +
      'NU:NZD NZ:NZD OM:OMR PA:PAB PE:PEN PF:XPF PG:PGK PH:PHP PK:PKR PL:PLN PM:EUR PN:NZD PR:USD PS:ILS PT:EUR ' +
      'PW:USD PY:PYG QA:QAR RE:EUR RO:RON RS:RSD RU:RUB RW:RWF SA:SAR SB:SBD SC:SCR SD:SDG SE:SEK SG:SGD SH:SHP ' +
      'SI:EUR SJ:NOK SK:EUR SL:SLE SM:EUR SN:XOF SO:SOS SR:SRD SS:SSP ST:STN SV:USD SX:XCG SY:SYP SZ:SZL TC:USD ' +
      'TD:XAF TG:XOF TH:THB TJ:TJS TK:NZD TL:USD TM:TMT TN:TND TO:TOP TR:TRY TT:TTD TV:AUD TW:TWD TZ:TZS UA:UAH ' +
      'UG:UGX UM:USD US:USD UY:UYU UZ:UZS VA:EUR VC:XCD VE:VES VG:USD VI:USD VN:VND VU:VUV WF:XPF WS:WST XK:EUR ' +
      'YE:YER YT:EUR ZA:ZAR ZM:ZMW ZW:ZWG'
    )
      .split(' ')
      .map((pair) => pair.split(':') as [string, string]),
  ),
);

const FALLBACK = 'USD';

/**
 * The picker's "Common" section after the device's own currency, in the order the currency picker board draws it
 * (Groups, create and join, extra states: CAD, then USD, EUR, GBP, JPY, AUD, MXN, INR).
 */
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'MXN', 'INR'] as const;

/** The region in a BCP 47 tag ("en-CA" → "CA", "zh-Hant-TW" → "TW"), or null. */
export function regionOf(locale: string): string | null {
  const match = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?-([A-Z]{2})(?:-|$)/i.exec(locale);
  return match?.[1]?.toUpperCase() ?? null;
}

/** The device locale as `Intl` resolves it ("en-CA"). */
export function deviceLocale(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en-US';
  }
}

/** The currency for a locale's region; USD when the locale carries no region or an unknown one. */
export function defaultCurrency(locale: string = deviceLocale()): string {
  const region = regionOf(locale);
  const code = region === null ? undefined : REGION_CURRENCY[region];
  return code !== undefined && isCurrency(code) ? code : FALLBACK;
}

/**
 * The currency's name in the locale, sentence case, singular: "Canadian dollar", "Euro", "US dollar" (the board's
 * "Canadian dollar · CAD"). From `Intl.NumberFormat`'s unit name for one; Hermes has none, so the English table
 * (CLDR's names) stands in, and the code itself for a code outside it.
 */
export function currencyName(code: string, locale?: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'name',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).formatToParts(1);
    const name = parts.find((part) => part.type === 'currency')?.value.trim();
    if (name !== undefined && name !== '' && name.toUpperCase() !== code) {
      return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
    }
  } catch {
    // An engine without currency names: fall through to the table.
  }
  return CURRENCY_NAMES_EN[code] ?? code;
}

/**
 * The picker's two sections: "Common" (the device's currency, then the common ones) and "All currencies" (every other
 * accepted code, A–Z). Every code appears once.
 */
export function currencySections(first?: string): { common: string[]; all: string[] } {
  const common = [
    ...(first !== undefined && isCurrency(first) ? [first] : []),
    ...COMMON_CURRENCIES.filter((code) => code !== first),
  ];
  const seen = new Set<string>(common);
  const all = Object.keys(CURRENCY_EXPONENTS)
    .sort()
    .filter((code) => !seen.has(code));
  return { common, all };
}

/** Picker search: a code prefix ("ca" → CAD) or any word of the name ("dollar", "yen"), case-insensitive. */
export function matchesCurrency(code: string, name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (code.toLowerCase().startsWith(q)) return true;
  return name
    .toLowerCase()
    .split(/[\s-]+/u)
    .some((word) => word.startsWith(q));
}
