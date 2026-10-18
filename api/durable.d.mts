/** Native host public membrane.
 * Zones: native runtime, ownership, config, outbound rendering
 * No coding-agent runtime imports; acceptance and delivery ledgers belong to host.
 */
export { createTelegramLockRuntime, resolveTelegramLockKey, isProcessAlive } from './durable-types/lib/locks.js';
export { createTelegramConfigStore } from './durable-types/lib/config.js';
export { sendTelegramNativeMarkdownReply } from './durable-types/lib/replies.js';
export { createTelegramPreviewRuntimeState, flushTelegramPreview } from './durable-types/lib/preview.js';
export { normalizeTelegramNativeMarkdown } from './durable-types/lib/replies.js';
export { decodeTelegramNativeMedia, createTelegramNativeMediaGroups, transcribeTelegramNativeVoice, formatTelegramNativeMediaPrompt, TelegramNativeVoiceError, TELEGRAM_NATIVE_MEDIA_LIMITS, isTelegramNativeImageMimeType, sanitizeTelegramNativeFileName } from './durable-types/lib/native-media.js';
export type { TelegramNativeMediaFile, TelegramNativeMediaMessage, TelegramNativeMediaInput, TelegramNativeMediaLimits, TelegramNativeMediaDecode, TelegramNativeMediaGroupAdd, TelegramNativeMediaAnnotation, TelegramNativeVoiceFile, TelegramNativeVoiceProvider, TelegramNativeVoiceOptions, TelegramNativeMediaKind } from './durable-types/lib/native-media.js';
