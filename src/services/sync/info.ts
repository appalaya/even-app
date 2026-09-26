/**
 * `/v1/info` cache: fetched once per canonical server URL per process, refreshed on `invalid_request`
 * (PROTOCOL.md §6.1). Shared by the engine and group settings (server name, limits, usage meter).
 */
import type { ServerInfo, Transport } from './types';

export interface InfoCache {
  /** The cached info for `serverUrl`, fetching it on first use. Concurrent callers share one request. */
  get(serverUrl: string, transport: Transport): Promise<ServerInfo>;
  /** Fetches again and replaces the cached value (kept if the fetch fails). */
  refresh(serverUrl: string, transport: Transport): Promise<ServerInfo>;
  /** The cached value, without fetching. */
  peek(serverUrl: string): ServerInfo | undefined;
}

export function createInfoCache(): InfoCache {
  const values = new Map<string, ServerInfo>();
  const pending = new Map<string, Promise<ServerInfo>>();

  function fetchInfo(serverUrl: string, transport: Transport): Promise<ServerInfo> {
    const inFlight = pending.get(serverUrl);
    if (inFlight !== undefined) return inFlight;
    const request = transport
      .info()
      .then((info) => {
        values.set(serverUrl, info);
        return info;
      })
      .finally(() => pending.delete(serverUrl));
    pending.set(serverUrl, request);
    return request;
  }

  return {
    get(serverUrl, transport) {
      const cached = values.get(serverUrl);
      return cached !== undefined ? Promise.resolve(cached) : fetchInfo(serverUrl, transport);
    },
    refresh: fetchInfo,
    peek: (serverUrl) => values.get(serverUrl),
  };
}
