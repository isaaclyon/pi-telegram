/** Native host public membrane.
 * Zones: native runtime, ownership, config, outbound rendering
 * No coding-agent runtime imports; acceptance and delivery ledgers belong to host.
 */
export { createTelegramLockRuntime, resolveTelegramLockKey, isProcessAlive } from '../lib/locks.js';
export { createTelegramConfigStore } from '../lib/config.js';
export { sendTelegramNativeMarkdownReply } from '../lib/replies.js';
export { createTelegramPreviewRuntimeState, flushTelegramPreview } from '../lib/preview.js';
export { normalizeTelegramNativeMarkdown } from '../lib/replies.js';
