/** Native host public membrane.
 * Zones: native runtime, ownership, config, outbound rendering
 * No coding-agent runtime imports; acceptance and delivery ledgers belong to host.
 */
export { createTelegramLockRuntime, resolveTelegramLockKey, isProcessAlive } from '../lib/locks.js';
export { createTelegramConfigStore } from '../lib/config.js';
export { sendTelegramNativeMarkdownReply } from '../lib/replies.js';
export { createTelegramPreviewRuntimeState, flushTelegramPreview } from '../lib/preview.js';
export { normalizeTelegramNativeMarkdown } from '../lib/replies.js';
export { decodeTelegramNativeMedia, createTelegramNativeMediaGroups, transcribeTelegramNativeVoice, formatTelegramNativeMediaPrompt, TelegramNativeVoiceError, TELEGRAM_NATIVE_MEDIA_LIMITS, isTelegramNativeImageMimeType, sanitizeTelegramNativeFileName } from '../lib/native-media.js';
export type { TelegramNativeMediaFile, TelegramNativeMediaMessage, TelegramNativeMediaInput, TelegramNativeMediaLimits, TelegramNativeMediaDecode, TelegramNativeMediaGroupAdd, TelegramNativeMediaAnnotation, TelegramNativeVoiceFile, TelegramNativeVoiceProvider, TelegramNativeVoiceOptions, TelegramNativeMediaKind } from '../lib/native-media.js';
