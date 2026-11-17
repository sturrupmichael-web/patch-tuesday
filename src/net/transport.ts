/**
 * Realtime transport. Production uses a Supabase Realtime broadcast channel per
 * room code. When Supabase env vars are missing (local dev / tests) it falls
 * back to the browser's BroadcastChannel, which connects tabs of the same
 * browser on the same origin. That is enough to run a host and several phone
 * tabs on one laptop.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

export type Handler = (payload: any) => void;

export interface Transport {
  readonly kind: 'supabase' | 'local';
  ready: Promise<void>;
  send(event: string, payload: unknown): void;
  on(event: string, cb: Handler): void;
  close(): void;
}

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

export function hasSupabase(): boolean {
  return !!(URL && KEY);
}

export function channelName(room: string): string {
  return `patch-tuesday:${room}`;
}

export function createTransport(room: string): Transport {
  return hasSupabase() ? supabaseTransport(room) : localTransport(room);
}

function supabaseTransport(room: string): Transport {
  client ??= createClient(URL!, KEY!, {
    realtime: { params: { eventsPerSecond: 30 } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const handlers = new Map<string, Handler[]>();
  const channel: RealtimeChannel = client.channel(channelName(room), {
    config: { broadcast: { self: false, ack: false } },
  });
  channel.on('broadcast', { event: '*' }, (msg: { event: string; payload: unknown }) => {
    handlers.get(msg.event)?.forEach((h) => h(msg.payload));
  });
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') resolveReady();
  });
  return {
    kind: 'supabase',
    ready,
    send(event, payload) {
      void channel.send({ type: 'broadcast', event, payload });
    },
    on(event, cb) {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
    },
    close() {
      void client!.removeChannel(channel);
    },
  };
}

function localTransport(room: string): Transport {
  const bc = new BroadcastChannel(channelName(room));
  const handlers = new Map<string, Handler[]>();
  bc.onmessage = (e: MessageEvent<{ event: string; payload: unknown }>) => {
    handlers.get(e.data.event)?.forEach((h) => h(e.data.payload));
  };
  return {
    kind: 'local',
    ready: Promise.resolve(),
    send(event, payload) {
      bc.postMessage({ event, payload });
    },
    on(event, cb) {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
    },
    close() {
      bc.close();
    },
  };
}
