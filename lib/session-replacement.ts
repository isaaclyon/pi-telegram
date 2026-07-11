/**
 * Telegram same-thread session replacement runtime
 * Zones: telegram controls, pi agent lifecycle, polling handoff
 * Owns deferred host replacement requests and fresh-session handoff notices without retaining ExtensionContext
 */

import { getTelegramHostNewSession } from "./host.ts";
import type { TelegramTarget } from "./target.ts";

export const TELEGRAM_SESSION_REPLACEMENT_HANDOFF_TTL_MS = 30_000;

export interface TelegramSessionReplacementHandoff {
  requestId: string;
  target: TelegramTarget;
  createdAtMs: number;
  expiresAtMs: number;
}

const TELEGRAM_SESSION_REPLACEMENT_HANDOFF_KEY = Symbol.for(
  "pi-telegram.session-replacement-handoff",
);

function getHandoff(): TelegramSessionReplacementHandoff | undefined {
  const value = (globalThis as Record<PropertyKey, unknown>)[
    TELEGRAM_SESSION_REPLACEMENT_HANDOFF_KEY
  ];
  if (!value || typeof value !== "object") return undefined;
  const handoff = value as Partial<TelegramSessionReplacementHandoff>;
  if (
    typeof handoff.requestId !== "string" ||
    !handoff.target ||
    typeof handoff.target !== "object" ||
    typeof handoff.target.chatId !== "number" ||
    typeof handoff.createdAtMs !== "number" ||
    typeof handoff.expiresAtMs !== "number" ||
    handoff.expiresAtMs <= handoff.createdAtMs
  ) {
    return undefined;
  }
  return handoff as TelegramSessionReplacementHandoff;
}

function setHandoff(handoff: TelegramSessionReplacementHandoff | undefined): void {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  if (handoff) globalStore[TELEGRAM_SESSION_REPLACEMENT_HANDOFF_KEY] = handoff;
  else delete globalStore[TELEGRAM_SESSION_REPLACEMENT_HANDOFF_KEY];
}

function getFreshHandoff(nowMs: number): TelegramSessionReplacementHandoff | undefined {
  const handoff = getHandoff();
  if (!handoff) return undefined;
  if (handoff.expiresAtMs <= nowMs) {
    setHandoff(undefined);
    return undefined;
  }
  return handoff;
}

function createDefaultTelegramSessionReplacementRequestId(
  sequence: () => number,
): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") {
    return `telegram-new:${randomUUID.call(globalThis.crypto)}`;
  }
  return `telegram-new:${process.pid}:${Date.now()}:${sequence()}:${Math.random().toString(36).slice(2)}`;
}

export interface TelegramSessionReplacementRequestResult {
  accepted: boolean;
  reason?: string;
}

export interface TelegramSessionReplacementRuntime {
  isPending: () => boolean;
  request: (
    target: TelegramTarget,
  ) => TelegramSessionReplacementRequestResult;
  flushAfterUpdatePersisted: () => boolean;
  flushAfterInboundHandler: () => void;
  onSessionStart: () => Promise<void>;
}

export function createTelegramSessionStartHook<TEvent, TContext>(deps: {
  refreshFollowerSession: (event: TEvent, ctx: TContext) => Promise<void>;
  onSessionStart: () => Promise<void>;
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
}): (event: TEvent, ctx: TContext) => Promise<void> {
  return async function onSessionStart(event, ctx): Promise<void> {
    try {
      await deps.refreshFollowerSession(event, ctx);
    } catch (error) {
      deps.recordRuntimeEvent?.("bus", error, {
        phase: "follower-session-refresh",
      });
    }
    await deps.onSessionStart();
  };
}

export function createTelegramSessionReplacementRuntime(deps: {
  sendTargetText: (target: TelegramTarget, text: string) => Promise<void>;
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
  createRequestId?: () => string;
  getNowMs?: () => number;
  handoffTtlMs?: number;
  getBlockingReason?: () => string | undefined;
}): TelegramSessionReplacementRuntime {
  let pending = false;
  let requestSequence = 0;
  const deferred: Array<() => void> = [];
  const getNowMs = deps.getNowMs ?? Date.now;
  const handoffTtlMs =
    deps.handoffTtlMs ?? TELEGRAM_SESSION_REPLACEMENT_HANDOFF_TTL_MS;
  const createRequestId =
    deps.createRequestId ??
    (() => createDefaultTelegramSessionReplacementRequestId(() => ++requestSequence));

  const isPending = (): boolean => pending || getFreshHandoff(getNowMs()) !== undefined;
  const clearOwnHandoff = (requestId: string): void => {
    if (getHandoff()?.requestId === requestId) setHandoff(undefined);
  };
  const report = (target: TelegramTarget, text: string): void => {
    void deps.sendTargetText(target, text).catch((error) => {
      deps.recordRuntimeEvent?.("session", error);
    });
  };
  const run = (target: TelegramTarget, requestId: string): void => {
    void (async () => {
      const blockingReason = deps.getBlockingReason?.();
      if (blockingReason) {
        pending = false;
        clearOwnHandoff(requestId);
        report(target, `New session not started: ${blockingReason}`);
        return;
      }
      const provider = getTelegramHostNewSession();
      if (!provider) {
        pending = false;
        clearOwnHandoff(requestId);
        report(target, "New session failed: the Pi host capability is unavailable.");
        return;
      }
      try {
        const result = await provider();
        pending = false;
        if (result.cancelled) {
          clearOwnHandoff(requestId);
          report(target, "New session cancelled.");
        }
        // A successful replacement is acknowledged by onSessionStart in the fresh session.
      } catch (error) {
        pending = false;
        clearOwnHandoff(requestId);
        const message = error instanceof Error ? error.message : String(error);
        report(target, `New session failed: ${message}`);
        deps.recordRuntimeEvent?.("session", error, { phase: "telegram-new" });
      }
    })();
  };
  const takeDeferred = (): Array<() => void> => deferred.splice(0);
  const runDeferred = (tasks: Array<() => void>): void => {
    for (const task of tasks) task();
  };
  return {
    isPending,
    request(target) {
      if (isPending()) {
        return {
          accepted: false,
          reason: "A new session replacement is already pending.",
        };
      }
      if (!getTelegramHostNewSession()) {
        return {
          accepted: false,
          reason: "New session is unavailable from this Pi host.",
        };
      }
      const requestId = createRequestId();
      const requestedTarget = { ...target };
      pending = true;
      const createdAtMs = getNowMs();
      setHandoff({
        requestId,
        target: requestedTarget,
        createdAtMs,
        expiresAtMs: createdAtMs + handoffTtlMs,
      });
      deferred.push(() => run(requestedTarget, requestId));
      return { accepted: true };
    },
    flushAfterUpdatePersisted() {
      const tasks = takeDeferred();
      if (tasks.length === 0) return false;
      setImmediate(() => runDeferred(tasks));
      return true;
    },
    flushAfterInboundHandler() {
      runDeferred(takeDeferred());
    },
    async onSessionStart() {
      const handoff = getFreshHandoff(getNowMs());
      if (!handoff) return;
      pending = false;
      setHandoff(undefined);
      try {
        await deps.sendTargetText(
          handoff.target,
          "✅ New session started in this thread.",
        );
      } catch (error) {
        deps.recordRuntimeEvent?.("session", error, {
          phase: "telegram-new-completion-send",
          requestId: handoff.requestId,
        });
      }
    },
  };
}
