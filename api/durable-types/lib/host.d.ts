/**
 * Telegram host capability registry
 * Zones: pi agent host boundary, public interop
 * Owns narrow host-provided session replacement, prompt preparation, and household-surface capabilities without exposing Pi runtime internals
 */
export interface TelegramHostNewSessionResult {
    cancelled: boolean;
}
export type TelegramHostNewSession = () => Promise<TelegramHostNewSessionResult>;
export interface TelegramHostPromptPreparationInput {
    trigger: "telegram";
    prompt?: {
        text: string;
        sentAtMs?: number;
    };
}
export interface TelegramHostPromptPreparationResult {
    sessionReplaced: boolean;
}
export type TelegramHostPromptPreparation = (input: TelegramHostPromptPreparationInput) => Promise<TelegramHostPromptPreparationResult>;
export interface TelegramHostSessionReplacementGuardInput {
    trigger: "manual" | "telegram" | `job:${string}`;
}
export type TelegramHostSessionReplacementGuard = (input: TelegramHostSessionReplacementGuardInput) => string | undefined;
export interface TelegramHostHouseholdActor {
    userId: number;
    label: string;
}
export interface TelegramHostHouseholdGroup {
    kind: "household-group";
    chatId: number;
    actors: readonly TelegramHostHouseholdActor[];
}
export interface TelegramHostHouseholdCommandScope {
    type: "chat";
    chat_id: number;
}
export declare function registerTelegramHostNewSession(newSession: TelegramHostNewSession): () => void;
export declare function getTelegramHostNewSession(): TelegramHostNewSession | undefined;
export declare function registerTelegramHostPromptPreparation(prepare: TelegramHostPromptPreparation): () => void;
export declare function getTelegramHostPromptPreparation(): TelegramHostPromptPreparation | undefined;
export declare function isTelegramHostPromptPreparationInFlight(): boolean;
export declare function prepareTelegramHostPrompt(turn?: {
    historyText: string;
    sentAtMs?: number;
}): Promise<TelegramHostPromptPreparationResult>;
export declare function registerTelegramHostSessionReplacementGuard(guard: TelegramHostSessionReplacementGuard): () => void;
export declare function getTelegramHostSessionReplacementGuard(): TelegramHostSessionReplacementGuard | undefined;
export declare function registerTelegramHostHouseholdGroup(policy: TelegramHostHouseholdGroup): () => void;
export declare function getTelegramHostHouseholdGroup(): TelegramHostHouseholdGroup | undefined;
export declare function getTelegramHostHouseholdCommandScope(): TelegramHostHouseholdCommandScope | undefined;
export declare function getTelegramHostHouseholdActorLabel(userId: number | undefined): string | undefined;
export declare function getTelegramHostHouseholdTarget(): {
    chatId: number;
} | undefined;
export declare function getTelegramHostHouseholdStatus(): {
    kind: "household-group";
    actorLabels: readonly string[];
} | undefined;
export declare function isTelegramHostPrivateChatThreadedModeAllowed(): boolean;
