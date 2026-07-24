/**
 * Telegram inbound durable-inbox regressions
 * Zones: public API, host interop, queue persistence
 * Covers the registry, turn identity, reconcile/replay, and store wrapping
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  deserializeTelegramInboundTurn,
  getTelegramInboundInbox,
  loadTelegramInboundInboxTurns,
  reconcileTelegramInboundInbox,
  registerTelegramInboundInbox,
  replayTelegramInboundInbox,
  serializeTelegramInboundTurn,
  telegramInboundTurnKey,
  withTelegramInboundInboxPersistence,
  type TelegramInboundInbox,
} from "../lib/inbox.ts";
import {
  prepareTelegramHostPrompt,
  registerTelegramHostHouseholdGroup,
  registerTelegramHostPromptPreparation,
} from "../lib/host.ts";
import {
  createTelegramQueueStore,
  type PendingTelegramTurn,
  type TelegramQueueItem,
} from "../lib/queue.ts";

const REGISTRY_KEY = Symbol.for("pi-telegram.inbound-inbox-registry");

function clearInboxRegistry(): void {
  delete (globalThis as Record<PropertyKey, unknown>)[REGISTRY_KEY];
}

function createFakeInbox(): TelegramInboundInbox & { size(): number } {
  const rows = new Map<string, { payload: string; now: number }>();
  return {
    persist(id, payload, now) {
      if (!rows.has(id)) rows.set(id, { payload, now });
    },
    remove(id) {
      rows.delete(id);
    },
    loadPending() {
      return [...rows.entries()]
        .sort((a, b) => a[1].now - b[1].now)
        .map(([id, value]) => ({ id, payload: value.payload }));
    },
    size: () => rows.size,
  };
}

function makeTurn(
  chatId: number,
  sourceMessageIds: number[],
  text: string,
): PendingTelegramTurn {
  return {
    kind: "prompt",
    chatId,
    replyToMessageId: sourceMessageIds[0] ?? 0,
    queueOrder: 0,
    queueLane: "default",
    laneOrder: 0,
    statusSummary: text,
    sourceMessageIds,
    queuedAttachments: [],
    content: [{ type: "text", text }],
    historyText: text,
  };
}

test("inbox registration rejects competing inboxes and guards disposal", () => {
  clearInboxRegistry();
  const first = createFakeInbox();
  const second = createFakeInbox();
  const disposeFirst = registerTelegramInboundInbox(first);
  assert.equal(getTelegramInboundInbox(), first);
  assert.throws(
    () => registerTelegramInboundInbox(second),
    /already registered/,
  );
  disposeFirst();
  const disposeSecond = registerTelegramInboundInbox(second);
  assert.equal(getTelegramInboundInbox(), second);
  // A stale disposer must not evict the replacement.
  disposeFirst();
  assert.equal(getTelegramInboundInbox(), second);
  disposeSecond();
  assert.equal(getTelegramInboundInbox(), undefined);
  clearInboxRegistry();
});

test("turn key is chat plus lowest source message id", () => {
  assert.equal(telegramInboundTurnKey(makeTurn(7, [30, 10, 20], "hi")), "7:10");
  assert.equal(telegramInboundTurnKey(makeTurn(-100, [], "hi")), "-100:0");
});

test("serialize/deserialize round-trips a prompt turn and rejects junk", () => {
  const turn = makeTurn(7, [10], "hello");
  const restored = deserializeTelegramInboundTurn(
    serializeTelegramInboundTurn(turn),
  );
  assert.deepEqual(restored, turn);
  assert.equal(deserializeTelegramInboundTurn("not json"), undefined);
  assert.equal(deserializeTelegramInboundTurn("{}"), undefined);
  assert.equal(
    deserializeTelegramInboundTurn(JSON.stringify({ kind: "control" })),
    undefined,
  );
});

test("reconcile persists queued prompts and drops dispatched ones", () => {
  const inbox = createFakeInbox();
  const a = makeTurn(7, [10], "a");
  const b = makeTurn(7, [20], "b");

  reconcileTelegramInboundInbox(inbox, [a, b], 1);
  assert.deepEqual(
    inbox.loadPending().map((r) => r.id),
    ["7:10", "7:20"],
  );

  // b dispatched (left the queue) → only a remains durable.
  reconcileTelegramInboundInbox(inbox, [a], 2);
  assert.deepEqual(
    inbox.loadPending().map((r) => r.id),
    ["7:10"],
  );

  // queue drains → inbox empties.
  reconcileTelegramInboundInbox(inbox, [], 3);
  assert.equal(inbox.size(), 0);
});

test("reconcile ignores control items", () => {
  const inbox = createFakeInbox();
  const control: TelegramQueueItem = {
    kind: "control",
    controlType: "status",
    chatId: 7,
    replyToMessageId: 1,
    queueOrder: 0,
    queueLane: "control",
    laneOrder: 0,
    statusSummary: "status",
    execute: async () => {},
  };
  reconcileTelegramInboundInbox(inbox, [control], 1);
  assert.equal(inbox.size(), 0);
});

test("wrapped store reconciles the inbox on every mutation", () => {
  const inbox = createFakeInbox();
  let clock = 0;
  const store = withTelegramInboundInboxPersistence(
    createTelegramQueueStore(),
    () => inbox,
    () => ++clock,
  );

  const a = makeTurn(7, [10], "a");
  store.setQueuedItems([a]);
  assert.equal(inbox.size(), 1);
  assert.equal(store.hasQueuedItems(), true);

  store.setQueuedItems([]);
  assert.equal(inbox.size(), 0);
});

test("wrapped store retains a triggering turn while host preparation replaces the session", async () => {
  const inbox = createFakeInbox();
  const store = withTelegramInboundInboxPersistence(
    createTelegramQueueStore(),
    () => inbox,
  );
  store.setQueuedItems([makeTurn(7, [10], "rotate me")]);
  let finish!: () => void;
  const replacement = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const dispose = registerTelegramHostPromptPreparation(async () => {
    await replacement;
    return { sessionReplaced: true };
  });
  try {
    const preparing = prepareTelegramHostPrompt();
    store.setQueuedItems([]);
    assert.equal(inbox.size(), 1);
    finish();
    await preparing;
  } finally {
    dispose();
  }
});

test("wrapped store is a passthrough when no inbox is registered", () => {
  const store = withTelegramInboundInboxPersistence(
    createTelegramQueueStore(),
    () => undefined,
  );
  const a = makeTurn(7, [10], "a");
  store.setQueuedItems([a]);
  assert.deepEqual(store.getQueuedItems(), [a]);
});

test("replay seeds pending turns and returns the count", () => {
  const inbox = createFakeInbox();
  const store = createTelegramQueueStore();
  reconcileTelegramInboundInbox(inbox, [makeTurn(7, [20], "b")], 2);
  reconcileTelegramInboundInbox(
    inbox,
    [makeTurn(7, [20], "b"), makeTurn(7, [10], "a")],
    1,
  );

  const turns = loadTelegramInboundInboxTurns(inbox);
  assert.equal(turns.length, 2);

  const replayed = replayTelegramInboundInbox(store, inbox);
  assert.equal(replayed, 2);
  assert.equal(store.getQueuedItems().length, 2);

  // No inbox → nothing replayed.
  assert.equal(replayTelegramInboundInbox(createTelegramQueueStore(), undefined), 0);
});

test("replay is idempotent when the same durable turn is already queued", () => {
  const inbox = createFakeInbox();
  const existing = makeTurn(7, [10], "already admitted");
  reconcileTelegramInboundInbox(inbox, [existing], 1);
  const store = createTelegramQueueStore([existing]);

  assert.equal(replayTelegramInboundInbox(store, inbox), 0);
  assert.deepEqual(store.getQueuedItems(), [existing]);
});

test("replay can re-authorize durable household turns before queue admission", () => {
  const inbox = createFakeInbox();
  const store = createTelegramQueueStore();
  const authorized = {
    ...makeTurn(-100123, [10], "[telegram|actor:Isaac] hello"),
    target: { chatId: -100123 },
    actorLabel: "Isaac",
    actorUserId: 101,
  };
  const foreign = {
    ...makeTurn(-100999, [20], "[telegram|actor:Isaac] wrong group"),
    target: { chatId: -100999 },
    actorLabel: "Isaac",
    actorUserId: 101,
  };
  reconcileTelegramInboundInbox(inbox, [authorized, foreign], 1);

  const dispose = registerTelegramHostHouseholdGroup({
    kind: "household-group",
    chatId: -100123,
    actors: [
      { userId: 101, label: "Isaac" },
      { userId: 202, label: "Emma" },
    ],
  });
  try {
    const replayed = replayTelegramInboundInbox(store, inbox);
    assert.equal(replayed, 1);
    assert.deepEqual(store.getQueuedItems(), [authorized]);
  } finally {
    dispose();
  }
});
