import { afterEach, describe, expect, it } from 'vitest';

import { openTestStore, STORE_KINDS, type TestStore } from '../services/testing/testStore';
import { isStateError } from './errors';
import { PrefsService, type NotificationStatus } from './prefs';

const opened: TestStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((s) => s.close()));
});

describe.each(STORE_KINDS)('prefs on the %s store', (kind) => {
  async function service(status: NotificationStatus | null = 'undetermined') {
    const store = await openTestStore(kind);
    opened.push(store);
    let current = status ?? 'unavailable';
    const prefs = new PrefsService(
      store,
      status === null
        ? null
        : {
            status: async () => current,
            request: async () => {
              current = 'granted';
              return current;
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
