/** Native host public membrane.
 * Zones: native runtime, ownership, config, outbound rendering
 * No coding-agent runtime imports; acceptance and delivery ledgers belong to host.
 */
export { createTelegramLockRuntime, resolveTelegramLockKey, isProcessAlive } from '../lib/locks.ts';
export { createTelegramConfigStore } from '../lib/config.ts';
export { sendTelegramNativeMarkdownReply } from '../lib/replies.ts';
export { createTelegramPreviewRuntimeState, flushTelegramPreview } from '../lib/preview.ts';
// One host-ledger segment is one external effect. Chunking belongs to the host.
export { normalizeTelegramNativeMarkdown } from '../lib/replies.ts';
