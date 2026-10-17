/**
 * Telegram inline-keyboard structural contracts
 * Zones: telegram ui, shared structure
 * Owns the shared Bot API reply-markup shape while feature domains own their button semantics
 */
export interface TelegramInlineKeyboardButton {
    text: string;
    callback_data: string;
}
export interface TelegramInlineKeyboardMarkup {
    inline_keyboard: TelegramInlineKeyboardButton[][];
}
export declare const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64;
export declare function getTelegramCallbackDataByteLength(value: string): number;
export declare function assertTelegramCallbackData(callbackData: string, context?: string): string;
export declare function assertTelegramInlineKeyboardCallbackData(replyMarkup: unknown, context?: string): void;
