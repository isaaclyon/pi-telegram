/**
 * Telegram outbound button helpers
 * Zones: telegram outbound, assistant markup, callback routing
 * Owns assistant-authored telegram_button extraction, button action storage, callback handling, and prompt-turn construction
 */
import type { TelegramInlineKeyboardMarkup } from "./keyboard.js";
import { type PendingTelegramTurn, type TelegramQueueTarget } from "./queue.js";
export interface TelegramOutboundButtonAction {
    text: string;
    prompt: string;
}
export interface TelegramOutboundButtonStoredAction extends TelegramOutboundButtonAction {
    createdAt: number;
}
export type TelegramOutboundButtonMarkup = TelegramInlineKeyboardMarkup;
export interface TelegramButtonReplyPlan {
    markdown: string;
    replyMarkup?: TelegramOutboundButtonMarkup;
}
export interface TelegramButtonActionStore {
    register: (action: TelegramOutboundButtonAction) => string;
    resolve: (callbackData: string | undefined) => TelegramOutboundButtonAction | undefined;
}
export interface TelegramButtonCallbackQuery {
    id: string;
    data?: string;
    message?: {
        message_id?: number;
        message_thread_id?: number;
        chat?: {
            id?: number;
        };
    };
}
export interface TelegramButtonCallbackHandlerDeps<TContext = unknown> {
    resolveAction: (callbackData: string | undefined) => TelegramOutboundButtonAction | undefined;
    answerCallbackQuery: (callbackQueryId: string, text?: string) => Promise<void>;
    enqueueButtonPrompt: (query: TelegramButtonCallbackQuery, action: TelegramOutboundButtonAction, ctx: TContext) => void;
}
export declare function createTelegramButtonActionStore(options?: {
    ttlMs?: number;
}): TelegramButtonActionStore;
export declare function planTelegramButtonReply(markdown: string, deps: {
    registerAction: (action: TelegramOutboundButtonAction) => string;
}): TelegramButtonReplyPlan;
export declare function createTelegramButtonReplyPlanner(store: Pick<TelegramButtonActionStore, "register">): (markdown: string) => TelegramButtonReplyPlan;
export declare function createTelegramButtonPromptTurn(options: {
    chatId: number;
    replyToMessageId: number;
    queueOrder: number;
    action: TelegramOutboundButtonAction;
    target?: TelegramQueueTarget;
    actor?: {
        userId: number;
        label: string;
    };
}): PendingTelegramTurn;
export declare function handleTelegramButtonCallbackQuery<TContext = unknown>(query: TelegramButtonCallbackQuery, ctx: TContext, deps: TelegramButtonCallbackHandlerDeps<TContext>): Promise<boolean>;
