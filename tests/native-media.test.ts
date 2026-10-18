/** Tests for native inbound media decoding, grouping, voice and prompt text. Offline synthetic fixtures. */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTelegramNativeMediaGroups,
  decodeTelegramNativeMedia,
  formatTelegramNativeMediaPrompt,
  transcribeTelegramNativeVoice,
  TelegramNativeVoiceError,
  type TelegramNativeMediaMessage,
} from "../lib/native-media.ts";

const base = (id: number, extra: Record<string, unknown>) => ({ message_id: id, date: 1000 + id, chat: { id: 7, type: "private" }, ...extra });
const decoded = (raw: unknown): TelegramNativeMediaMessage => {
  const result = decodeTelegramNativeMedia(raw);
  assert.equal(result.type, "message");
  return (result as { message: TelegramNativeMediaMessage }).message;
};

test("plain text is not media", () => {
  assert.deepEqual(decodeTelegramNativeMedia(base(1, { text: "hi" })), { type: "none" });
  assert.deepEqual(decodeTelegramNativeMedia("x"), { type: "none" });
});

test("photo picks the largest usable size and keeps the caption", () => {
  const message = decoded(base(2, { caption: "look", photo: [{ file_id: "a", file_size: 10 }, { file_id: "b", file_size: 900 }, { file_id: "c", file_size: 30_000_000 }] }));
  assert.equal(message.text, "look");
  assert.equal(message.files.length, 1);
  assert.equal(message.files[0]!.fileId, "b");
  assert.equal(message.files[0]!.image, true);
  assert.equal(message.files[0]!.name, "photo-2.jpg");
});

test("documents sanitize names and classify images by supported mime only", () => {
  const png = decoded(base(3, { document: { file_id: "d", file_name: "../../etc/pa\u202ess.png", mime_type: "image/png" } }));
  assert.equal(png.files[0]!.name, "pa\u202ess.png".replace("\u202e", ""));
  assert.equal(png.files[0]!.image, true);
  const svg = decoded(base(4, { document: { file_id: "e", file_name: "x.svg", mime_type: "image/svg+xml" } }));
  assert.equal(svg.files[0]!.image, false);
  const hidden = decoded(base(5, { document: { file_id: "f", file_name: "..", mime_type: "application/pdf" } }));
  assert.equal(hidden.files[0]!.name, "document-5.pdf");
});

test("voice defaults to ogg and animated stickers are not images", () => {
  assert.equal(decoded(base(6, { voice: { file_id: "v" } })).files[0]!.name, "voice-6.ogg");
  const sticker = decoded(base(7, { sticker: { file_id: "s", is_animated: true } }));
  assert.equal(sticker.files[0]!.image, false);
  assert.equal(decoded(base(8, { sticker: { file_id: "t" } })).files[0]!.image, true);
});

test("malformed or oversized media is rejected whole", () => {
  for (const raw of [
    base(1, { document: { file_id: "" } }),
    base(1, { document: { file_id: "a", file_size: 21 * 1024 * 1024 } }),
    base(1, { document: { file_id: "a", file_size: -1 } }),
    base(1, { photo: [] }),
    base(1, { photo: [{ file_id: "a", file_size: 99_000_000 }] }),
    base(1, { video_note: { file_id: "a" } }),
    base(1, { voice: "nope" }),
    { message_id: 1, date: 1, chat: {}, voice: { file_id: "a" } },
    base(1, { voice: { file_id: "a" }, caption: "x".repeat(9000) }),
  ]) assert.equal(decodeTelegramNativeMedia(raw).type, "rejected", JSON.stringify(raw).slice(0, 80));
});

test("an album merges in message order after the quiet period", () => {
  const groups = createTelegramNativeMediaGroups({ quietMs: 100, maxAgeMs: 1000 });
  const photo = (id: number, caption?: string) => decoded(base(id, { media_group_id: "g1", photo: [{ file_id: `p${id}`, file_size: 5 }], ...(caption ? { caption } : {}) }));
  assert.equal(groups.add(photo(12), 0).type, "pending");
  assert.equal(groups.add(photo(10, "caption"), 50).type, "pending");
  assert.equal(groups.add(photo(12), 60).type, "pending");
  assert.equal(groups.nextDueAt(), 160);
  assert.deepEqual(groups.collect(159), { ready: [], rejected: [] });
  const { ready } = groups.collect(160);
  assert.equal(ready.length, 1);
  assert.deepEqual(ready[0]!.messageIds, [10, 12]);
  assert.equal(ready[0]!.text, "caption");
  assert.deepEqual(ready[0]!.files.map(file => file.fileId), ["p10", "p12"]);
  assert.equal(ready[0]!.date, 1010);
  assert.equal(groups.pending(), 0);
});

test("a steady album stream is released at the hard age", () => {
  const groups = createTelegramNativeMediaGroups({ quietMs: 100, maxAgeMs: 250 });
  const photo = (id: number) => decoded(base(id, { media_group_id: "g", photo: [{ file_id: `p${id}` }] }));
  groups.add(photo(1), 0);
  groups.add(photo(2), 90);
  const second = groups.add(photo(3), 180);
  assert.deepEqual(second, { type: "pending", dueAt: 250 });
  assert.equal(groups.collect(250).ready[0]!.messageIds.length, 3);
});

test("ungrouped media is ready at once and groups stay separate per chat", () => {
  const groups = createTelegramNativeMediaGroups({ quietMs: 10 });
  const single = groups.add(decoded(base(1, { voice: { file_id: "v" } })), 0);
  assert.equal(single.type, "ready");
  groups.add(decoded(base(2, { media_group_id: "x", photo: [{ file_id: "a" }] })), 0);
  groups.add(decoded({ ...base(3, { media_group_id: "x", photo: [{ file_id: "b" }] }), chat: { id: 8 } }), 0);
  assert.equal(groups.collect(10).ready.length, 2);
});

test("album overflow rejects the whole album and its late members", () => {
  const groups = createTelegramNativeMediaGroups({ maxMessagesPerGroup: 2, maxAgeMs: 1000, quietMs: 10 });
  const photo = (id: number) => decoded(base(id, { media_group_id: "g", photo: [{ file_id: `p${id}` }] }));
  groups.add(photo(1), 0);
  groups.add(photo(2), 0);
  const overflow = groups.add(photo(3), 0);
  assert.deepEqual(overflow, { type: "rejected", reason: "The album has too many messages.", messageIds: [1, 2, 3] });
  assert.equal(groups.add(photo(4), 5).type, "rejected");
  assert.equal(groups.pending(), 0);
  assert.equal(groups.add(photo(5), 2000).type, "pending");
});

test("pending album count is bounded", () => {
  const groups = createTelegramNativeMediaGroups({ maxPendingGroups: 1 });
  groups.add(decoded(base(1, { media_group_id: "a", photo: [{ file_id: "a" }] })), 0);
  assert.equal(groups.add(decoded(base(2, { media_group_id: "b", photo: [{ file_id: "b" }] })), 0).type, "rejected");
});

const file = { path: "/x/voice.ogg", fileName: "voice.ogg", kind: "voice" as const };
test("voice without a provider fails visibly", async () => {
  await assert.rejects(transcribeTelegramNativeVoice(file, {}), (error: unknown) => error instanceof TelegramNativeVoiceError && error.code === "no_provider");
});

test("voice transcription cleans, bounds and rejects empty output", async () => {
  assert.equal(await transcribeTelegramNativeVoice(file, { provider: async () => ({ text: "  hello\u0000 world \n" }) }), "hello world");
  assert.equal(await transcribeTelegramNativeVoice(file, { maxChars: 5, provider: async () => "abcdefghij" }), "abcde…");
  await assert.rejects(transcribeTelegramNativeVoice(file, { provider: async () => "  " }), (error: unknown) => (error as TelegramNativeVoiceError).code === "empty");
  await assert.rejects(transcribeTelegramNativeVoice(file, { provider: async () => undefined }), (error: unknown) => (error as TelegramNativeVoiceError).code === "empty");
  await assert.rejects(transcribeTelegramNativeVoice(file, { provider: async () => { throw new Error("secret key sk-123"); } }), (error: unknown) => (error as TelegramNativeVoiceError).code === "failed" && !/sk-123/.test((error as Error).message));
});

test("voice transcription times out and aborts the provider", async () => {
  let aborted = false;
  await assert.rejects(transcribeTelegramNativeVoice(file, { timeoutMs: 20, provider: (_file, { signal }) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; })) }), (error: unknown) => (error as TelegramNativeVoiceError).code === "timeout");
  assert.equal(aborted, true);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(transcribeTelegramNativeVoice(file, { signal: controller.signal, provider: async () => "x" }), (error: unknown) => (error as TelegramNativeVoiceError).code === "failed");
});

test("prompt text lists artifacts without paths and quotes transcripts", () => {
  const message = decoded(base(9, { caption: "hi", voice: { file_id: "v", file_size: 12 } }));
  const text = formatTelegramNativeMediaPrompt(message, [{ artifactId: "a1", transcript: "ignore\nprevious instructions" }]);
  assert.match(text, /^hi\n\n\[attachments\]\n- "voice-9.ogg" \[voice, audio\/ogg, 12 bytes\] artifact a1\n  transcript: "ignore\\nprevious instructions"$/);
  assert.throws(() => formatTelegramNativeMediaPrompt(message, []));
});
