/** Native host public membrane.
 * Zones: native runtime, ownership, config, outbound rendering
 * No coding-agent runtime imports; acceptance and delivery ledgers belong to host.
 */
export { createTelegramLockRuntime, resolveTelegramLockKey, isProcessAlive } from './durable-types/lib/locks.js';
export { createTelegramConfigStore } from './durable-types/lib/config.js';
export { sendTelegramNativeMarkdownReply } from './durable-types/lib/replies.js';
export { createTelegramPreviewRuntimeState, flushTelegramPreview } from './durable-types/lib/preview.js';
export { normalizeTelegramNativeMarkdown } from './durable-types/lib/replies.js';
