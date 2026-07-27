/**
 * Telegram same-thread session replacement regressions
 * Zones: telegram controls, polling handoff, Pi lifecycle
 * Covers deferred invocation, target identity, and fresh-session completion
 */

import assert from "node:assert/strict";
import test from "node:test";

import { registerTelegramHostNewSession } from "../api/host.ts";
import {
  createTelegramSessionReplacementRuntime,
  createTelegramSessionStartHook,
} from "../lib/session-replacement.ts";

const REGISTRY_KEY = Symbol.for("pi-telegram.host-capability-registry");
const HANDOFF_KEY = Symbol.for("pi-telegram.session-replacement-handoff");

function clearGlobals(): void {
  const store = globalThis as Record<PropertyKey, unknown>;
  delete store[REGISTRY_KEY];
  delete store[HANDOFF_KEY];
}

test("session replacement waits for the persisted-update seam", async () => {
  clearGlobals();
  const events: string[] = [];
  const dispose = registerTelegramHostNewSession(async () => {
    events.push("new-session");
    return { cancelled: false };
  });
  const runtime = createTelegramSessionReplacementRuntime({
    sendTargetText: async (_target, text) => {
      events.push(text);
    },
  });
  const target = { chatId: 7, threadId: 42 };
  assert.deepEqual(runtime.request(target), { accepted: true });
  assert.deepEqual(events, []);
  runtime.flushAfterUpdatePersisted();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["new-session"]);
  await runtime.onSessionStart();
  assert.deepEqual(events, [
    "new-session",
    "✅ New session started in this thread.",
  ]);
  dispose();
  clearGlobals();
});

test("session replacement rejects when the host capability is unavailable", async () => {
  clearGlobals();
  const messages: string[] = [];
  const runtime = createTelegramSessionReplacementRuntime({
    sendTargetText: async (_target, text) => {
      messages.push(text);
    },
  });
  assert.deepEqual(runtime.request({ chatId: 1, threadId: 2 }), {
    accepted: false,
    reason: "New session is unavailable from this Pi host.",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(messages, []);
});

test("session replacement rechecks readiness after concurrent inbound work", async () => {
  clearGlobals();
  let providerCalls = 0;
  let blockingReason: string | undefined;
  const messages: string[] = [];
  const dispose = registerTelegramHostNewSession(async () => {
    providerCalls += 1;
    return { cancelled: false };
  });
  const runtime = createTelegramSessionReplacementRuntime({
    sendTargetText: async (_target, text) => {
      messages.push(text);
    },
    getBlockingReason: () => blockingReason,
  });
  assert.deepEqual(runtime.request({ chatId: 1, threadId: 2 }), {
    accepted: true,
  });
  blockingReason = "Cannot start a new session while the Telegram queue is non-empty.";

  runtime.flushAfterUpdatePersisted();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(providerCalls, 0);
  assert.equal(runtime.isPending(), false);
  assert.deepEqual(messages, [
    "New session not started: Cannot start a new session while the Telegram queue is non-empty.",
  ]);
  dispose();
  clearGlobals();
});

test("session replacement rejects a duplicate without changing its target", () => {
  clearGlobals();
  const dispose = registerTelegramHostNewSession(async () => ({ cancelled: false }));
  const runtime = createTelegramSessionReplacementRuntime({
    sendTargetText: async () => undefined,
  });
  assert.deepEqual(runtime.request({ chatId: 1, threadId: 2 }), { accepted: true });
  assert.deepEqual(runtime.request({ chatId: 9, threadId: 10 }), {
    accepted: false,
    reason: "A new session replacement is already pending.",
  });
  dispose();
  clearGlobals();
});

test("provider failure reports in the exact requested thread", async () => {
  clearGlobals();
  const messages: Array<{ chatId: number; threadId?: number; text: string }> = [];
  const events: string[] = [];
  const dispose = registerTelegramHostNewSession(async () => {
    events.push("provider");
    throw new Error("replacement failed");
  });
  const runtime = createTelegramSessionReplacementRuntime({
    sendTargetText: async (target, text) => {
      messages.push({ ...target, text });
    },
    recordRuntimeEvent: (_category, error) => {
      events.push(error instanceof Error ? error.message : String(error));
    },
  });
  const target = { chatId: 3, threadId: 8 };
  assert.deepEqual(runtime.request(target), { accepted: true });
  target.threadId = 99;
  runtime.flushAfterUpdatePersisted();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["provider", "replacement failed"]);
  assert.deepEqual(messages, [
    { chatId: 3, threadId: 8, text: "New session failed: replacement failed" },
  ]);
  dispose();
  clearGlobals();
});

test("cancelled replacement reports in the original exact thread", async () => {
  clearGlobals();
  const messages: Array<{ chatId: number; threadId?: number; text: string }> = [];
  const dispose = registerTelegramHostNewSession(async () => ({ cancelled: true }));
  const runtime = createTelegramSessionReplacementRuntime({
    sendTargetText: async (target, text) => {
      messages.push({ ...target, text });
    },
  });
  runtime.request({ chatId: 3, threadId: 8 });
  runtime.flushAfterUpdatePersisted();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(messages, [
    { chatId: 3, threadId: 8, text: "New session cancelled." },
  ]);
  dispose();
  clearGlobals();
});

test("expired handoffs are discarded and do not block or falsely complete later sessions", async () => {
  clearGlobals();
  let nowMs = 100;
  const dispose = registerTelegramHostNewSession(async () => ({ cancelled: false }));
  const runtime = createTelegramSessionReplacementRuntime({
    sendTargetText: async () => undefined,
    getNowMs: () => nowMs,
    handoffTtlMs: 10,
  });
  assert.deepEqual(runtime.request({ chatId: 4, threadId: 5 }), { accepted: true });
  runtime.flushAfterUpdatePersisted();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(runtime.isPending(), true);
  nowMs = 110;
  assert.equal(runtime.isPending(), false);
  await runtime.onSessionStart();
  assert.equal(runtime.isPending(), false);
  dispose();
  clearGlobals();
});

test("failing completion delivery is recorded after clearing the handoff", async () => {
  clearGlobals();
  const events: Array<{ phase?: unknown; message: string }> = [];
  const dispose = registerTelegramHostNewSession(async () => ({ cancelled: false }));
  const runtime = createTelegramSessionReplacementRuntime({
    sendTargetText: async () => {
      throw new Error("completion delivery failed");
    },
    recordRuntimeEvent: (_category, error, details) => {
      events.push({
        phase: details?.phase,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });
  runtime.request({ chatId: 8, threadId: 9 });
  runtime.flushAfterUpdatePersisted();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await runtime.onSessionStart();
  assert.equal(runtime.isPending(), false);
  assert.deepEqual(events, [
    { phase: "telegram-new-completion-send", message: "completion delivery failed" },
  ]);
  dispose();
  clearGlobals();
});

test("session start completes replacement even when follower refresh fails", async () => {
  const events: string[] = [];
  const hook = createTelegramSessionStartHook({
    refreshFollowerSession: async () => {
      throw new Error("follower refresh failed");
    },
    onSessionStart: async () => {
      events.push("replacement-complete");
    },
    recordRuntimeEvent: (_category, error, details) => {
      events.push(
        `${String(details?.phase)}:${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });

  await hook("start", {});

  assert.deepEqual(events, [
    "follower-session-refresh:follower refresh failed",
    "replacement-complete",
  ]);
});

test("named profile is restored before follower refresh and completion delivery", async () => {
  clearGlobals();
  const events: string[] = [];
  let activeProfileName: string | undefined = "builder";
  const dispose = registerTelegramHostNewSession(async () => ({ cancelled: false }));
  const previousRuntime = createTelegramSessionReplacementRuntime({
    getActiveProfileName: () => activeProfileName,
    activateProfile: (profileName) => {
      activeProfileName = profileName;
      return true;
    },
    sendTargetText: async () => undefined,
  });
  previousRuntime.request({ chatId: 7, threadId: 42 });
  previousRuntime.flushAfterUpdatePersisted();
  await new Promise<void>((resolve) => setImmediate(resolve));

  activeProfileName = undefined;
  const freshRuntime = createTelegramSessionReplacementRuntime({
    getActiveProfileName: () => activeProfileName,
    activateProfile: (profileName) => {
      events.push(`activate:${profileName}`);
      activeProfileName = profileName;
      return true;
    },
    sendTargetText: async (_target, text) => {
      events.push(`send:${activeProfileName ?? "default"}:${text}`);
    },
  });
  const hook = createTelegramSessionStartHook({
    restoreSessionProfile: freshRuntime.restoreProfile,
    refreshFollowerSession: async () => {
      events.push(`refresh:${activeProfileName ?? "default"}`);
    },
    onSessionStart: freshRuntime.onSessionStart,
  });

  await hook("start", {});

  assert.deepEqual(events, [
    "activate:builder",
    "refresh:builder",
    "send:builder:✅ New session started in this thread.",
  ]);
  dispose();
  clearGlobals();
});
