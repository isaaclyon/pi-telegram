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
// Inbound media: strict decoding, album grouping, bounded voice transcription and prompt text. Bytes and storage belong to the host.
export { decodeTelegramNativeMedia, createTelegramNativeMediaGroups, transcribeTelegramNativeVoice, formatTelegramNativeMediaPrompt, TelegramNativeVoiceError, TELEGRAM_NATIVE_MEDIA_LIMITS, isTelegramNativeImageMimeType, sanitizeTelegramNativeFileName } from '../lib/native-media.ts';
export type { TelegramNativeMediaFile, TelegramNativeMediaMessage, TelegramNativeMediaInput, TelegramNativeMediaLimits, TelegramNativeMediaDecode, TelegramNativeMediaGroupAdd, TelegramNativeMediaAnnotation, TelegramNativeVoiceFile, TelegramNativeVoiceProvider, TelegramNativeVoiceOptions, TelegramNativeMediaKind } from '../lib/native-media.ts';
