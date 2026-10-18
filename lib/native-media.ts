/**
 * Native inbound media decoding, grouping, voice transcription and prompt text
 * Zones: telegram inbound, media groups, voice, native host
 * Owns strict validation of untrusted Telegram media messages and deterministic group assembly.
 * Pure: no filesystem, network, timers or global registries. The host supplies the clock, file bytes and providers.
 */

export type TelegramNativeMediaKind =
  | "photo"
  | "document"
  | "video"
  | "audio"
  | "voice"
  | "animation"
  | "sticker";

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

export const TELEGRAM_NATIVE_MEDIA_LIMITS: Readonly<TelegramNativeMediaLimits> =
  { maxFilesPerMessage: 10, maxFileBytes: 20 * 1024 * 1024, maxTextChars: 8192 };

export type TelegramNativeMediaDecode =
  | { type: "none" }
  | { type: "message"; message: TelegramNativeMediaMessage }
  | { type: "rejected"; reason: string };

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "video/mp4": ".mp4",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const positiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function isTelegramNativeImageMimeType(mimeType: string | undefined): boolean {
  return mimeType !== undefined && IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}

/** Reduce a Telegram file name to one safe base name. */
export function sanitizeTelegramNativeFileName(
  value: string | undefined,
  fallback: string,
): string {
  const base = (value ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}

function mimeOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const mime = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/.test(mime)
    ? mime
    : undefined;
}

function decodeFile(
  kind: TelegramNativeMediaKind,
  raw: Record<string, unknown>,
  messageId: number,
  limits: TelegramNativeMediaLimits,
  defaults: { name: string; mime?: string; image?: boolean },
): TelegramNativeMediaFile | string {
  const fileId = raw.file_id;
  if (typeof fileId !== "string" || fileId.length === 0 || fileId.length > 512)
    return `Invalid ${kind} file reference.`;
  const size = raw.file_size;
  if (size !== undefined && (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0))
    return `Invalid ${kind} size.`;
  if (size !== undefined && size > limits.maxFileBytes)
    return `The ${kind} is larger than the ${limits.maxFileBytes}-byte limit.`;
  const mimeType = defaults.mime ?? mimeOf(raw.mime_type);
  const extension = (mimeType && MIME_EXTENSIONS[mimeType]) ?? "";
  const fallback = `${defaults.name}${extension}`;
  const name = sanitizeTelegramNativeFileName(
    typeof raw.file_name === "string" ? raw.file_name : undefined,
    fallback,
  );
  const unique = raw.file_unique_id;
  return {
    kind,
    fileId,
    ...(typeof unique === "string" && unique.length > 0 && unique.length <= 128
      ? { fileUniqueId: unique }
      : {}),
    name,
    ...(mimeType ? { mimeType } : {}),
    ...(size === undefined ? {} : { declaredSize: size }),
    image: defaults.image ?? isTelegramNativeImageMimeType(mimeType),
    messageId,
  };
}

/**
 * Decode one raw private-chat message. Messages without media return `none` so the caller can use its text path.
 * Anything malformed or over a limit is rejected as a whole: a partial prompt is never produced.
 */
export function decodeTelegramNativeMedia(
  raw: unknown,
  limits: TelegramNativeMediaLimits = TELEGRAM_NATIVE_MEDIA_LIMITS,
): TelegramNativeMediaDecode {
  const message = record(raw);
  if (!message) return { type: "none" };
  const hasMedia = ["photo", "document", "video", "audio", "voice", "animation", "sticker", "video_note"]
    .some(key => message[key] !== undefined);
  if (!hasMedia && message.media_group_id === undefined) return { type: "none" };
  const messageId = message.message_id;
  const date = message.date;
  const chat = record(message.chat);
  if (!positiveInteger(messageId) || typeof date !== "number" || !Number.isSafeInteger(date) || date < 0 || typeof chat?.id !== "number" || !Number.isSafeInteger(chat.id))
    return { type: "rejected", reason: "Invalid media message identity." };
  if (message.video_note !== undefined)
    return { type: "rejected", reason: "Video notes are not supported." };
  if (message.media_group_id !== undefined && (typeof message.media_group_id !== "string" || message.media_group_id.length === 0 || message.media_group_id.length > 128))
    return { type: "rejected", reason: "Invalid media group identity." };
  const text = typeof message.caption === "string" ? message.caption : typeof message.text === "string" ? message.text : "";
  if (text.length > limits.maxTextChars)
    return { type: "rejected", reason: "The message text is too long." };
  const files: TelegramNativeMediaFile[] = [];
  const add = (value: TelegramNativeMediaFile | string): string | undefined => {
    if (typeof value === "string") return value;
    files.push(value);
    return undefined;
  };
  let failure: string | undefined;
  if (message.photo !== undefined) {
    if (!Array.isArray(message.photo) || message.photo.length === 0 || message.photo.length > 20)
      return { type: "rejected", reason: "Invalid photo sizes." };
    // The largest declared size wins. Sizes over the limit are skipped, so one usable rendition must remain.
    const sizes = message.photo.map(record);
    if (sizes.some(size => size === undefined)) return { type: "rejected", reason: "Invalid photo sizes." };
    const usable = (sizes as Record<string, unknown>[])
      .filter(size => typeof size.file_size !== "number" || size.file_size <= limits.maxFileBytes)
      .sort((a, b) => Number(a.file_size ?? 0) - Number(b.file_size ?? 0));
    const best = usable.pop();
    if (!best) return { type: "rejected", reason: "The photo is larger than the file limit." };
    failure ??= add(decodeFile("photo", best, messageId, limits, { name: `photo-${messageId}`, mime: "image/jpeg", image: true }));
  }
  for (const kind of ["document", "video", "audio", "voice", "animation"] as const) {
    const value = message[kind];
    if (value === undefined) continue;
    const item = record(value);
    if (!item) return { type: "rejected", reason: `Invalid ${kind}.` };
    failure ??= add(decodeFile(kind, item, messageId, limits, { name: `${kind}-${messageId}`, ...(kind === "voice" && mimeOf(item.mime_type) === undefined ? { mime: "audio/ogg" } : {}) }));
  }
  if (message.sticker !== undefined) {
    const item = record(message.sticker);
    if (!item) return { type: "rejected", reason: "Invalid sticker." };
    const animated = item.is_animated === true || item.is_video === true;
    failure ??= add(decodeFile("sticker", item, messageId, limits, {
      name: `sticker-${messageId}${item.is_animated === true ? ".tgs" : item.is_video === true ? ".webm" : ""}`,
      ...(animated ? { image: false } : { mime: "image/webp", image: true }),
    }));
  }
  if (failure) return { type: "rejected", reason: failure };
  if (files.length > limits.maxFilesPerMessage)
    return { type: "rejected", reason: "Too many files in one message." };
  if (files.length === 0) return { type: "none" };
  return {
    type: "message",
    message: {
      messageId,
      date,
      chatId: chat.id as number,
      ...(typeof message.media_group_id === "string" ? { mediaGroupId: message.media_group_id } : {}),
      text,
      files,
    },
  };
}

function mergeMessages(messages: readonly TelegramNativeMediaMessage[], limits: TelegramNativeMediaLimits): TelegramNativeMediaInput | string {
  const sorted = [...messages].sort((a, b) => a.messageId - b.messageId);
  const texts: string[] = [];
  for (const message of sorted)
    if (message.text.length > 0 && !texts.includes(message.text)) texts.push(message.text);
  const text = texts.join("\n\n");
  if (text.length > limits.maxTextChars) return "The group text is too long.";
  return {
    chatId: sorted[0]!.chatId,
    messageIds: sorted.map(message => message.messageId),
    date: Math.min(...sorted.map(message => message.date)),
    text,
    files: sorted.flatMap(message => message.files),
  };
}

export interface TelegramNativeMediaGroupOptions {
  /** Quiet period after the last message of a group. Default 1200 ms, the legacy debounce. */
  quietMs?: number;
  /** Hard age from the first message. Default 10 s. */
  maxAgeMs?: number;
  maxMessagesPerGroup?: number;
  maxPendingGroups?: number;
  limits?: TelegramNativeMediaLimits;
}

export type TelegramNativeMediaGroupAdd =
  | { type: "ready"; input: TelegramNativeMediaInput }
  | { type: "pending"; dueAt: number }
  | { type: "rejected"; reason: string; messageIds: number[] };

interface PendingGroup {
  messages: Map<number, TelegramNativeMediaMessage>;
  firstAt: number;
  lastAt: number;
}

/**
 * Deterministic album assembler. A message without a group id is ready at once. The host owns the timer: it calls
 * `collect(now)` at or after `nextDueAt()`, and must keep the Telegram offset unacknowledged for pending messages
 * (or persist them) so a crash replays the whole album.
 */
export function createTelegramNativeMediaGroups(options: TelegramNativeMediaGroupOptions = {}) {
  const quietMs = options.quietMs ?? 1200;
  const maxAgeMs = options.maxAgeMs ?? 10_000;
  const maxMessages = options.maxMessagesPerGroup ?? 10;
  const maxGroups = options.maxPendingGroups ?? 16;
  const limits = options.limits ?? TELEGRAM_NATIVE_MEDIA_LIMITS;
  const groups = new Map<string, PendingGroup>();
  const poisoned = new Map<string, number>();
  const dueAt = (group: PendingGroup) => Math.min(group.lastAt + quietMs, group.firstAt + maxAgeMs);
  const key = (message: TelegramNativeMediaMessage) => `${message.chatId}:${message.mediaGroupId}`;
  return {
    add(message: TelegramNativeMediaMessage, now: number): TelegramNativeMediaGroupAdd {
      if (message.mediaGroupId === undefined) {
        const merged = mergeMessages([message], limits);
        return typeof merged === "string" ? { type: "rejected", reason: merged, messageIds: [message.messageId] } : { type: "ready", input: merged };
      }
      const groupKey = key(message);
      const until = poisoned.get(groupKey);
      if (until !== undefined && until > now)
        return { type: "rejected", reason: "This album was rejected.", messageIds: [message.messageId] };
      let group = groups.get(groupKey);
      if (!group) {
        if (groups.size >= maxGroups)
          return { type: "rejected", reason: "Too many albums are pending.", messageIds: [message.messageId] };
        group = { messages: new Map(), firstAt: now, lastAt: now };
        groups.set(groupKey, group);
      }
      if (!group.messages.has(message.messageId)) {
        if (group.messages.size >= maxMessages) {
          const ids = [...group.messages.keys(), message.messageId].sort((a, b) => a - b);
          groups.delete(groupKey);
          poisoned.set(groupKey, now + maxAgeMs);
          return { type: "rejected", reason: "The album has too many messages.", messageIds: ids };
        }
        group.messages.set(message.messageId, message);
      }
      group.lastAt = now;
      return { type: "pending", dueAt: dueAt(group) };
    },
    /** Remove and return every group whose quiet period or age limit has passed. */
    collect(now: number): { ready: TelegramNativeMediaInput[]; rejected: { reason: string; messageIds: number[] }[] } {
      const ready: TelegramNativeMediaInput[] = [];
      const rejected: { reason: string; messageIds: number[] }[] = [];
      for (const [groupKey, group] of groups) {
        if (dueAt(group) > now) continue;
        groups.delete(groupKey);
        const merged = mergeMessages([...group.messages.values()], limits);
        if (typeof merged === "string") rejected.push({ reason: merged, messageIds: [...group.messages.keys()].sort((a, b) => a - b) });
        else ready.push(merged);
      }
      for (const [groupKey, until] of poisoned) if (until <= now) poisoned.delete(groupKey);
      ready.sort((a, b) => a.messageIds[0]! - b.messageIds[0]!);
      return { ready, rejected };
    },
    nextDueAt(): number | undefined {
      let next: number | undefined;
      for (const group of groups.values()) next = next === undefined ? dueAt(group) : Math.min(next, dueAt(group));
      return next;
    },
    pending(): number { return groups.size; },
  };
}

// --- Voice ---

export interface TelegramNativeVoiceFile {
  path: string;
  fileName: string;
  mimeType?: string;
  kind: "voice" | "audio";
}

export type TelegramNativeVoiceProvider = (
  file: TelegramNativeVoiceFile,
  options: { signal: AbortSignal },
) => Promise<string | { text: string; language?: string } | undefined>;

export class TelegramNativeVoiceError extends Error {
  readonly code: "no_provider" | "empty" | "timeout" | "failed";
  constructor(code: TelegramNativeVoiceError["code"], message: string) {
    super(message);
    this.name = "TelegramNativeVoiceError";
    this.code = code;
  }
}

export interface TelegramNativeVoiceOptions {
  /** Absent when no provider is configured: voice input then fails visibly instead of being dropped. */
  provider?: TelegramNativeVoiceProvider;
  timeoutMs?: number;
  maxChars?: number;
  signal?: AbortSignal;
}

/** Transcribe one voice or audio file within a deadline. Throws `TelegramNativeVoiceError` and never returns empty text. */
export async function transcribeTelegramNativeVoice(
  file: TelegramNativeVoiceFile,
  options: TelegramNativeVoiceOptions,
): Promise<string> {
  const provider = options.provider;
  if (!provider) throw new TelegramNativeVoiceError("no_provider", "Voice transcription is not configured.");
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const abort = () => controller.abort();
  if (options.signal?.aborted) throw new TelegramNativeVoiceError("failed", "Voice transcription was aborted.");
  options.signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new TelegramNativeVoiceError("timeout", "Voice transcription timed out.")); controller.abort(); }, timeoutMs);
    });
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new TelegramNativeVoiceError("failed", "Voice transcription was aborted.")), { once: true });
    });
    let result: Awaited<ReturnType<TelegramNativeVoiceProvider>>;
    try {
      result = await Promise.race([provider(file, { signal: controller.signal }), timeout, aborted]);
    } catch (error) {
      if (error instanceof TelegramNativeVoiceError) throw error;
      throw new TelegramNativeVoiceError("failed", "Voice transcription failed.");
    }
    const raw = typeof result === "string" ? result : result?.text;
    // eslint-disable-next-line no-control-regex
    const text = (typeof raw === "string" ? raw : "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    if (text.length === 0) throw new TelegramNativeVoiceError("empty", "The voice message had no recognizable speech.");
    const max = options.maxChars ?? 8000;
    return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

// --- Prompt text ---

export interface TelegramNativeMediaAnnotation {
  /** Host artifact identifier. Never a filesystem path. */
  artifactId: string;
  /** The bytes are attached to this prompt as a native image. */
  imageAttached?: boolean;
  transcript?: string;
}

/** Render the text block of a media turn. Annotations align with `input.files`. */
export function formatTelegramNativeMediaPrompt(
  input: Pick<TelegramNativeMediaInput, "text" | "files">,
  annotations: readonly TelegramNativeMediaAnnotation[],
): string {
  if (annotations.length !== input.files.length)
    throw new Error("Media annotations do not match the files.");
  const lines: string[] = [];
  input.files.forEach((file, index) => {
    const note = annotations[index]!;
    const attributes = [file.kind, file.mimeType, file.declaredSize === undefined ? undefined : `${file.declaredSize} bytes`].filter(Boolean).join(", ");
    const suffix = note.imageAttached ? " (image attached)" : file.kind === "voice" || file.kind === "audio" ? "" : " (content not read)";
    lines.push(`- ${JSON.stringify(file.name)} [${attributes}] artifact ${note.artifactId}${suffix}`);
    if (note.transcript !== undefined) lines.push(`  transcript: ${JSON.stringify(note.transcript)}`);
  });
  const header = input.text.length > 0 ? input.text : "(no text)";
  return lines.length === 0 ? header : `${header}\n\n[attachments]\n${lines.join("\n")}`;
}
