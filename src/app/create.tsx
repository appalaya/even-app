/**
 * Create group, presented as a sheet over Groups (CreateGroup board). The form is `CreateGroupSheet`; this route
 * only presents it and, on Create, replaces itself with the new group (`/group/<localId>`).
 *
 * Development builds accept prefill parameters so the dev seed can reproduce the board: `name`, `currency`, `people`
 * (comma-separated), `me`, `emoji`, `picker=emoji|currency`, `advanced=1` and `scroll=end`.
 */
import { newId } from '@even/core';
import { useLocalSearchParams } from 'expo-router';

import { CreateGroupSheet, type CreateGroupPrefill } from '@/features/groups/CreateGroupSheet';
import { hrefs } from '@/features/groups/routes';
import { useRouteSheet } from '@/features/groups/useRouteSheet';

type Params = {
  name?: string;
  currency?: string;
  people?: string;
  me?: string;
  emoji?: string;
  picker?: string;
  scroll?: string;
  advanced?: string;
};

export default function CreateRoute() {
  const params = useLocalSearchParams<Params>();
  const { visible, close, leaveTo } = useRouteSheet();
  return (
    <CreateGroupSheet
      visible={visible}
      onCancel={close}
      onCreated={(localId) => leaveTo(hrefs.group(localId))}
      prefill={__DEV__ ? prefillFrom(params) : undefined}
    />
  );
}

function prefillFrom(params: Params): CreateGroupPrefill | undefined {
  const prefill: CreateGroupPrefill = {};
  if (params.name !== undefined) prefill.name = params.name;
  if (params.currency !== undefined) prefill.currency = params.currency;
  // `people=Maya:<memberId>,Jordan` (a name, and optionally the member id it will get).
  if (params.people !== undefined) {
    prefill.people = params.people
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const [name = '', id] = entry.split(':');
        return { name, id: id ?? newId() };
      });
  }
  if (params.me !== undefined) prefill.myName = params.me;
  if (params.emoji !== undefined) prefill.myEmoji = params.emoji;
  if (params.picker === 'emoji') prefill.openEmojiPicker = true;
  if (params.picker === 'currency') prefill.openCurrencyPicker = true;
  if (params.advanced === '1') prefill.advancedOpen = true;
  if (params.scroll === 'end') prefill.scrollToEnd = true;
  return Object.keys(prefill).length === 0 ? undefined : prefill;
}
