/** Prototype composition only; not loaded by the production extension.
 * Zones: experimental runtime port, target-scoped transport, native rendering
 * The host owns durable admission and input recovery. No token/client fallback exists.
 */
import { createTelegramLockRuntime } from '../lib/locks.ts';
import { createTelegramPreviewRuntimeState, flushTelegramPreview } from '../lib/preview.ts';
import { buildTelegramReplyTransport, sendTelegramNativeMarkdownReply } from '../lib/replies.ts';
import { renderTelegramMessage } from '../lib/rendering.ts';
import { createTelegramExtensionSectionRegistry, openTelegramSection, parseTelegramSectionCallback, handleTelegramSectionCallback } from '../lib/sections.ts';

export function createDurableTelegramPrototype({ target, actorId, transport, runtime, ownership }) {
  if (!ownership?.cwd) throw new Error('Explicit prototype cwd required');
  if (!ownership?.locksPath) throw new Error('Explicit prototype locksPath required');
  if (!transport || typeof transport.call !== 'function') throw new Error('Explicit transport required');
  const destination = Object.freeze({ ...target });
  const lock = createTelegramLockRuntime(ownership);
  const context = { cwd: ownership.cwd };
  const sections = createTelegramExtensionSectionRegistry();
  let connected = false;
  let active = false;
  let draft = 0;
  const call = (method, body) => transport.call(method, body);
  const authorized = (input) => connected && lock.owns(context) && input.actorId === actorId && input.target.chatId === destination.chatId && input.target.threadId === destination.threadId;
  const rendered = buildTelegramReplyTransport({
    sendMessage: body => call('sendMessage', body),
    editMessage: body => call('editMessageText', body),
  });
  const sectionDeps = {
    target: destination,
    answerCallbackQuery: (id, text) => call('answerCallbackQuery', { callback_query_id: id, text }),
    editInteractiveMessage: (chatId, messageId, text, mode, replyMarkup) => rendered.editRenderedMessage(chatId, messageId, renderTelegramMessage(text, { mode }), { target: destination, replyMarkup }),
    sendInteractiveMessage: (chatId, text, mode, replyMarkup) => rendered.sendRenderedChunks(chatId, renderTelegramMessage(text, { mode }), { target: destination, replyMarkup }),
    enqueuePrompt: async () => { throw new Error('Prototype sections are direct-only'); },
    deleteMessage: (chatId, messageId) => call('deleteMessage', { chat_id: chatId, message_id: messageId }),
  };
  return {
    sections,
    connect() { const result = lock.acquire(context); connected = result.ok; return result; },
    disconnect() { connected = false; if (lock.owns(context)) lock.release(); },
    async receive(input) {
      if (!authorized(input)) return { accepted: false };
      if (active) throw new Error('Host must serialize prototype turns');
      active = true;
      // Copy identity before asynchronous runtime work; callers cannot reroute it.
      const admitted = structuredClone(input);
      let state = createTelegramPreviewRuntimeState();
      const deps = {
        getState: () => state, setState: (next) => { state = next; },
        maxMessageLength: 4096, getDraftSupport: () => 'supported', setDraftSupport() {}, allocateDraftId: () => ++draft,
        sendDraft: (chatId, draftId, text, options) => call('sendRichMessageDraft', { chat_id: chatId, draft_id: draftId, rich_message: { markdown: text, skip_entity_detection: true }, ...options }),
      };
      try {
        const answer = await runtime.run(admitted, async (text) => {
          state.pendingText = text;
          await flushTelegramPreview(destination.chatId, deps, { target: destination });
        });
        if (state.flushPromise) await state.flushPromise;
        await sendTelegramNativeMarkdownReply(destination.chatId, admitted.messageId, answer, { sendRichMessage: (body) => call('sendRichMessage', body) }, { target: destination });
        return { accepted: true };
      } finally { active = false; }
    },
    async open(sectionId) {
      if (!connected || !lock.owns(context)) throw new Error('Not transport owner');
      await openTelegramSection(sections, sectionId, destination.chatId, sectionDeps);
    },
    async callback(input) {
      if (!authorized(input)) return false;
      const parsed = parseTelegramSectionCallback(input.data);
      if (!parsed) return false;
      return handleTelegramSectionCallback(sections, parsed.token, parsed.action, parsed.payload, destination.chatId, input.messageId, input.callbackId, sectionDeps);
    },
  };
}
