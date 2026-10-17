/**
 * Telegram bridge config and pairing helpers
 * Zones: telegram config, pairing, filesystem
 * Owns persisted bot/session pairing state, local config storage, live config controls, authorization policy, and first-user pairing side effects
 */
import type { TelegramInboundHandlerConfig } from "./inbound.js";
import type { CommandTemplateObjectConfig } from "./command-templates.js";
export type TelegramOutboundCommandTemplateConfig = string | CommandTemplateObjectConfig;
export interface TelegramOutboundHandlerConfig extends CommandTemplateObjectConfig {
    type?: string;
    match?: string | string[];
    output?: string;
    timeout?: number | string;
}
export type TelegramTimeMode = "hidden" | "always" | "interval";
export interface TelegramTimeConfig {
    injectionMode?: TelegramTimeMode;
    interval?: number;
}
export interface ResolvedTelegramTimeConfig {
    injectionMode: TelegramTimeMode;
    interval: number;
    timezone: string;
}
export type TelegramAssistantRenderingMode = "rich" | "html";
export interface TelegramConfig {
    botToken?: string;
    botUsername?: string;
    botId?: number;
    allowedUserId?: number;
    lastUpdateId?: number;
    inboundHandlers?: TelegramInboundHandlerConfig[];
    attachmentHandlers?: TelegramInboundHandlerConfig[];
    outboundHandlers?: TelegramOutboundHandlerConfig[];
    proactivePush?: boolean;
    assistant?: {
        draftPreviews?: boolean;
        rendering?: TelegramAssistantRenderingMode;
        /** Live tool-activity status message while the agent runs tools (default on) */
        toolActivity?: boolean;
    };
    /** @deprecated use assistant.draftPreviews */
    draftPreviews?: boolean;
    /** @deprecated use assistant.draftPreviews */
    richDraftPreviews?: boolean;
    /** @deprecated use assistant.rendering */
    assistantRendering?: TelegramAssistantRenderingMode;
    voice?: {
        replyMode?: "manual" | "mirror" | "always";
        /** Whether to attach the provider's transcriptText as caption on voice messages */
        sendTranscript?: boolean;
    };
    time?: TelegramTimeConfig;
    /** Named bot/session profiles (e.g. "work", "omp"). */
    profiles?: Record<string, TelegramBotProfile>;
}
/**
 * Per-profile bot/session identity fields.
 * Stored under `profiles.<name>` in telegram.json.
 * Shared bridge settings (inboundHandlers, outboundHandlers, voice, time,
 * assistant, proactivePush) stay at the top level.
 */
export interface TelegramBotProfile {
    botToken: string;
    botUsername?: string;
    botId?: number;
    allowedUserId?: number;
    lastUpdateId?: number;
}
export declare function isValidTelegramProfileName(name: string): boolean;
/**
 * Resolve the effective config for a named (or default) profile.
 * Returns bot/session fields from the named profile, falling back to
 * top-level fields for the default profile. Shared bridge settings
 * always come from the top level.
 */
export declare function resolveTelegramActiveProfile(config: TelegramConfig, profileName?: string): {
    botToken?: string;
    botUsername?: string;
    botId?: number;
    allowedUserId?: number;
    lastUpdateId?: number;
};
/** List defined profile names. */
export declare function getTelegramProfileNames(config: TelegramConfig): string[];
export interface TelegramConfigStore {
    get: () => TelegramConfig;
    getStoredConfig: () => TelegramConfig;
    set: (config: TelegramConfig) => void;
    update: (mutate: (config: TelegramConfig) => void) => void;
    activateProfile: (profileName: string | undefined) => boolean;
    getActiveProfileName: () => string | undefined;
    getBotToken: () => string | undefined;
    hasBotToken: () => boolean;
    getAllowedUserId: () => number | undefined;
    getInboundHandlers: () => TelegramInboundHandlerConfig[] | undefined;
    getAttachmentHandlers: () => TelegramInboundHandlerConfig[] | undefined;
    getOutboundHandlers: () => TelegramOutboundHandlerConfig[] | undefined;
    setAllowedUserId: (userId: number) => void;
    load: () => Promise<void>;
    persist: (config?: TelegramConfig) => Promise<void>;
}
export interface TelegramConfigStoreOptions {
    initialConfig?: TelegramConfig;
    agentDir?: string;
    configPath?: string;
    recordRuntimeEvent?: (category: string, error: unknown, details?: Record<string, unknown>) => void;
}
export interface TelegramInvalidConfigRecovery {
    configPath: string;
    recoveryPath: string;
    error: unknown;
}
export interface TelegramConfigRuntime {
    updateVoiceConfig: (voice: NonNullable<TelegramConfig["voice"]>) => void;
}
export declare function setGlobalTelegramConfigRuntime(runtime: TelegramConfigRuntime | undefined): void;
export declare function updateTelegramVoiceConfig(voice: NonNullable<TelegramConfig["voice"]>): boolean;
type TelegramMutableConfigStore = Pick<TelegramConfigStore, "get" | "set" | "persist"> & {
    load?: () => Promise<void>;
};
export declare function bindGlobalTelegramConfigRuntime(configStore: TelegramMutableConfigStore): void;
export declare function readTelegramConfig(configPath: string, options?: {
    onInvalidConfig?: (recovery: TelegramInvalidConfigRecovery) => void;
}): Promise<TelegramConfig>;
export declare function writeTelegramConfig(agentDir: string, configPath: string, config: TelegramConfig): Promise<void>;
export declare function createTelegramConfigStore(options?: TelegramConfigStoreOptions): TelegramConfigStore;
export declare function createTelegramProactivePushChecker(configStore: Pick<TelegramConfigStore, "get">): () => boolean;
export declare function createTelegramProactivePushSetter(configStore: TelegramMutableConfigStore): (enabled: boolean) => Promise<void>;
export declare function createTelegramDraftPreviewsChecker(configStore: Pick<TelegramConfigStore, "get">): () => boolean;
export declare function createTelegramDraftPreviewsSetter(configStore: TelegramMutableConfigStore): (enabled: boolean) => Promise<void>;
export declare function createTelegramToolActivityChecker(configStore: Pick<TelegramConfigStore, "get">): () => boolean;
export declare function createTelegramToolActivitySetter(configStore: TelegramMutableConfigStore): (enabled: boolean) => Promise<void>;
export declare function createTelegramAssistantRenderingModeGetter(configStore: Pick<TelegramConfigStore, "get">): () => TelegramAssistantRenderingMode;
export declare function createTelegramAssistantRenderingModeSetter(configStore: TelegramMutableConfigStore): (mode: TelegramAssistantRenderingMode) => Promise<void>;
export declare function createTelegramVoiceReplyModeGetter(configStore: Pick<TelegramConfigStore, "get">): () => "manual" | "mirror" | "always";
export declare function createTelegramVoiceReplyModeConfiguredChecker(configStore: Pick<TelegramConfigStore, "get">): () => boolean;
export declare function createTelegramVoiceReplyModeSetter(configStore: TelegramMutableConfigStore): (replyMode: "manual" | "mirror" | "always" | undefined) => Promise<void>;
export declare function resolveTelegramTimeConfig(raw: TelegramTimeConfig | undefined): ResolvedTelegramTimeConfig;
export declare function createTelegramTimeConfigGetter(configStore: Pick<TelegramConfigStore, "get">): () => ResolvedTelegramTimeConfig;
export declare function createTelegramTimeInjectionModeGetter(configStore: Pick<TelegramConfigStore, "get">): () => TelegramTimeMode;
export declare function createTelegramTimeInjectionModeSetter(configStore: TelegramMutableConfigStore): (injectionMode: TelegramTimeMode) => Promise<void>;
export interface TelegramProactivePushTarget {
    chatId: number;
    threadId?: number;
}
export declare function createTelegramProactivePushChatIdGetter(deps: {
    getActiveTurnChatId: () => number | undefined;
    getAllowedUserId: () => number | undefined;
}): () => number | undefined;
export declare function createTelegramProactivePushTargetGetter(deps: {
    getActiveTurnTarget: () => TelegramProactivePushTarget | undefined;
    getAssignedTarget: () => TelegramProactivePushTarget | undefined;
    getAllowedUserId: () => number | undefined;
}): () => TelegramProactivePushTarget | undefined;
export declare function createTelegramConfigControls(configStore: TelegramMutableConfigStore): {
    isProactivePushEnabled: () => boolean;
    setProactivePushEnabled: (enabled: boolean) => Promise<void>;
    areDraftPreviewsEnabled: () => boolean;
    setDraftPreviewsEnabled: (enabled: boolean) => Promise<void>;
    isToolActivityEnabled: () => boolean;
    setToolActivityEnabled: (enabled: boolean) => Promise<void>;
    getAssistantRenderingMode: () => TelegramAssistantRenderingMode;
    setAssistantRenderingMode: (mode: TelegramAssistantRenderingMode) => Promise<void>;
    getVoiceReplyMode: () => "manual" | "mirror" | "always";
    isVoiceReplyModeConfigured: () => boolean;
    setVoiceReplyMode: (replyMode: "manual" | "mirror" | "always" | undefined) => Promise<void>;
    getTimeInjectionMode: () => TelegramTimeMode;
    setTimeInjectionMode: (injectionMode: TelegramTimeMode) => Promise<void>;
};
export type TelegramAuthorizationState = {
    kind: "pair";
    userId: number;
} | {
    kind: "allow";
} | {
    kind: "deny";
};
export interface TelegramUserPairingDeps<TContext> {
    allowedUserId?: number;
    ctx: TContext;
    setAllowedUserId: (userId: number) => void;
    persistConfig: () => Promise<void>;
    updateStatus: (ctx: TContext) => void;
}
export interface TelegramUserPairingRuntimeDeps<TContext> {
    getAllowedUserId: () => number | undefined;
    setAllowedUserId: (userId: number) => void;
    persistConfig: () => Promise<void>;
    updateStatus: (ctx: TContext) => void;
}
export interface TelegramUserPairingRuntime<TContext> {
    pairIfNeeded: (userId: number, ctx: TContext) => Promise<boolean>;
}
export declare function getTelegramAuthorizationState(userId: number, allowedUserId?: number): TelegramAuthorizationState;
export declare function pairTelegramUserIfNeeded<TContext>(userId: number, deps: TelegramUserPairingDeps<TContext>): Promise<boolean>;
export declare function createTelegramUserPairingRuntime<TContext>(deps: TelegramUserPairingRuntimeDeps<TContext>): TelegramUserPairingRuntime<TContext>;
export {};
