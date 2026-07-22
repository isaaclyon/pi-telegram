/**
 * Regression tests for the Telegram tool activity status message
 * Covers label/text formatting, throttled edits, deletion at agent end,
 * and gating for disabled config, guest queries, and missing turns
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  TELEGRAM_TOOL_ACTIVITY_MAX_LINES,
  buildTelegramToolActivityText,
  createTelegramToolActivityRuntime,
  formatTelegramToolActivityElapsed,
  formatTelegramToolActivityLabel,
  type TelegramToolActivityEntry,
  type TelegramToolActivityRuntimeDeps,
} from "../lib/tool-activity.ts";

function createToolActivityHarness(
  overrides: Partial<TelegramToolActivityRuntimeDeps> = {},
) {
  const events: string[] = [];
  const timers: { callback: () => void; delayMs: number }[] = [];
  let nowMs = 1_000;
  const runtime = createTelegramToolActivityRuntime({
    isEnabled: () => true,
    getActiveTurn: () => ({ chatId: 42, target: { chatId: 42, threadId: 9 } }),
    sendMessage: async (body) => {
      events.push(`send:${body.chat_id}:${body.message_thread_id ?? "none"}`);
      return { message_id: 77 };
    },
    editMessageText: async (body) => {
      events.push(`edit:${body.message_id}`);
      return "edited";
    },
    deleteMessage: async (chatId, messageId) => {
      events.push(`delete:${chatId}:${messageId}`);
    },
    now: () => nowMs,
    setTimer: (callback, delayMs) => {
      const timer = { callback, delayMs };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      const index = timers.indexOf(timer as (typeof timers)[number]);
      if (index >= 0) timers.splice(index, 1);
    },
    recordRuntimeEvent: (category, _error, details) => {
      events.push(`record:${category}:${String(details?.phase)}`);
    },
    ...overrides,
  });
  return {
    runtime,
    events,
    timers,
    advance(deltaMs: number) {
      nowMs += deltaMs;
    },
    fireTimers() {
      const pending = timers.splice(0, timers.length);
      for (const timer of pending) timer.callback();
    },
    async settle() {
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("Tool activity labels compact path and command hints", () => {
  assert.equal(
    formatTelegramToolActivityLabel(
      "read",
      { path: "/home/user/repo/lib/host.ts" },
      "/home/user/repo",
    ),
    "read lib/host.ts",
  );
  assert.equal(
    formatTelegramToolActivityLabel("bash", { command: "npm   run\n build" }),
    "bash: npm run build",
  );
  assert.equal(
    formatTelegramToolActivityLabel("bash", { command: `x${"y".repeat(80)}` }),
    `bash: x${"y".repeat(62)}…`,
  );
  assert.equal(formatTelegramToolActivityLabel("think", { level: 2 }), "think");
  assert.equal(formatTelegramToolActivityLabel("think", undefined), "think");
});

test("Tool activity text renders markers, escaping, window, and footer", () => {
  const entries = Array.from(
    { length: 8 },
    (_value, index): TelegramToolActivityEntry => ({
      toolCallId: `call-${index}`,
      label: `tool-${index} <arg&${index}>`,
      status: "done",
    }),
  );
  entries[7]!.status = "running";
  entries[6]!.status = "error";
  const text = buildTelegramToolActivityText(
    { entries, toolCount: 8, startedAtMs: 0 },
    45_000,
  );
  const lines = text.split("\n");
  assert.equal(lines[0], "🛠 <b>Working…</b>");
  assert.equal(lines.length, TELEGRAM_TOOL_ACTIVITY_MAX_LINES + 2);
  assert.equal(lines[1], "▸ tool-2 &lt;arg&amp;2&gt;");
  assert.equal(lines[TELEGRAM_TOOL_ACTIVITY_MAX_LINES - 1], "✗ tool-6 &lt;arg&amp;6&gt;");
  assert.equal(lines[TELEGRAM_TOOL_ACTIVITY_MAX_LINES], "⏳ tool-7 &lt;arg&amp;7&gt;");
  assert.equal(lines.at(-1), "<i>(8 tools · 45s)</i>");
});

test("Tool activity elapsed formatting covers seconds and minutes", () => {
  assert.equal(formatTelegramToolActivityElapsed(5_000), "5s");
  assert.equal(formatTelegramToolActivityElapsed(130_000), "2m 10s");
  assert.equal(formatTelegramToolActivityElapsed(-5), "0s");
});

test("First tool execution posts one quiet threaded status message", async () => {
  const harness = createToolActivityHarness();
  harness.runtime.onToolExecutionStart({
    toolCallId: "1",
    toolName: "read",
    args: { path: "README.md" },
  });
  await harness.settle();
  assert.deepEqual(harness.events, ["send:42:9"]);
});

test("Rapid tool events coalesce into one throttled edit", async () => {
  const harness = createToolActivityHarness();
  harness.runtime.onToolExecutionStart({
    toolCallId: "1",
    toolName: "read",
    args: { path: "a.ts" },
  });
  await harness.settle();
  harness.runtime.onToolExecutionEnd({ toolCallId: "1", isError: false });
  harness.runtime.onToolExecutionStart({
    toolCallId: "2",
    toolName: "read",
    args: { path: "b.ts" },
  });
  await harness.settle();
  assert.deepEqual(harness.events, ["send:42:9"]);
  assert.equal(harness.timers.length, 1);
  harness.advance(2_000);
  harness.fireTimers();
  await harness.settle();
  assert.deepEqual(harness.events, ["send:42:9", "edit:77"]);
});

test("Unchanged text skips the edit call", async () => {
  const harness = createToolActivityHarness();
  harness.runtime.onToolExecutionStart({
    toolCallId: "1",
    toolName: "read",
    args: { path: "a.ts" },
  });
  await harness.settle();
  harness.runtime.onToolExecutionEnd({ toolCallId: "missing", isError: false });
  harness.advance(3_000);
  harness.fireTimers();
  await harness.settle();
  assert.deepEqual(harness.events, ["send:42:9"]);
});

test("Finish deletes the status message and clears state", async () => {
  const harness = createToolActivityHarness();
  harness.runtime.onToolExecutionStart({
    toolCallId: "1",
    toolName: "read",
    args: { path: "a.ts" },
  });
  await harness.settle();
  await harness.runtime.finish();
  assert.deepEqual(harness.events, ["send:42:9", "delete:42:77"]);
  await harness.runtime.finish();
  assert.deepEqual(harness.events, ["send:42:9", "delete:42:77"]);
});

test("Finish without any tool executions is a no-op", async () => {
  const harness = createToolActivityHarness();
  await harness.runtime.finish();
  assert.deepEqual(harness.events, []);
});

test("Finish awaits the in-flight send before deleting", async () => {
  let releaseSend: (() => void) | undefined;
  const harness = createToolActivityHarness({
    sendMessage: async () => {
      await new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
      return { message_id: 88 };
    },
  });
  harness.runtime.onToolExecutionStart({
    toolCallId: "1",
    toolName: "read",
    args: { path: "a.ts" },
  });
  const finishPromise = harness.runtime.finish();
  releaseSend!();
  await finishPromise;
  assert.deepEqual(harness.events, ["delete:42:88"]);
});

test("Telegram API errors are recorded and stop further sends", async () => {
  const harness = createToolActivityHarness({
    sendMessage: async () => {
      throw new Error("blocked");
    },
  });
  harness.runtime.onToolExecutionStart({
    toolCallId: "1",
    toolName: "read",
    args: { path: "a.ts" },
  });
  await harness.settle();
  harness.advance(5_000);
  harness.runtime.onToolExecutionStart({
    toolCallId: "2",
    toolName: "read",
    args: { path: "b.ts" },
  });
  await harness.settle();
  await harness.runtime.finish();
  assert.deepEqual(harness.events, ["record:tool-activity:send"]);
});

test("Disabled config, guest queries, and missing turns post nothing", async () => {
  const disabled = createToolActivityHarness({ isEnabled: () => false });
  disabled.runtime.onToolExecutionStart({
    toolCallId: "1",
    toolName: "read",
    args: {},
  });
  const guest = createToolActivityHarness({
    getActiveTurn: () => ({ chatId: 42, guestQueryId: "guest-1" }),
  });
  guest.runtime.onToolExecutionStart({
    toolCallId: "1",
    toolName: "read",
    args: {},
  });
  const noTurn = createToolActivityHarness({
    getActiveTurn: () => undefined,
  });
  noTurn.runtime.onToolExecutionStart({
    toolCallId: "1",
    toolName: "read",
    args: {},
  });
  await disabled.settle();
  await guest.settle();
  await noTurn.settle();
  assert.deepEqual(disabled.events, []);
  assert.deepEqual(guest.events, []);
  assert.deepEqual(noTurn.events, []);
});

test("Agent start resets stale state by deleting the previous message", async () => {
  const harness = createToolActivityHarness();
  harness.runtime.onToolExecutionStart({
    toolCallId: "1",
    toolName: "read",
    args: { path: "a.ts" },
  });
  await harness.settle();
  harness.runtime.onAgentStart();
  await harness.settle();
  assert.deepEqual(harness.events, ["send:42:9", "delete:42:77"]);
});

test("Discard clears state without any Telegram API calls", async () => {
  const harness = createToolActivityHarness();
  harness.runtime.onToolExecutionStart({
    toolCallId: "1",
    toolName: "read",
    args: { path: "a.ts" },
  });
  await harness.settle();
  harness.runtime.discard();
  await harness.runtime.finish();
  assert.deepEqual(harness.events, ["send:42:9"]);
});
