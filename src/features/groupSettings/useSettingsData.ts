/**
 * The two things Group settings reads beside the derived group: the invite (code, link, share gating) and the
 * server report (the `/v1/info` cache's operator, limits and retention, plus the usage meter). Both come from
 * GroupService and are read again whenever what they depend on changes.
 */
import { useEffect, useState } from 'react';

import { useApp, type DerivedGroup, type InviteInfo, type UsageReport } from '../../state';

export function useInvite(localId: string, derived: DerivedGroup | null): InviteInfo | null {
  const { groups } = useApp();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const key =
    derived === null
      ? null
      : `${derived.row.serverUrl}|${derived.inviteReady}|${derived.name}|${derived.readOnly}`;
  useEffect(() => {
    if (key === null) return;
    let live = true;
    groups.inviteFor(localId).then(
      (value) => {
        if (live) setInvite(value);
      },
      () => {
        if (live) setInvite(null);
      },
    );
    return () => {
      live = false;
    };
  }, [groups, localId, key]);
  return invite;
}

function eventTotal(derived: DerivedGroup): number {
  return Object.values(derived.counts.byStatus).reduce((sum, n) => sum + n, 0);
}

/** `undefined` while loading, `null` when the server's info is not known (never reached, offline). */
export function useServerReport(
  localId: string,
  derived: DerivedGroup | null,
): UsageReport | null | undefined {
  const { groups } = useApp();
  const [report, setReport] = useState<UsageReport | null | undefined>(undefined);
  const key = derived === null ? null : `${derived.row.serverUrl}|${eventTotal(derived)}`;
  useEffect(() => {
    if (key === null) return;
    let live = true;
    groups.usage(localId).then(
      (value) => {
        if (live) setReport(value);
      },
      () => {
        if (live) setReport(null);
      },
    );
    return () => {
      live = false;
    };
  }, [groups, localId, key]);
  return report;
}
