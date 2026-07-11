/**
 * Telegram host capability regressions
 * Zones: public API, host interop
 * Covers the process-global newSession registry and identity-safe disposal
 */

import assert from "node:assert/strict";
import test from "node:test";

import { registerTelegramHostNewSession } from "../api/host.ts";

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
