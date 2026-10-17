/**
 * Telegram reply delivery helpers
 * Zones: telegram outbound, native rich markdown, UI/compat rendering transport
 * Owns native assistant replies, rendered UI delivery, reply transport wiring, and plain text replies
 */
import { type TelegramTarget } from "./target.js";
import type { TelegramInputRichMessage, TelegramReplyParameters, TelegramSendRichMessageBody, TelegramSentMessage } from "./telegram-api.js";
import { renderTelegramMessage, type TelegramRenderedChunk, type TelegramRenderMode } from "./rendering.js";
export { renderTelegramMessage, type TelegramRenderedChunk, type TelegramRenderMode, };
export declare function renderTelegramMarkdownToHtmlDraft(markdown: string): string;
export declare const TELEGRAM_RICH_MESSAGE_MAX_CHARS = 32768;
export declare const TELEGRAM_RICH_MESSAGE_MAX_BLOCKS = 500;
/** Non-persistent reply deduplication for a single agent turn.
 *  First reply to a prompt gets `reply_parameters.message_id`;
 *  subsequent replies in the same turn skip it to avoid stacking
 *  duplicate reply headers in the chat viewport. */
export interface ReplyDedupRuntime {
    /** Returns true if this is the first reply for the given prompt
     *  message id in the current turn. Side-effect: marks it replied. */
    shouldReply(promptMessageId: number): boolean;
    /** Reset the tracker when a new prompt enters the queue. */
    reset(): void;
}
export declare function createReplyDedupRuntime(): ReplyDedupRuntime;
export declare function resetTransportReplyDedup(): void;
export declare function buildTelegramReplyParameters(chatId: number, messageId: number | undefined, target?: TelegramTarget): TelegramReplyParameters | undefined;
export declare function buildTelegramMultipartReplyParameters(chatId: number, messageId: number | undefined, target?: TelegramTarget): string | undefined;
export declare function isAssistantAgentMessage(message: unknown): boolean;
export declare function getAgentMessageText(message: unknown): string;
export declare function extractLatestAssistantMessageText(messages: readonly unknown[]): {
    text?: string;
    stopReason?: string;
    errorMessage?: string;
};
export interface TelegramReplyOwnershipRecorder {
    record: (input: {
        chatId: number;
        messageId: number;
        target?: TelegramTarget;
    }) => void;
}
export interface TelegramReplyDeliveryDeps<TReplyMarkup> {
    recordOwnership?: TelegramReplyOwnershipRecorder["record"];
    sendMessage: (body: {
        chat_id: number;
        text: string;
        parse_mode?: "HTML";
        reply_markup?: TReplyMarkup;
        reply_parameters?: TelegramReplyParameters;
        reply_to_message_id?: number;
        message_thread_id?: number;
    }) => Promise<TelegramSentMessage>;
    editMessage: (body: {
        chat_id: number;
        message_id: number;
        text?: string;
        rich_message?: TelegramInputRichMessage;
        parse_mode?: "HTML";
        reply_markup?: TReplyMarkup;
        message_thread_id?: number;
    }) => Promise<unknown>;
}
export interface TelegramReplyTargetOptions {
    target?: TelegramTarget;
    replyToMessageId?: number;
}
export interface TelegramReplyTransport<TReplyMarkup> {
    sendRenderedChunks: (chatId: number, chunks: TelegramRenderedChunk[], options?: TelegramReplyTargetOptions & {
        replyMarkup?: TReplyMarkup;
    }) => Promise<number | undefined>;
    editRenderedMessage: (chatId: number, messageId: number, chunks: TelegramRenderedChunk[], options?: TelegramReplyTargetOptions & {
        replyMarkup?: TReplyMarkup;
    }) => Promise<number | undefined>;
}
export declare function buildTelegramReplyTransport<TReplyMarkup>(deps: TelegramReplyDeliveryDeps<TReplyMarkup>): TelegramReplyTransport<TReplyMarkup>;
export declare function sendTelegramRenderedChunks<TReplyMarkup>(chatId: number, chunks: TelegramRenderedChunk[], deps: TelegramReplyDeliveryDeps<TReplyMarkup>, options?: TelegramReplyTargetOptions & {
    replyMarkup?: TReplyMarkup;
}): Promise<number | undefined>;
export declare function editTelegramRenderedMessage<TReplyMarkup>(chatId: number, messageId: number, chunks: TelegramRenderedChunk[], deps: TelegramReplyDeliveryDeps<TReplyMarkup>, options?: TelegramReplyTargetOptions & {
    replyMarkup?: TReplyMarkup;
}): Promise<number | undefined>;
export interface TelegramTextReplyOptions extends TelegramReplyTargetOptions {
    parseMode?: "HTML";
}
export interface TelegramReplyRuntimeDeps<TReplyMarkup = unknown> {
    renderTelegramMessage: (text: string, options?: {
        mode?: TelegramRenderMode;
    }) => TelegramRenderedChunk[];
    sendRenderedChunks: (chunks: TelegramRenderedChunk[], options?: {
        replyMarkup?: TReplyMarkup;
    } & TelegramReplyTargetOptions) => Promise<number | undefined>;
}
export declare function sendTelegramPlainReply(text: string, deps: TelegramReplyRuntimeDeps, options?: TelegramTextReplyOptions): Promise<number | undefined>;
export declare function normalizeTelegramNativeMarkdown(markdown: string): string;
export declare function splitTelegramNativeMarkdown(markdown: string): string[];
export declare function sendTelegramNativeMarkdownReply<TReplyMarkup = unknown>(chatId: number, replyToMessageId: number | undefined, markdown: string, deps: {
    recordOwnership?: TelegramReplyOwnershipRecorder["record"];
    sendRichMessage: (body: TelegramSendRichMessageBody) => Promise<TelegramSentMessage>;
}, options?: TelegramReplyTargetOptions & {
    replyMarkup?: TReplyMarkup;
}): Promise<number | undefined>;
export type TelegramAssistantRenderingMode = "rich" | "html";
export interface TelegramRenderedMessageRuntimeDeps<TReplyMarkup> {
    renderTelegramMessage: (text: string, options?: {
        mode?: TelegramRenderMode;
    }) => TelegramRenderedChunk[];
    replyTransport: TelegramReplyTransport<TReplyMarkup>;
    recordOwnership?: TelegramReplyOwnershipRecorder["record"];
    getAssistantRenderingMode?: () => TelegramAssistantRenderingMode;
    sendRichMessage: (body: TelegramSendRichMessageBody) => Promise<TelegramSentMessage>;
}
export interface TelegramRenderedMessageRuntime<TReplyMarkup> {
    sendTextReply: (chatId: number, replyToMessageId: number | undefined, text: string, options?: TelegramTextReplyOptions) => Promise<number | undefined>;
    sendMarkdownReply: (chatId: number, replyToMessageId: number | undefined, markdown: string, options?: TelegramReplyTargetOptions & {
        replyMarkup?: TReplyMarkup;
    }) => Promise<number | undefined>;
    editInteractiveMessage: (chatId: number, messageId: number, text: string, mode: TelegramRenderMode, replyMarkup: TReplyMarkup) => Promise<void>;
    sendInteractiveMessage: (chatId: number, text: string, mode: TelegramRenderMode, replyMarkup: TReplyMarkup, options?: TelegramReplyTargetOptions) => Promise<number | undefined>;
}
export interface TelegramRenderedMessageDeliveryRuntime<TReplyMarkup> extends TelegramRenderedMessageRuntime<TReplyMarkup> {
    replyTransport: TelegramReplyTransport<TReplyMarkup>;
}
export interface TelegramRenderedMessageDeliveryRuntimeDeps<TReplyMarkup> extends TelegramReplyDeliveryDeps<TReplyMarkup> {
    renderTelegramMessage?: (text: string, options?: {
        mode?: TelegramRenderMode;
    }) => TelegramRenderedChunk[];
    getAssistantRenderingMode?: () => TelegramAssistantRenderingMode;
    sendRichMessage: (body: TelegramSendRichMessageBody) => Promise<TelegramSentMessage>;
}
export declare function createTelegramRenderedMessageDeliveryRuntime<TReplyMarkup>(deps: TelegramRenderedMessageDeliveryRuntimeDeps<TReplyMarkup>): TelegramRenderedMessageDeliveryRuntime<TReplyMarkup>;
export declare function createTelegramRenderedMessageRuntime<TReplyMarkup>(deps: TelegramRenderedMessageRuntimeDeps<TReplyMarkup>): TelegramRenderedMessageRuntime<TReplyMarkup>;
/** Wrap a sendTextReply with reply dedup so only the first message
 *  in a turn carries reply metadata. */
export declare function dedupSendTextReply(dedup: ReplyDedupRuntime, inner: (chatId: number, replyToMessageId: number | undefined, text: string, options?: TelegramTextReplyOptions) => Promise<number | undefined>): (chatId: number, replyToMessageId: number, text: string, options?: TelegramTextReplyOptions) => Promise<number | undefined>;
/** Wrap a sendMarkdownReply with reply dedup. */
export declare function dedupSendMarkdownReply<TReplyMarkup = unknown>(dedup: ReplyDedupRuntime, inner: (chatId: number, replyToMessageId: number | undefined, markdown: string, options?: {
    replyMarkup?: TReplyMarkup;
}) => Promise<number | undefined>): (chatId: number, replyToMessageId: number, markdown: string, options?: {
    replyMarkup?: TReplyMarkup;
}) => Promise<number | undefined>;
/**
 * Guest reply sender: answers guest queries with native Rich Markdown content.
 * Guest queries use InlineQueryResult input_message_content rather than chat
 * sendRichMessage, so this stays as a dedicated guest transport adapter.
 */
export declare function createGuestMarkdownReplySender(deps: {
    answerGuestQuery: (guestQueryId: string, text?: string, options?: {
        parseMode?: string;
        richMessage?: TelegramInputRichMessage;
    }) => Promise<void>;
}): (guestQueryId: string, markdown: string) => Promise<void>;
