/**
 * Regression tests for public package API exports
 * Zones: package boundary, companion extension interop
 * Guards the stable 0.12 public subpaths and the removal of deep lib wildcard exports
 */

import assert from "node:assert/strict";
import test from "node:test";

async function assertPackagePathNotExported(specifier: string): Promise<void> {
  await assert.rejects(
    () => import(specifier),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
}

test("Public package subpaths expose the stable companion-extension API", async () => {
  const [
    root,
    inbound,
    outbound,
    updates,
    commands,
    sections,
    status,
    voice,
    keyboard,
  ] = await Promise.all([
    import("@llblab/pi-telegram"),
    import("@llblab/pi-telegram/inbound"),
    import("@llblab/pi-telegram/outbound"),
    import("@llblab/pi-telegram/updates"),
    import("@llblab/pi-telegram/commands"),
    import("@llblab/pi-telegram/sections"),
    import("@llblab/pi-telegram/status"),
    import("@llblab/pi-telegram/voice"),
    import("@llblab/pi-telegram/keyboard"),
  ]);

  assert.deepEqual(Object.keys(root), ["default"]);
  assert.deepEqual(Object.keys(inbound).sort(), [
    "registerTelegramInboundHandler",
  ]);
  assert.deepEqual(Object.keys(outbound).sort(), [
    "recordTelegramRuntimeEvent",
    "registerTelegramOutboundHandler",
  ]);
  assert.deepEqual(Object.keys(updates).sort(), [
    "registerTelegramUpdateHandler",
  ]);
  assert.deepEqual(Object.keys(commands).sort(), ["registerTelegramCommand"]);
  assert.deepEqual(Object.keys(sections).sort(), [
    "getTelegramSectionDiagnostics",
    "presentTelegramSection",
    "registerTelegramSection",
  ]);
  assert.deepEqual(Object.keys(status).sort(), [
    "registerTelegramStatusLineProvider",
  ]);
  assert.deepEqual(Object.keys(voice).sort(), [
    "TELEGRAM_VOICE_REPLY_MODES",
    "computeVoicePromptContribution",
    "computeVoiceTurnFlags",
    "getTelegramVoiceReplyMode",
    "getTelegramVoiceSendTranscript",
    "isVoiceTurn",
    "registerTelegramVoiceSynthesisProvider",
    "registerTelegramVoiceTranscriptionProvider",
    "shouldSuppressPreviewForVoice",
  ]);
  assert.deepEqual(Object.keys(keyboard), []);
});

test("Package-private lib implementation paths are not exported", async () => {
  await assertPackagePathNotExported("@llblab/pi-telegram/lib/updates.ts");
  await assertPackagePathNotExported("@llblab/pi-telegram/lib/sections.ts");
  await assertPackagePathNotExported("@llblab/pi-telegram/api/updates.ts");
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Prototype JS boundary is intentionally independent of the legacy SDK.
// @ts-ignore -- this prototype subpath has no published declaration contract.
import { createDurableTelegramPrototype } from '@llblab/pi-telegram/prototype-durable';


test('public prototype waits for the real preview flush before final without draft clearing', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'telegram-prototype-'));
 const calls: string[] = [];
 let release!: () => void;
 const blocked = new Promise<void>(resolve => { release = resolve; });
 let started!: () => void;
 const draftStarted = new Promise<void>(resolve => { started = resolve; });
 const target = { chatId: 100, threadId: 7 };
 const adapter = createDurableTelegramPrototype({
   target, actorId: 10,
   ownership: { locksPath: join(dir, 'locks.json'), cwd: dir },
   transport: { call: async (method: string, body: any) => {
     calls.push(method);
     assert.equal(body.chat_id, 100); assert.equal(body.message_thread_id, 7);
     if (method === 'sendRichMessageDraft') { started(); await blocked; }
     return { message_id: 20 };
   } },
   runtime: { run: async (_input: unknown, preview: (text: string) => Promise<void>) => {
     void preview('Complete preview.');
     await draftStarted;
     return 'Final answer.';
   } },
 });
 try {
   assert.equal(adapter.connect().ok, true);
   const receive = adapter.receive({ target, actorId: 10, messageId: 3, text: 'hello' });
   await draftStarted;
   assert.deepEqual(calls, ['sendRichMessageDraft']);
   release(); await receive;
   assert.deepEqual(calls, ['sendRichMessageDraft', 'sendRichMessage']);
 } finally { release(); adapter.disconnect(); rmSync(dir, { recursive: true, force: true }); }
});

test('prototype requires explicit ownership storage and transport', () => {
 assert.throws(() => createDurableTelegramPrototype({ ownership: { cwd: '/synthetic' } }), /locksPath/);
 assert.throws(() => createDurableTelegramPrototype({ ownership: { cwd: '/synthetic', locksPath: '/synthetic/locks' } }), /transport/);
});
