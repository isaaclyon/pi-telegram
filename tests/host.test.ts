/**
 * Telegram host capability regressions
 * Zones: public API, host interop
 * Covers the process-global newSession registry and identity-safe disposal
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  registerTelegramHostHouseholdGroup,
  registerTelegramHostNewSession,
  registerTelegramHostPromptPreparation,
} from "../api/host.ts";
import {
  getTelegramHostHouseholdGroup,
  getTelegramHostPromptPreparation,
  isTelegramHostPrivateChatThreadedModeAllowed,
} from "../lib/host.ts";

const REGISTRY_KEY = Symbol.for("pi-telegram.host-capability-registry");

function clearHostRegistry(): void {
  delete (globalThis as Record<PropertyKey, unknown>)[REGISTRY_KEY];
}

test("host newSession registration rejects competing providers", () => {
  clearHostRegistry();
  const first = async () => ({ cancelled: false });
  const second = async () => ({ cancelled: true });
  const disposeFirst = registerTelegramHostNewSession(first);
  assert.throws(
    () => registerTelegramHostNewSession(second),
    /already registered/,
  );
  disposeFirst();
  const disposeSecond = registerTelegramHostNewSession(second);
  disposeSecond();
  clearHostRegistry();
});

test("stale host disposer cannot remove a replacement provider", () => {
  clearHostRegistry();
  const first = async () => ({ cancelled: false });
  const second = async () => ({ cancelled: false });
  const disposeFirst = registerTelegramHostNewSession(first);
  disposeFirst();
  const disposeSecond = registerTelegramHostNewSession(second);
  disposeFirst();
  assert.throws(
    () => registerTelegramHostNewSession(first),
    /already registered/,
  );
  disposeSecond();
  clearHostRegistry();
});

test("host API exposes only the narrow callable capability", () => {
  clearHostRegistry();
  const dispose = registerTelegramHostNewSession(async () => ({ cancelled: true }));
  assert.equal(typeof dispose, "function");
  dispose();
  clearHostRegistry();
});

test("host prompt preparation registration is narrow and identity-safe", async () => {
  clearHostRegistry();
  const calls: string[] = [];
  const dispose = registerTelegramHostPromptPreparation(async (input) => {
    calls.push(input.trigger);
    return { sessionReplaced: true };
  });
  await assert.doesNotReject(async () => {
    assert.deepEqual(await getTelegramHostPromptPreparation()?.({ trigger: "telegram" }), {
      sessionReplaced: true,
    });
  });
  assert.deepEqual(calls, ["telegram"]);
  dispose();
  assert.equal(getTelegramHostPromptPreparation(), undefined);
  clearHostRegistry();
});

test("host registers one validated household group policy and guards disposal", () => {
  clearHostRegistry();
  const policy = {
    kind: "household-group" as const,
    chatId: -100123,
    actors: [
      { userId: 101, label: "Isaac" },
      { userId: 202, label: "Emma" },
    ],
  };
  const dispose = registerTelegramHostHouseholdGroup(policy);
  assert.deepEqual(getTelegramHostHouseholdGroup(), policy);
  assert.equal(isTelegramHostPrivateChatThreadedModeAllowed(), false);
  assert.throws(
    () => registerTelegramHostHouseholdGroup(policy),
    /already registered/,
  );
  dispose();
  assert.equal(getTelegramHostHouseholdGroup(), undefined);
  assert.equal(isTelegramHostPrivateChatThreadedModeAllowed(), true);
  clearHostRegistry();
});

test("host rejects unsafe household group policy shapes", () => {
  clearHostRegistry();
  assert.throws(
    () =>
      registerTelegramHostHouseholdGroup({
        kind: "household-group",
        chatId: 123,
        actors: [
          { userId: 101, label: "Isaac" },
          { userId: 202, label: "Emma" },
        ],
      }),
    /negative Telegram group chat id/,
  );
  assert.throws(
    () =>
      registerTelegramHostHouseholdGroup({
        kind: "household-group",
        chatId: -100123,
        actors: [
          { userId: 101, label: "Isaac" },
          { userId: 101, label: "Emma" },
        ],
      }),
    /distinct positive Telegram user ids/,
  );
  assert.throws(
    () =>
      registerTelegramHostHouseholdGroup({
        kind: "household-group",
        chatId: -100123,
        actors: [
          { userId: 101, label: "Isaac|admin" },
          { userId: 202, label: "Emma" },
        ],
      }),
    /safe stable actor labels/,
  );
  clearHostRegistry();
});

test("host registration rejects a malformed occupied process-global registry", () => {
  clearHostRegistry();
  (globalThis as Record<PropertyKey, unknown>)[REGISTRY_KEY] = {
    version: 1,
    provider: "not callable",
  };
  assert.throws(
    () => registerTelegramHostNewSession(async () => ({ cancelled: false })),
    /malformed or incompatible/,
  );
  clearHostRegistry();
});

test("host rejects a malformed household policy injected through the global registry", () => {
  clearHostRegistry();
  (globalThis as Record<PropertyKey, unknown>)[REGISTRY_KEY] = {
    version: 1,
    householdGroup: {
      kind: "household-group",
      chatId: -100123,
      actors: "not an actor list",
    },
    householdToken: {},
  };
  assert.throws(
    () => getTelegramHostHouseholdGroup(),
    /malformed or incompatible/,
  );
  clearHostRegistry();
});

test("host registration rejects an incompatible occupied registry", () => {
  clearHostRegistry();
  (globalThis as Record<PropertyKey, unknown>)[REGISTRY_KEY] = {
    version: 2,
    provider: undefined,
    token: undefined,
  };
  assert.throws(
    () => registerTelegramHostNewSession(async () => ({ cancelled: false })),
    /malformed or incompatible/,
  );
  clearHostRegistry();
});
