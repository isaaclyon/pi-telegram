/**
 * Native inbound media decoding, grouping, voice transcription and prompt text
 * Zones: telegram inbound, media groups, voice, native host
 * Owns strict validation of untrusted Telegram media messages and deterministic group assembly.
 * Pure: no filesystem, network, timers or global registries. The host supplies the clock, file bytes and providers.
 */
export type TelegramNativeMediaKind = "photo" | "document" | "video" | "audio" | "voice" | "animation" | "sticker";
export interface TelegramNativeMediaFile {
    kind: TelegramNativeMediaKind;
    fileId: string;
    fileUniqueId?: string;
    /** Sanitized base name; never a path. */
    name: string;
    mimeType?: string;
    /** Size declared by Telegram. The host must still bound the bytes it downloads. */
    declaredSize?: number;
    /** True only for formats a model can take as an image. */
    image: boolean;
    messageId: number;
}
export interface TelegramNativeMediaMessage {
    messageId: number;
    /** Seconds since the epoch, as Telegram sends it. */
    date: number;
    chatId: number;
    mediaGroupId?: string;
    text: string;
    files: TelegramNativeMediaFile[];
}
export interface TelegramNativeMediaInput {
    chatId: number;
    /** Ascending, unique. */
    messageIds: number[];
    /** Earliest message date in seconds. */
    date: number;
    text: string;
    files: TelegramNativeMediaFile[];
}
export interface TelegramNativeMediaLimits {
    maxFilesPerMessage: number;
    maxFileBytes: number;
    maxTextChars: number;
}
export declare const TELEGRAM_NATIVE_MEDIA_LIMITS: Readonly<TelegramNativeMediaLimits>;
export type TelegramNativeMediaDecode = {
    type: "none";
} | {
    type: "message";
    message: TelegramNativeMediaMessage;
} | {
    type: "rejected";
    reason: string;
};
export declare function isTelegramNativeImageMimeType(mimeType: string | undefined): boolean;
/** Reduce a Telegram file name to one safe base name. */
export declare function sanitizeTelegramNativeFileName(value: string | undefined, fallback: string): string;
/**
 * Decode one raw private-chat message. Messages without media return `none` so the caller can use its text path.
 * Anything malformed or over a limit is rejected as a whole: a partial prompt is never produced.
 */
export declare function decodeTelegramNativeMedia(raw: unknown, limits?: TelegramNativeMediaLimits): TelegramNativeMediaDecode;
export interface TelegramNativeMediaGroupOptions {
    /** Quiet period after the last message of a group. Default 1200 ms, the legacy debounce. */
    quietMs?: number;
    /** Hard age from the first message. Default 10 s. */
    maxAgeMs?: number;
    maxMessagesPerGroup?: number;
    maxPendingGroups?: number;
    limits?: TelegramNativeMediaLimits;
}
export type TelegramNativeMediaGroupAdd = {
    type: "ready";
    input: TelegramNativeMediaInput;
} | {
    type: "pending";
    dueAt: number;
} | {
    type: "rejected";
    reason: string;
    messageIds: number[];
};
/**
 * Deterministic album assembler. A message without a group id is ready at once. The host owns the timer: it calls
 * `collect(now)` at or after `nextDueAt()`, and must keep the Telegram offset unacknowledged for pending messages
 * (or persist them) so a crash replays the whole album.
 */
export declare function createTelegramNativeMediaGroups(options?: TelegramNativeMediaGroupOptions): {
    add(message: TelegramNativeMediaMessage, now: number): TelegramNativeMediaGroupAdd;
    /** Remove and return every group whose quiet period or age limit has passed. */
    collect(now: number): {
        ready: TelegramNativeMediaInput[];
        rejected: {
            reason: string;
            messageIds: number[];
        }[];
    };
    nextDueAt(): number | undefined;
    pending(): number;
};
export interface TelegramNativeVoiceFile {
    path: string;
    fileName: string;
    mimeType?: string;
    kind: "voice" | "audio";
}
export type TelegramNativeVoiceProvider = (file: TelegramNativeVoiceFile, options: {
    signal: AbortSignal;
}) => Promise<string | {
    text: string;
    language?: string;
} | undefined>;
export declare class TelegramNativeVoiceError extends Error {
    readonly code: "no_provider" | "empty" | "timeout" | "failed";
    constructor(code: TelegramNativeVoiceError["code"], message: string);
}
export interface TelegramNativeVoiceOptions {
    /** Absent when no provider is configured: voice input then fails visibly instead of being dropped. */
    provider?: TelegramNativeVoiceProvider;
    timeoutMs?: number;
    maxChars?: number;
    signal?: AbortSignal;
}
/** Transcribe one voice or audio file within a deadline. Throws `TelegramNativeVoiceError` and never returns empty text. */
export declare function transcribeTelegramNativeVoice(file: TelegramNativeVoiceFile, options: TelegramNativeVoiceOptions): Promise<string>;
export interface TelegramNativeMediaAnnotation {
    /** Host artifact identifier. Never a filesystem path. */
    artifactId: string;
    /** The bytes are attached to this prompt as a native image. */
    imageAttached?: boolean;
    transcript?: string;
}
/** Render the text block of a media turn. Annotations align with `input.files`. */
export declare function formatTelegramNativeMediaPrompt(input: Pick<TelegramNativeMediaInput, "text" | "files">, annotations: readonly TelegramNativeMediaAnnotation[]): string;
