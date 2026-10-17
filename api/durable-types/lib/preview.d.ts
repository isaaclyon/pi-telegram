/**
 * Telegram preview streaming helpers
 * Zones: telegram outbound, native rich markdown drafts
 * Owns safe draft preview selection, runtime updates, and preview finalization
 */
import { type TelegramTarget } from "./target.js";
export type TelegramDraftSupport = "unknown" | "supported";
export interface TelegramPreviewState {
    mode: "draft";
    draftId?: number;
    pendingText: string;
    lastSentText: string;
}
export interface TelegramPreviewRuntimeState extends TelegramPreviewState {
    flushPromise?: Promise<void>;
    flushRequested?: boolean;
}
export type TelegramPreviewReplyMarkup = unknown;
export interface TelegramPreviewRuntimeDeps {
    getState: () => TelegramPreviewRuntimeState | undefined;
    setState: (state: TelegramPreviewRuntimeState | undefined) => void;
    maxMessageLength: number;
    getDraftSupport: () => TelegramDraftSupport;
    setDraftSupport: (support: TelegramDraftSupport) => void;
    allocateDraftId: () => number;
    sendDraft: (chatId: number, draftId: number, text?: string, options?: {
        parse_mode?: string;
        entities?: unknown[];
        message_thread_id?: number;
    }) => Promise<unknown>;
    canSend?: () => boolean;
    recordRuntimeEvent?: (category: string, error: unknown, details?: Record<string, unknown>) => void;
}
export interface TelegramPreviewActiveTurn {
    chatId: number;
    replyToMessageId?: number;
    target?: TelegramTarget;
    voiceReplyPreferred?: boolean;
    voiceReplyRequired?: boolean;
}
export interface TelegramAssistantMessagePreviewStartDeps<TMessage, TReplyMarkup = TelegramPreviewReplyMarkup> {
    getActiveTurn: () => TelegramPreviewActiveTurn | undefined;
    isAssistantMessage: (message: TMessage) => boolean;
    getState: () => TelegramPreviewRuntimeState | undefined;
    setState: (state: TelegramPreviewRuntimeState | undefined) => void;
    createPreviewState: () => TelegramPreviewRuntimeState;
    canSend?: () => boolean;
    finalizePreview: (chatId: number) => Promise<boolean>;
    finalizeMarkdownPreview: (chatId: number, markdown: string, replyToMessageId?: number, options?: {
        replyMarkup?: TReplyMarkup;
        target?: TelegramTarget;
    }) => Promise<boolean>;
}
export interface TelegramAssistantMessagePreviewUpdateDeps<TMessage> {
    getActiveTurn: () => TelegramPreviewActiveTurn | undefined;
    isAssistantMessage: (message: TMessage) => boolean;
    getState: () => TelegramPreviewRuntimeState | undefined;
    setState: (state: TelegramPreviewRuntimeState | undefined) => void;
    createPreviewState: () => TelegramPreviewRuntimeState;
    canSend?: () => boolean;
    getMessageText: (message: TMessage) => string;
    schedulePreviewFlush: (chatId: number, options?: {
        target?: TelegramTarget;
    }) => void;
}
export type TelegramAssistantMessagePreviewHookDeps<TMessage, TReplyMarkup = TelegramPreviewReplyMarkup> = TelegramAssistantMessagePreviewStartDeps<TMessage, TReplyMarkup> & TelegramAssistantMessagePreviewUpdateDeps<TMessage>;
export interface TelegramAssistantMessagePreviewHookEvent<TMessage> {
    message: TMessage;
}
export interface TelegramAssistantMessagePreviewHooks<TMessage> {
    onMessageStart: (event: TelegramAssistantMessagePreviewHookEvent<TMessage>) => Promise<void>;
    onMessageUpdate: (event: TelegramAssistantMessagePreviewHookEvent<TMessage>) => Promise<void>;
}
export interface TelegramPreviewControllerDeps {
    getDefaultReplyToMessageId?: () => number | undefined;
    maxMessageLength?: number;
    initialDraftSupport?: TelegramDraftSupport;
    sendDraft: (chatId: number, draftId: number, text?: string, options?: {
        parse_mode?: string;
        entities?: unknown[];
        message_thread_id?: number;
    }) => Promise<unknown>;
    canSend?: () => boolean;
    maxDraftId?: number;
    recordRuntimeEvent?: (category: string, error: unknown, details?: Record<string, unknown>) => void;
}
export interface TelegramPreviewController {
    getState: () => TelegramPreviewRuntimeState | undefined;
    setState: (state: TelegramPreviewRuntimeState | undefined) => void;
    setPendingText: (text: string) => void;
    createState: () => TelegramPreviewRuntimeState;
    resetState: () => void;
    clear: (chatId: number, options?: {
        awaitFlush?: boolean;
        target?: TelegramTarget;
    }) => Promise<void>;
    flush: (chatId: number, options?: {
        target?: TelegramTarget;
    }) => Promise<void>;
    scheduleFlush: (chatId: number, options?: {
        target?: TelegramTarget;
    }) => void;
    finalize: (chatId: number, replyToMessageId?: number, options?: {
        target?: TelegramTarget;
    }) => Promise<boolean>;
}
export type TelegramPreviewControllerRuntimeDeps = TelegramPreviewControllerDeps;
export declare function createTelegramPreviewControllerRuntime(deps: TelegramPreviewControllerRuntimeDeps): TelegramPreviewController;
export interface TelegramAssistantPreviewRuntimeDeps<TMessage, TReplyMarkup = TelegramPreviewReplyMarkup> extends TelegramPreviewControllerRuntimeDeps {
    getActiveTurn: () => TelegramPreviewActiveTurn | undefined;
    isAssistantMessage: (message: TMessage) => boolean;
    getMessageText: (message: TMessage) => string;
    sendMarkdownReply: (chatId: number, replyToMessageId: number | undefined, markdown: string, options?: {
        replyMarkup?: TReplyMarkup;
        target?: TelegramTarget;
    }) => Promise<number | undefined>;
}
export type TelegramAssistantPreviewRuntime<TMessage, TReplyMarkup = TelegramPreviewReplyMarkup> = TelegramPreviewController & TelegramAssistantMessagePreviewHooks<TMessage> & {
    finalizeMarkdown: (chatId: number, markdown: string, replyToMessageId?: number, options?: {
        replyMarkup?: TReplyMarkup;
        target?: TelegramTarget;
    }) => Promise<boolean>;
};
export declare function createTelegramNativeMarkdownPreviewFinalizer<TReplyMarkup>(deps: {
    getState: () => TelegramPreviewRuntimeState | undefined;
    clear: (chatId: number, options?: {
        awaitFlush?: boolean;
        target?: TelegramTarget;
    }) => Promise<void>;
    discard?: () => void;
    sendMarkdownReply: (chatId: number, replyToMessageId: number | undefined, markdown: string, options?: {
        replyMarkup?: TReplyMarkup;
        target?: TelegramTarget;
    }) => Promise<number | undefined>;
}): (chatId: number, markdown: string, replyToMessageId?: number, options?: {
    replyMarkup?: TReplyMarkup;
    target?: TelegramTarget;
}) => Promise<boolean>;
export declare function createTelegramAssistantPreviewRuntime<TMessage, TReplyMarkup = TelegramPreviewReplyMarkup>(deps: TelegramAssistantPreviewRuntimeDeps<TMessage, TReplyMarkup>): TelegramAssistantPreviewRuntime<TMessage, TReplyMarkup>;
export declare function createTelegramPreviewController(deps: TelegramPreviewControllerDeps): TelegramPreviewController;
export declare function createTelegramAssistantMessagePreviewHooks<TMessage, TReplyMarkup = TelegramPreviewReplyMarkup>(deps: TelegramAssistantMessagePreviewHookDeps<TMessage, TReplyMarkup>): TelegramAssistantMessagePreviewHooks<TMessage>;
export declare function handleTelegramAssistantMessagePreviewStart<TMessage, TReplyMarkup = TelegramPreviewReplyMarkup>(message: TMessage, deps: TelegramAssistantMessagePreviewStartDeps<TMessage, TReplyMarkup>): Promise<void>;
export declare function handleTelegramAssistantMessagePreviewUpdate<TMessage>(message: TMessage, deps: TelegramAssistantMessagePreviewUpdateDeps<TMessage>): Promise<void>;
export declare function buildTelegramPreviewFinalText(state: TelegramPreviewState): string | undefined;
export declare function createTelegramPreviewRuntimeState(): TelegramPreviewRuntimeState;
export declare function allocateTelegramDraftId(currentDraftId: number, maxDraftId: number): number;
interface TelegramNativeMarkdownPreviewSnapshot {
    text: string;
}
export declare function shouldUseTelegramDraftPreview(_options: {
    draftSupport: TelegramDraftSupport;
    snapshot?: TelegramNativeMarkdownPreviewSnapshot;
}): boolean;
export declare function clearTelegramPreview(chatId: number, deps: TelegramPreviewRuntimeDeps, options?: {
    awaitFlush?: boolean;
    target?: TelegramTarget;
}): Promise<void>;
export declare function getSafeTelegramRichMarkdownDraftPrefix(markdown: string, maxMessageLength: number): string | undefined;
export declare function flushTelegramPreview(chatId: number, deps: TelegramPreviewRuntimeDeps, options?: {
    target?: TelegramTarget;
}): Promise<void>;
export declare function finalizeTelegramPreview(chatId: number, deps: TelegramPreviewRuntimeDeps, options?: {
    target?: TelegramTarget;
}): Promise<boolean>;
export {};
