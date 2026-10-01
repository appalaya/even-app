import { afterEach, describe, expect, it } from 'vitest';

import { openTestStore, STORE_KINDS, type TestStore } from '../services/testing/testStore';
import { isStateError } from './errors';
import {
  contextualAskDue,
  notificationStatusOf,
  PrefsService,
  promptWentUnanswered,
  UNANSWERED_PROMPT_LIMIT,
  type NotificationPermission,
  type NotificationStatus,
  type PermissionReading,
} from './prefs';

const opened: TestStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((s) => s.close()));
});

describe.each(STORE_KINDS)('prefs on the %s store', (kind) => {
  async function service(status: NotificationStatus | null = 'undetermined') {
    const store = await openTestStore(kind);
    opened.push(store);
    let current = status ?? 'unavailable';
    // iOS's shape: the prompt cannot be closed without an answer.
    const reading = (): PermissionReading => ({
      granted: current === 'granted',
      status: current,
      canAskAgain: current !== 'denied',
    });
    const prefs = new PrefsService(
      store,
      status === null
        ? null
        : {
            dismissible: false,
            status: async () => reading(),
            request: async () => {
              current = 'granted';
              return reading();
            },
          },
    );
    return { store, prefs };
  }

  it('defaults, validated setters, and a snapshot that notifies', async () => {
    const { store, prefs } = await service();
    expect(prefs.peek()).toBeNull();
    let notified = 0;
    prefs.subscribe(() => {
      notified += 1;
    });
    expect(await prefs.load()).toEqual({
      name: null,
      emoji: null,
      appearance: 'system',
      notifications: 'undetermined',
    });
    await prefs.setName('  Maya ');
    await prefs.setEmoji('🦊');
    await prefs.setAppearance('dark');
    expect(prefs.peek()).toEqual({
      name: 'Maya',
      emoji: '🦊',
      appearance: 'dark',
      notifications: 'undetermined',
    });
    expect(notified).toBeGreaterThanOrEqual(4);
    expect(await store.getPref('me.name')).toBe('Maya');

    for (const bad of [
      () => prefs.setName(''),
      () => prefs.setEmoji('no'),
      () => prefs.setAppearance('sepia' as 'dark'),
    ]) {
      let thrown: unknown;
      try {
        await bad();
      } catch (error) {
        thrown = error;
      }
      expect(isStateError(thrown, 'invalid')).toBe(true);
    }
    await prefs.setEmoji(null);
    expect(prefs.peek()?.emoji).toBeNull();
  });

  it('notifications follow the OS permission and are requested only when asked', async () => {
    const { prefs } = await service('undetermined');
    expect((await prefs.load()).notifications).toBe('undetermined');
    expect(await prefs.requestNotifications()).toBe('granted');
    expect(prefs.peek()?.notifications).toBe('granted');
    const { prefs: none } = await service(null);
    expect((await none.load()).notifications).toBe('unavailable');
    expect(await none.requestNotifications()).toBe('unavailable');
  });

  it('seeds the default name once and never overrides a chosen one', async () => {
    const { prefs } = await service();
    await prefs.seedMe('Maya', '🦊');
    await prefs.seedMe('Other', '🐻');
    expect(await prefs.load()).toMatchObject({ name: 'Maya', emoji: '🦊' });
  });

  it('claims the contextual notification ask exactly once per install', async () => {
    const { store, prefs } = await service();
    expect(await store.getPref('notifications.asked')).toBeNull();
    expect(await prefs.claimNotificationAsk()).toBe(true);
    expect(await store.getPref('notifications.asked')).toBe('1');
    expect(await prefs.claimNotificationAsk()).toBe(false);
    expect(await new PrefsService(store).claimNotificationAsk()).toBe(false);
  });
});

type Answer = 'allow' | "don't allow" | 'close';

/**
 * Android 13 and later, as expo-notifications reports it: the OS's record (no decision, refused once, refused for
 * good, granted), and expo's own `asked` and `blocked` flags (expo-modules-core PermissionsService: `asked` is set
 * before the prompt shows; `blocked` is "denied with no rationale to show" after each request). Not granted reads
 * `denied` (NotificationPermissionsModule: notifications are off). Each prompt the OS shows takes the next answer.
 */
function android13(answers: Answer[]) {
  const os = {
    decision: 'none' as 'none' | 'refused once' | 'refused' | 'granted',
    asked: false,
    blocked: false,
    prompts: 0,
    requests: 0,
  };
  const reading = (): PermissionReading =>
    os.decision === 'granted'
      ? { granted: true, status: 'granted', canAskAgain: true }
      : { granted: false, status: 'denied', canAskAgain: !(os.asked && os.blocked) };
  const permission: NotificationPermission = {
    dismissible: true,
    status: async () => reading(),
    request: async () => {
      os.requests += 1;
      os.asked = true;
      if (os.decision === 'none' || os.decision === 'refused once') {
        os.prompts += 1;
        const answer = answers.shift() ?? 'close';
        if (answer === 'allow') os.decision = 'granted';
        if (answer === "don't allow") {
          os.decision = os.decision === 'none' ? 'refused once' : 'refused';
        }
        // 'close' (Back, or a tap outside): Android records nothing.
      }
      // Android's rationale flag is on only after a single refusal.
      os.blocked = os.decision !== 'granted' && os.decision !== 'refused once';
      return reading();
    },
  };
  return { os, permission };
}

describe.each(STORE_KINDS)('notification asks on Android 13 and later, on the %s store', (kind) => {
  async function android(answers: Answer[]) {
    const store = await openTestStore(kind);
    opened.push(store);
    const { os, permission } = android13(answers);
    return { store, os, prefs: new PrefsService(store, permission) };
  }

  it('asks again after a prompt closed with no answer, up to the limit', async () => {
    const { store, os, prefs } = await android(['close', 'close']);
    // The prompt closed with Back: expo reads "denied, can't ask again", but the OS has no answer on record.
    expect(await prefs.askForNotificationsInContext()).toBe('undetermined');
    expect(os.prompts).toBe(1);
    expect(await store.getPref('notifications.unanswered')).toBe('1');
    // The switch reads off and askable (it shows the prompt rather than opening Settings).
    expect((await prefs.load()).notifications).toBe('undetermined');

    // The next group open asks again.
    expect(await prefs.askForNotificationsInContext()).toBe('denied');
    expect(os.prompts).toBe(2);
    // Closed twice: no more asks, and the switch opens Settings.
    expect(await prefs.askForNotificationsInContext()).toBeNull();
    expect(os.prompts).toBe(2);
    expect((await prefs.load()).notifications).toBe('denied');
  });

  it('the switch shows the prompt again after it closed with no answer', async () => {
    const { store, os, prefs } = await android(['close', 'allow']);
    expect(await prefs.askForNotificationsInContext()).toBe('undetermined');
    expect(await prefs.requestNotifications()).toBe('granted');
    expect(os.prompts).toBe(2);
    expect(await store.getPref('notifications.unanswered')).toBeNull();
    expect(await prefs.askForNotificationsInContext()).toBeNull();
  });

  it('never asks again in context after an answer, even a first "Don\'t allow"', async () => {
    const { os, prefs } = await android(["don't allow"]);
    // Refused once: the OS can still show its prompt, so the switch can ask (as before).
    expect(await prefs.askForNotificationsInContext()).toBe('undetermined');
    expect(await prefs.askForNotificationsInContext()).toBeNull();
    expect(os.prompts).toBe(1);

    const { os: granted, prefs: allowed } = await android(['allow']);
    expect(await allowed.askForNotificationsInContext()).toBe('granted');
    expect(await allowed.askForNotificationsInContext()).toBeNull();
    expect(granted.prompts).toBe(1);
  });

  it('an answer through the switch counts: the group screen does not ask after it', async () => {
    const { os, prefs } = await android(["don't allow"]);
    expect(await prefs.requestNotifications()).toBe('undetermined');
    expect(await prefs.askForNotificationsInContext()).toBeNull();
    expect(os.prompts).toBe(1);
  });

  it('a refusal for good, read as no answer, costs one request that shows nothing', async () => {
    const { os, prefs } = await android(["don't allow", "don't allow"]);
    expect(await prefs.requestNotifications()).toBe('undetermined');
    // The second refusal is final, but expo reads it like a closed prompt.
    expect(await prefs.requestNotifications()).toBe('undetermined');
    expect(os.decision).toBe('refused');
    // The group screen asks once more; the OS shows nothing and the app stops asking.
    expect(await prefs.askForNotificationsInContext()).toBe('denied');
    expect(os.requests).toBe(3);
    expect(os.prompts).toBe(2);
    expect(await prefs.askForNotificationsInContext()).toBeNull();
    expect((await prefs.load()).notifications).toBe('denied');
  });
});

describe('promptWentUnanswered', () => {
  const closed = { granted: false, status: 'denied', canAskAgain: false };
  it("reads Android's denied-and-can't-ask-again right after a prompt as no answer", () => {
    expect(promptWentUnanswered(closed, true)).toBe(true);
  });
  it('reads a first refusal, a grant, and anything on iOS as an answer', () => {
    expect(
      promptWentUnanswered({ granted: false, status: 'denied', canAskAgain: true }, true),
    ).toBe(false);
    expect(
      promptWentUnanswered({ granted: true, status: 'granted', canAskAgain: true }, true),
    ).toBe(false);
    expect(promptWentUnanswered(closed, false)).toBe(false);
  });
});

describe('contextualAskDue', () => {
  it('asks the first time, and again only while the last prompts closed with no answer', () => {
    expect(contextualAskDue(false, 0)).toBe(true);
    expect(contextualAskDue(true, 0)).toBe(false);
    expect(contextualAskDue(true, 1)).toBe(true);
    expect(contextualAskDue(true, UNANSWERED_PROMPT_LIMIT)).toBe(false);
  });
});

describe('notificationStatusOf', () => {
  it('reads a permission the OS can still ask for as undetermined, on either platform', () => {
    // iOS, never asked.
    expect(
      notificationStatusOf({ granted: false, status: 'undetermined', canAskAgain: true }),
    ).toBe('undetermined');
    // Android 13+, never asked or refused once: denied, but the prompt can still show.
    expect(notificationStatusOf({ granted: false, status: 'denied', canAskAgain: true })).toBe(
      'undetermined',
    );
  });

  it('reads a refusal the OS will not ask about again as denied, and a grant as granted', () => {
    expect(notificationStatusOf({ granted: false, status: 'denied', canAskAgain: false })).toBe(
      'denied',
    );
    expect(notificationStatusOf({ granted: true, status: 'granted', canAskAgain: true })).toBe(
      'granted',
    );
  });

  it("reads denied-and-can't-ask-again as undetermined while prompts closed with no answer are below the limit", () => {
    const closed = { granted: false, status: 'denied', canAskAgain: false };
    expect(notificationStatusOf(closed, 1)).toBe('undetermined');
    expect(notificationStatusOf(closed, UNANSWERED_PROMPT_LIMIT)).toBe('denied');
    expect(notificationStatusOf({ granted: true, status: 'granted', canAskAgain: true }, 1)).toBe(
      'granted',
    );
  });
});
