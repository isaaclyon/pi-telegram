/**
 * Telegram tool activity status message
 * Zones: telegram outbound, pi agent lifecycle
 * Owns the transient per-turn tool activity message: posted on the first tool
 * execution, edited in place with throttling, and deleted at agent end
 */

import type {
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
} from "./pi.ts";
import { escapeHtml } from "./rendering.ts";
import {
  getTelegramTargetThreadParams,
  type TelegramTarget,
} from "./target.ts";
import type {
  TelegramEditMessageTextBody,
  TelegramSendMessageBody,
  TelegramSentMessage,
} from "./telegram-api.ts";

export const TELEGRAM_TOOL_ACTIVITY_EDIT_INTERVAL_MS = 2_000;
export const TELEGRAM_TOOL_ACTIVITY_MAX_LINES = 6;
export const TELEGRAM_TOOL_ACTIVITY_HINT_MAX_CHARS = 64;
const TELEGRAM_TOOL_ACTIVITY_MAX_RETAINED_ENTRIES = 32;

const TELEGRAM_TOOL_ACTIVITY_PATH_HINT_KEYS = [
  "path",
  "file_path",
  "filePath",
  "url",
  "name",
] as const;
const TELEGRAM_TOOL_ACTIVITY_TEXT_HINT_KEYS = [
  "command",
  "cmd",
  "pattern",
  "query",
  "prompt",
  "description",
] as const;

export type TelegramToolActivityEntryStatus = "running" | "done" | "error";

export interface TelegramToolActivityEntry {
  toolCallId: string;
  label: string;
  status: TelegramToolActivityEntryStatus;
}

export interface TelegramToolActivityTextState {
  entries: TelegramToolActivityEntry[];
  toolCount: number;
  startedAtMs: number;
}

interface TelegramToolActivityState extends TelegramToolActivityTextState {
  chatId: number;
  target?: TelegramTarget;
  messageId?: number;
  lastSentText: string;
  lastFlushAtMs?: number;
  finished: boolean;
  flushPromise?: Promise<void>;
  flushRequested?: boolean;
  timer?: unknown;
}

export interface TelegramToolActivityActiveTurn {
  chatId: number;
  target?: TelegramTarget;
  guestQueryId?: string;
}

export interface TelegramToolActivityRuntimeDeps {
  isEnabled: () => boolean;
  getActiveTurn: () => TelegramToolActivityActiveTurn | undefined;
  sendMessage: (body: TelegramSendMessageBody) => Promise<TelegramSentMessage>;
  editMessageText: (body: TelegramEditMessageTextBody) => Promise<unknown>;
  deleteMessage: (chatId: number, messageId: number) => Promise<void>;
  getCwd?: () => string | undefined;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  editIntervalMs?: number;
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
}

export interface TelegramToolActivityRuntime {
  onAgentStart: () => void;
  onToolExecutionStart: (
    event: Pick<ToolExecutionStartEvent, "toolCallId" | "toolName" | "args">,
  ) => void;
  onToolExecutionEnd: (
    event: Pick<ToolExecutionEndEvent, "toolCallId" | "isError">,
  ) => void;
  finish: () => Promise<void>;
  discard: () => void;
}

function compactTelegramToolActivityHint(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= TELEGRAM_TOOL_ACTIVITY_HINT_MAX_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, TELEGRAM_TOOL_ACTIVITY_HINT_MAX_CHARS - 1)}…`;
}

function relativizeTelegramToolActivityPath(
  value: string,
  cwd: string | undefined,
): string {
  if (!cwd) return value;
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function readTelegramToolActivityArgString(
  args: unknown,
  key: string,
): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function formatTelegramToolActivityLabel(
  toolName: string,
  args: unknown,
  cwd?: string,
): string {
  for (const key of TELEGRAM_TOOL_ACTIVITY_PATH_HINT_KEYS) {
    const value = readTelegramToolActivityArgString(args, key);
    if (value !== undefined) {
      const hint = compactTelegramToolActivityHint(
        relativizeTelegramToolActivityPath(value, cwd),
      );
      return `${toolName} ${hint}`;
    }
  }
  for (const key of TELEGRAM_TOOL_ACTIVITY_TEXT_HINT_KEYS) {
    const value = readTelegramToolActivityArgString(args, key);
    if (value !== undefined) {
      return `${toolName}: ${compactTelegramToolActivityHint(value)}`;
    }
  }
  return toolName;
}

export function formatTelegramToolActivityElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function buildTelegramToolActivityText(
  state: TelegramToolActivityTextState,
  nowMs: number,
): string {
  const lines = ["🛠 <b>Working…</b>"];
  for (const entry of state.entries.slice(-TELEGRAM_TOOL_ACTIVITY_MAX_LINES)) {
    const marker =
      entry.status === "running" ? "⏳" : entry.status === "error" ? "✗" : "▸";
    lines.push(`${marker} ${escapeHtml(entry.label)}`);
  }
  const elapsed = formatTelegramToolActivityElapsed(nowMs - state.startedAtMs);
  const toolWord = state.toolCount === 1 ? "tool" : "tools";
  lines.push(`<i>(${state.toolCount} ${toolWord} · ${elapsed})</i>`);
  return lines.join("\n");
}

export function createTelegramToolActivityRuntime(
  deps: TelegramToolActivityRuntimeDeps,
): TelegramToolActivityRuntime {
  const now = deps.now ?? (() => Date.now());
  const setTimer =
    deps.setTimer ??
    ((callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref?.();
      return timer;
    });
  const clearTimer =
    deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as never));
  const editIntervalMs =
    deps.editIntervalMs ?? TELEGRAM_TOOL_ACTIVITY_EDIT_INTERVAL_MS;
  let state: TelegramToolActivityState | undefined;

  const cancelTimer = (current: TelegramToolActivityState): void => {
    if (current.timer !== undefined) {
      clearTimer(current.timer);
      current.timer = undefined;
    }
  };

  const flush = (current: TelegramToolActivityState): Promise<void> => {
    if (current.finished) return Promise.resolve();
    if (current.flushPromise) {
      current.flushRequested = true;
      return current.flushPromise;
    }
    current.flushPromise = (async () => {
      current.flushRequested = false;
      const text = buildTelegramToolActivityText(current, now());
      try {
        if (current.messageId === undefined) {
          const sent = await deps.sendMessage({
            chat_id: current.chatId,
            text,
            parse_mode: "HTML",
            disable_notification: true,
            ...getTelegramTargetThreadParams(
              current.target ?? { chatId: current.chatId },
            ),
          });
          current.messageId = sent.message_id;
          current.lastSentText = text;
        } else if (text !== current.lastSentText) {
          await deps.editMessageText({
            chat_id: current.chatId,
            message_id: current.messageId,
            text,
            parse_mode: "HTML",
          });
          current.lastSentText = text;
        }
        current.lastFlushAtMs = now();
      } catch (error) {
        deps.recordRuntimeEvent?.("tool-activity", error, {
          phase: current.messageId === undefined ? "send" : "edit",
          chatId: current.chatId,
          messageId: current.messageId,
        });
        current.finished = true;
      }
    })();
    const settle = (): void => {
      current.flushPromise = undefined;
      if (state === current && !current.finished && current.flushRequested) {
        current.flushRequested = false;
        scheduleFlush(current);
      }
    };
    return current.flushPromise.then(settle, settle);
  };

  const scheduleFlush = (current: TelegramToolActivityState): void => {
    if (current.finished) return;
    if (current.flushPromise) {
      current.flushRequested = true;
      return;
    }
    const waitMs =
      current.lastFlushAtMs === undefined
        ? 0
        : current.lastFlushAtMs + editIntervalMs - now();
    if (waitMs <= 0) {
      void flush(current);
      return;
    }
    if (current.timer !== undefined) return;
    current.timer = setTimer(() => {
      current.timer = undefined;
      if (state !== current || current.finished) return;
      void flush(current);
    }, waitMs);
  };

  const finish = async (): Promise<void> => {
    const current = state;
    state = undefined;
    if (!current) return;
    cancelTimer(current);
    current.finished = true;
    if (current.flushPromise) {
      await current.flushPromise.catch(() => {});
    }
    if (current.messageId === undefined) return;
    try {
      await deps.deleteMessage(current.chatId, current.messageId);
    } catch (error) {
      deps.recordRuntimeEvent?.("tool-activity", error, {
        phase: "delete",
        chatId: current.chatId,
        messageId: current.messageId,
      });
    }
  };

  return {
    onAgentStart() {
      if (state) void finish();
    },
    onToolExecutionStart(event) {
      if (!deps.isEnabled()) return;
      if (!state) {
        const turn = deps.getActiveTurn();
        if (!turn || turn.guestQueryId !== undefined) return;
        state = {
          chatId: turn.chatId,
          target: turn.target,
          entries: [],
          toolCount: 0,
          startedAtMs: now(),
          lastSentText: "",
          finished: false,
        };
      }
      if (state.finished) return;
      state.entries.push({
        toolCallId: event.toolCallId,
        label: formatTelegramToolActivityLabel(
          event.toolName,
          event.args,
          deps.getCwd?.(),
        ),
        status: "running",
      });
      if (state.entries.length > TELEGRAM_TOOL_ACTIVITY_MAX_RETAINED_ENTRIES) {
        state.entries.splice(
          0,
          state.entries.length - TELEGRAM_TOOL_ACTIVITY_MAX_RETAINED_ENTRIES,
        );
      }
      state.toolCount += 1;
      scheduleFlush(state);
    },
    onToolExecutionEnd(event) {
      if (!state || state.finished) return;
      for (let index = state.entries.length - 1; index >= 0; index -= 1) {
        const entry = state.entries[index]!;
        if (entry.toolCallId !== event.toolCallId) continue;
        entry.status = event.isError ? "error" : "done";
        scheduleFlush(state);
        return;
      }
    },
    finish,
    discard() {
      const current = state;
      state = undefined;
      if (!current) return;
      cancelTimer(current);
      current.finished = true;
    },
  };
}
