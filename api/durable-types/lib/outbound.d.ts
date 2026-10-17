/**
 * Telegram outbound surface helpers
 * Zones: telegram outbound, command templates, voice delivery
 * Owns configured outbound handler execution, text transforms, voice-file generation/delivery, runtime-event bridge, and compatibility re-exports; assistant markup parsing lives in outbound-markup and button callback actions live in outbound-buttons
 */
import { type TelegramButtonActionStore, type TelegramOutboundButtonMarkup } from "./outbound-buttons.js";
import { type TelegramVoiceReplyItem } from "./outbound-markup.js";
import type { TelegramTarget } from "./target.js";
import { type CommandTemplateObjectConfig } from "./command-templates.js";
/**
 * Record a runtime event that appears in `/telegram-status`.
 * Voice synthesis provider extensions can call this to surface diagnostics
 * alongside pi-telegram's own events. Events are silently dropped
 * when pi-telegram is not loaded.
 */
export type TelegramRuntimeEventRecorder = (category: string, error: unknown, details?: Record<string, unknown>) => void;
export declare function bindTelegramRuntimeEventRecorder(recorder: TelegramRuntimeEventRecorder): void;
export declare function recordTelegramRuntimeEvent(category: string, error: unknown, details?: Record<string, unknown>): void;
export type TelegramOutboundCommandTemplateConfig = string | CommandTemplateObjectConfig;
export interface TelegramOutboundHandlerConfig extends CommandTemplateObjectConfig {
    type?: string;
    match?: string | string[];
    output?: string;
    timeout?: number | string;
}
export { normalizeMarkdownAfterVoiceExtraction, planTelegramVoiceReply, stripTelegramCommentMarkupForDelivery, stripTelegramCommentMarkupForPreview, stripTelegramVoiceMarkupForPreview, type TelegramVoiceReplyItem, type TelegramVoiceReplyPlan, } from "./outbound-markup.js";
export interface TelegramVoiceExecOptions {
    cwd?: string;
    timeout?: number;
    signal?: AbortSignal;
    stdin?: string;
    retry?: number;
}
export interface TelegramVoiceExecResult {
    stdout: string;
    stderr: string;
    code: number;
    killed: boolean;
}
export interface TelegramVoiceReplyTurnView {
    chatId: number;
    replyToMessageId: number;
    target?: TelegramTarget;
}
export interface TelegramVoiceReplySenderDeps {
    execCommand: (command: string, args: string[], options?: TelegramVoiceExecOptions) => Promise<TelegramVoiceExecResult>;
    sendMultipart: (method: string, fields: Record<string, string>, fileField: string, filePath: string, fileName: string) => Promise<unknown>;
    sendTextReply?: (chatId: number, replyToMessageId: number | undefined, text: string, options?: {
        parseMode?: "HTML";
    }) => Promise<unknown>;
    sendChatAction?: (chatId: number, action: string) => Promise<unknown>;
    sendRecordVoiceAction?: (chatId: number) => Promise<unknown>;
    getHandlers?: () => TelegramOutboundHandlerConfig[] | undefined;
    cwd?: string;
    tempDir?: string;
    recordRuntimeEvent?: (category: string, error: unknown, details?: Record<string, unknown>) => void;
}
export type TelegramOutboundProgrammaticHandler = (text: string, options?: {
    lang?: string;
    rate?: string;
}) => Promise<string>;
export interface TelegramOutboundHandlerRegistry {
    handlers: Map<string, TelegramOutboundProgrammaticHandler[]>;
}
export declare function registerTelegramOutboundHandler(kind: string, handler: TelegramOutboundProgrammaticHandler): () => void;
export declare function hasTelegramOutboundHandler(kind: string): boolean;
export declare function getTelegramOutboundProgrammaticHandlers(kind: string): TelegramOutboundProgrammaticHandler[];
export interface TelegramOutboundTextReplyRuntimeDeps<TReplyMarkup = unknown> {
    execCommand: TelegramVoiceReplySenderDeps["execCommand"];
    getHandlers?: () => TelegramOutboundHandlerConfig[] | undefined;
    sendTextReply: (chatId: number, replyToMessageId: number | undefined, text: string, options?: {
        parseMode?: "HTML";
        target?: TelegramTarget;
    }) => Promise<number | undefined>;
    sendMarkdownReply: (chatId: number, replyToMessageId: number | undefined, markdown: string, options?: {
        replyMarkup?: TReplyMarkup;
        target?: TelegramTarget;
    }) => Promise<number | undefined>;
    cwd?: string;
    recordRuntimeEvent?: TelegramVoiceReplySenderDeps["recordRuntimeEvent"];
}
export interface TelegramInlineKeyboardLike {
    inline_keyboard: Array<Array<{
        text: string;
        callback_data: string;
    }>>;
}
export interface TelegramOutboundTextTransformOptions<TReplyMarkup = unknown> {
    handlers?: TelegramOutboundHandlerConfig[];
    cwd?: string;
    execCommand: TelegramVoiceReplySenderDeps["execCommand"];
    recordRuntimeEvent?: TelegramVoiceReplySenderDeps["recordRuntimeEvent"];
    replyMarkup?: TReplyMarkup;
}
export interface TelegramOutboundTextTransformResult<TReplyMarkup = unknown> {
    text: string;
    replyMarkup?: TReplyMarkup;
}
export interface TelegramOutboundTextPreviewRuntimeDeps<TReplyMarkup = unknown> {
    execCommand: TelegramVoiceReplySenderDeps["execCommand"];
    getHandlers?: () => TelegramOutboundHandlerConfig[] | undefined;
    finalizeMarkdownPreview: (chatId: number, markdown: string, replyToMessageId: number, options?: {
        replyMarkup?: TReplyMarkup;
    }) => Promise<boolean>;
    cwd?: string;
    recordRuntimeEvent?: TelegramVoiceReplySenderDeps["recordRuntimeEvent"];
}
export declare function findTelegramOutboundHandlers(handlers: TelegramOutboundHandlerConfig[] | undefined, type: string): TelegramOutboundHandlerConfig[];
export declare function generateTelegramVoiceReplyFile(text: string, options: {
    lang?: string;
    rate?: string;
    handler?: TelegramOutboundHandlerConfig;
    tempDir?: string;
    cwd?: string;
    execCommand: TelegramVoiceReplySenderDeps["execCommand"];
}): Promise<string | undefined>;
export declare function transformTelegramOutboundText(text: string, options: {
    handlers?: TelegramOutboundHandlerConfig[];
    cwd?: string;
    execCommand: TelegramVoiceReplySenderDeps["execCommand"];
    recordRuntimeEvent?: TelegramVoiceReplySenderDeps["recordRuntimeEvent"];
}): Promise<string>;
export declare function transformTelegramOutboundTextReply<TReplyMarkup = unknown>(text: string, options: TelegramOutboundTextTransformOptions<TReplyMarkup>): Promise<TelegramOutboundTextTransformResult<TReplyMarkup>>;
export declare function createTelegramOutboundTextReplyRuntime<TReplyMarkup = unknown>(deps: TelegramOutboundTextReplyRuntimeDeps<TReplyMarkup>): Pick<TelegramOutboundTextReplyRuntimeDeps<TReplyMarkup>, "sendTextReply" | "sendMarkdownReply">;
export declare function createTelegramOutboundTextPreviewRuntime<TReplyMarkup = unknown>(deps: TelegramOutboundTextPreviewRuntimeDeps<TReplyMarkup>): Pick<TelegramOutboundTextPreviewRuntimeDeps<TReplyMarkup>, "finalizeMarkdownPreview">;
export interface TelegramOutboundReplyPlan<TReplyMarkup = unknown> {
    markdown: string;
    replyMarkup?: TReplyMarkup;
    voiceText?: string;
    voiceReplies?: TelegramVoiceReplyItem[];
    lang?: string;
    rate?: string;
}
export { clearTelegramVoiceSynthesisProviders, clearTelegramVoiceTranscriptionProviders, computeVoicePromptContribution, computeVoiceTurnFlags, getTelegramVoiceReplyMode, getTelegramVoiceSynthesisProviders, getTelegramVoiceTranscriptionProviders, hasTelegramVoiceSynthesisProvider, hasTelegramVoiceTranscriptionProvider, isVoiceTurn, registerTelegramVoiceSynthesisProvider, registerTelegramVoiceTranscriptionProvider, shouldSuppressPreviewForVoice, type TelegramVoiceReplyMode, type TelegramVoiceSynthesisProvider, type TelegramVoiceSynthesisProviderResult, type TelegramVoiceTranscriptionFile, type TelegramVoiceTranscriptionProvider, type TelegramVoiceTranscriptionProviderResult, type TelegramVoiceTurnView, } from "./voice.js";
export declare function createTelegramVoiceReplySender(deps: TelegramVoiceReplySenderDeps): (turn: import("./outbound-voice.js").TelegramVoiceReplyTurnView, text: string, options?: {
    lang?: string;
    rate?: string;
    replyToPrompt?: boolean;
    replyMarkup?: unknown;
} | undefined) => Promise<void>;
export { createTelegramButtonActionStore, createTelegramButtonPromptTurn, createTelegramButtonReplyPlanner, handleTelegramButtonCallbackQuery, planTelegramButtonReply, type TelegramButtonActionStore, type TelegramButtonCallbackHandlerDeps, type TelegramButtonCallbackQuery, type TelegramButtonReplyPlan, type TelegramOutboundButtonAction, type TelegramOutboundButtonMarkup, type TelegramOutboundButtonStoredAction, } from "./outbound-buttons.js";
export declare function createTelegramOutboundReplyPlanner(store: Pick<TelegramButtonActionStore, "register">): (markdown: string) => TelegramOutboundReplyPlan<TelegramOutboundButtonMarkup>;
/**
 * Create an artifact sender that delivers planned voice replies for a turn.
 * Iterates over `voiceReplies` (or a single `voiceText`) and sends each as
 * a Telegram voice message via the voice reply sender. Throws if no voice
 * reply could be delivered.
 */
export declare function createTelegramOutboundReplyArtifactSender(deps: TelegramVoiceReplySenderDeps): (turn: TelegramVoiceReplyTurnView, plan: Pick<TelegramOutboundReplyPlan, "voiceText" | "voiceReplies" | "lang" | "rate" | "replyMarkup">, options?: {
    replyToPrompt?: boolean;
}) => Promise<void>;
