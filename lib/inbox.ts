/**
 * Telegram inbound durable-inbox capability
 * Zones: pi agent host boundary, public interop, queue persistence
 * Owns the narrow host-provided inbox capability and reconciles the in-memory
 * prompt queue against it, without exposing or altering the queue engine.
 */

import {
  isPendingTelegramTurn,
  type PendingTelegramTurn,
  type TelegramQueueItem,
  type TelegramQueueStateStore,
} from "./queue.ts";
import {
  getTelegramHostHouseholdGroup,
  isTelegramHostPromptPreparationInFlight,
} from "./host.ts";

/** A durably stored prompt turn, keyed by its stable identity. */
export interface TelegramInboundInboxRecord {
  id: string;
  payload: string;
}

/**
 * Host-provided durable store for accepted-but-not-yet-dispatched prompt turns
 * (see the host's ADR-0003). pi-telegram only records, removes, and reads; the
 * host owns the database and its lifecycle.
 */
export interface TelegramInboundInbox {
  persist(id: string, payload: string, now: number): void;
  remove(id: string): void;
  loadPending(): TelegramInboundInboxRecord[];
}

interface TelegramInboundInboxRegistry {
  readonly version: 1;
  inbox?: TelegramInboundInbox;
  token?: object;
}

const TELEGRAM_INBOX_REGISTRY_KEY = Symbol.for(
  "pi-telegram.inbound-inbox-registry",
);

function isTelegramInboundInboxRegistry(
  value: unknown,
): value is TelegramInboundInboxRegistry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const inbox = candidate.inbox;
  const token = candidate.token;
  if (candidate.version !== 1) return false;
  if (inbox !== undefined && typeof inbox !== "object") return false;
  if (token !== undefined && (!token || typeof token !== "object")) {
    return false;
  }
  return (inbox === undefined) === (token === undefined);
}

function getTelegramInboundInboxRegistry(): TelegramInboundInboxRegistry {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  const existing = globalStore[TELEGRAM_INBOX_REGISTRY_KEY];
  if (existing !== undefined) {
    if (!isTelegramInboundInboxRegistry(existing)) {
      throw new Error(
        "Telegram inbound inbox registry is occupied by a malformed or incompatible v1 registry.",
      );
    }
    return existing;
  }
  const registry: TelegramInboundInboxRegistry = { version: 1 };
  globalStore[TELEGRAM_INBOX_REGISTRY_KEY] = registry;
  return registry;
}

/**
 * Installs the host's durable inbox. Returns an unregister callback guarded by
 * an identity token so a later owner's teardown cannot clear a newer inbox.
 */
export function registerTelegramInboundInbox(
  inbox: TelegramInboundInbox,
): () => void {
  if (!inbox || typeof inbox !== "object") {
    throw new TypeError("Telegram inbound inbox must be an object");
  }
  const registry = getTelegramInboundInboxRegistry();
  if (registry.inbox) {
    throw new Error("Telegram inbound inbox is already registered");
  }
  const token = {};
  registry.inbox = inbox;
  registry.token = token;
  return () => {
    if (registry.token !== token) return;
    delete registry.inbox;
    delete registry.token;
  };
}

export function getTelegramInboundInbox(): TelegramInboundInbox | undefined {
  return getTelegramInboundInboxRegistry().inbox;
}

/**
 * Stable identity for a prompt turn: the chat plus its lowest source message
 * id. Deterministic across persist, reconcile, and Telegram redelivery, so the
 * inbox stays idempotent without threading update ids through routing.
 */
export function telegramInboundTurnKey(turn: PendingTelegramTurn): string {
  const messageId = turn.sourceMessageIds.length
    ? Math.min(...turn.sourceMessageIds)
    : turn.replyToMessageId;
  return `${turn.chatId}:${messageId}`;
}

export function serializeTelegramInboundTurn(turn: PendingTelegramTurn): string {
  return JSON.stringify(turn);
}

/**
 * Parses a stored payload back into a prompt turn, returning undefined for a
 * corrupt or non-prompt row so replay skips it rather than crashing startup.
 */
export function deserializeTelegramInboundTurn(
  payload: string,
): PendingTelegramTurn | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const candidate = parsed as Partial<PendingTelegramTurn>;
  if (candidate.kind !== "prompt") return undefined;
  if (typeof candidate.chatId !== "number") return undefined;
  if (!Array.isArray(candidate.sourceMessageIds)) return undefined;
  if (!Array.isArray(candidate.content)) return undefined;
  return parsed as PendingTelegramTurn;
}

/**
 * Reconciles the durable inbox to contain exactly the prompt turns currently
 * queued. Called after every queue mutation, so a newly queued turn is
 * persisted before Telegram advances its offset and a dispatched turn (no
 * longer queued, now owned by Pi's session) is dropped.
 */
export function reconcileTelegramInboundInbox<TContext>(
  inbox: TelegramInboundInbox,
  items: readonly TelegramQueueItem<TContext>[],
  now: number,
): void {
  const liveKeys = new Set<string>();
  for (const item of items) {
    if (!isPendingTelegramTurn(item)) continue;
    const key = telegramInboundTurnKey(item);
    liveKeys.add(key);
    inbox.persist(key, serializeTelegramInboundTurn(item), now);
  }
  for (const record of inbox.loadPending()) {
    if (!liveKeys.has(record.id)) inbox.remove(record.id);
  }
}

/**
 * Wraps a queue store so every mutation reconciles the durable inbox resolved
 * lazily via `getInbox`. Lazy resolution lets the host register its inbox
 * before or after this store is created. When no inbox is registered the store
 * behaves exactly as the unwrapped original.
 */
export function withTelegramInboundInboxPersistence<TContext>(
  store: TelegramQueueStateStore<TContext>,
  getInbox: () => TelegramInboundInbox | undefined = getTelegramInboundInbox,
  now: () => number = Date.now,
): TelegramQueueStateStore<TContext> {
  return {
    getQueuedItems: store.getQueuedItems,
    hasQueuedItems: store.hasQueuedItems,
    setQueuedItems: (items) => {
      store.setQueuedItems(items);
      const inbox = getInbox();
      if (!inbox) return;
      // A host preparation may replace the Pi session. The old extension's
      // shutdown clears its local queue while that replacement is awaited;
      // retain the durable turn so the fresh extension can replay it.
      if (items.length === 0 && isTelegramHostPromptPreparationInFlight()) return;
      reconcileTelegramInboundInbox(inbox, items, now());
    },
  };
}

/**
 * Loads and deserializes the pending prompt turns to replay on process start.
 * Corrupt rows are skipped.
 */
export function loadTelegramInboundInboxTurns(
  inbox: TelegramInboundInbox,
): PendingTelegramTurn[] {
  const turns: PendingTelegramTurn[] = [];
  for (const record of inbox.loadPending()) {
    const turn = deserializeTelegramInboundTurn(record.payload);
    if (turn) turns.push(turn);
  }
  return turns;
}

/**
 * Seeds the queue with any pending turns left durable by a previous process.
 * Returns the number of turns replayed so the caller can trigger a reorder.
 * Existing queued items are preserved and the turns keep their original lane
 * ordering fields, so replay slots them back into place.
 */
export function replayTelegramInboundInbox<TContext>(
  store: TelegramQueueStateStore<TContext>,
  inbox: TelegramInboundInbox | undefined,
  authorize: (turn: PendingTelegramTurn) => boolean = (turn) => {
    const policy = getTelegramHostHouseholdGroup();
    if (!policy) return true;
    if (turn.chatId !== policy.chatId || turn.target?.chatId !== policy.chatId) {
      return false;
    }
    return policy.actors.some(
      (actor) =>
        actor.userId === turn.actorUserId && actor.label === turn.actorLabel,
    );
  },
): number {
  if (!inbox) return 0;
  const existingKeys = new Set(
    store.getQueuedItems().flatMap((item) =>
      isPendingTelegramTurn(item) ? [telegramInboundTurnKey(item)] : [],
    ),
  );
  const turns = loadTelegramInboundInboxTurns(inbox).filter((turn) => {
    if (!authorize(turn)) return false;
    const key = telegramInboundTurnKey(turn);
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
  if (!turns.length) return 0;
  store.setQueuedItems([...store.getQueuedItems(), ...turns]);
  return turns.length;
}
