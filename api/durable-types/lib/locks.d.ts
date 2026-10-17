/**
 * Telegram singleton lock helpers
 * Zones: shared singleton, filesystem, telegram runtime ownership
 * Owns shared locks.json access and Telegram bridge ownership semantics
 */
export declare const TELEGRAM_LOCK_KEY = "@llblab/pi-telegram";
export declare const TELEGRAM_BUS_LEADER_STALE_HEARTBEAT_MS = 5000;
/**
 * Resolve the scoped lock key for the active Telegram profile.
 * Default profile → @llblab/pi-telegram
 * Named profile → @llblab/pi-telegram:<name>
 */
export declare function resolveTelegramLockKey(activeProfile?: string): string;
export interface TelegramActiveProfileGetter {
    getActiveProfileName: () => string | undefined;
}
export declare function createTelegramLockKeyResolver(activeProfile: TelegramActiveProfileGetter): () => string;
export interface TelegramLockEntry {
    pid: number;
    cwd?: string;
    instanceId?: string;
    heartbeatMs?: number;
    leaderEpoch?: number;
    busSocketPath?: string;
    busSecret?: string;
}
export interface TelegramLockContext {
    cwd: string;
}
export type TelegramLockState = {
    kind: "inactive";
} | {
    kind: "active-here";
    lock: TelegramLockEntry;
} | {
    kind: "active-elsewhere";
    lock: TelegramLockEntry;
} | {
    kind: "stale";
    lock: TelegramLockEntry;
};
export interface TelegramLockAcquireOptions {
    force?: boolean;
}
export type TelegramLockAcquireResult = {
    ok: true;
    lock: TelegramLockEntry;
    replacedStale: boolean;
} | {
    ok: false;
    lock: TelegramLockEntry;
};
export interface TelegramLockRuntime<TContext extends TelegramLockContext> {
    acquire: (ctx: TContext, options?: TelegramLockAcquireOptions) => TelegramLockAcquireResult;
    release: () => TelegramLockState;
    getState: () => TelegramLockState;
    getStatusLabel: () => string;
    owns: (ctx?: TelegramLockContext) => boolean;
    refresh: (ctx?: TelegramLockContext) => boolean;
}
export interface TelegramLockOwnershipGuard<TContext extends TelegramLockContext> {
    ownsContext: (ctx: TContext) => boolean;
}
export interface TelegramLockContextStore<TContext extends TelegramLockContext> {
    get: () => TContext | undefined;
}
export interface TelegramLockRuntimeOptions {
    key?: string | (() => string | undefined);
    locksPath?: string;
    pid?: number;
    isProcessAlive?: (pid: number) => boolean;
    instanceId?: string;
    busSocketPath?: string;
    busSecret?: string;
    getNowMs?: () => number;
    staleHeartbeatMs?: number;
}
export declare function readLocks(path?: string): Record<string, unknown>;
export declare function writeLocks(path: string, locks: Record<string, unknown>): void;
export declare function parseTelegramLockEntry(value: unknown): TelegramLockEntry | undefined;
export declare function isProcessAlive(pid: number): boolean;
export declare function formatTelegramLockEntry(lock: TelegramLockEntry): string;
export declare function createTelegramLockRuntime<TContext extends TelegramLockContext>(options?: TelegramLockRuntimeOptions): TelegramLockRuntime<TContext>;
export declare function createTelegramLockOwnershipGuard<TContext extends TelegramLockContext>(lock: TelegramLockRuntime<TContext>): TelegramLockOwnershipGuard<TContext>;
export declare function createTelegramDirectDeliveryOwnershipChecker<TContext extends TelegramLockContext>(deps: {
    lock: TelegramLockRuntime<TContext>;
    contextStore: TelegramLockContextStore<TContext>;
}): () => boolean;
export interface TelegramLockedPollingStartOptions {
    force?: boolean;
    forceFreshLeaderThread?: boolean;
}
export type TelegramLockedPollingStartResult = {
    ok: true;
    message?: string;
    canTakeover?: false;
} | {
    ok: false;
    message: string;
    canTakeover?: boolean;
    owner?: string;
};
export interface TelegramLockedPollingRuntime<TContext extends TelegramLockContext> {
    start: (ctx: TContext, options?: TelegramLockedPollingStartOptions) => Promise<TelegramLockedPollingStartResult>;
    stop: () => Promise<string>;
    suspend: () => Promise<void>;
    onSessionStart: (_event: unknown, ctx: TContext) => Promise<void>;
    registerFollowerWithOwner?: (ctx: TContext, owner: TelegramLockEntry) => boolean | undefined | Promise<boolean | undefined>;
    stopFollowerRegistration?: () => void;
}
export interface TelegramLockedPollingRuntimeDeps<TContext extends TelegramLockContext> {
    lock: TelegramLockRuntime<TContext>;
    hasBotToken: () => boolean;
    canStartPolling?: (ctx: TContext) => boolean;
    formatStartBlockedMessage?: (ctx: TContext) => string;
    startPolling: (ctx: TContext, options?: TelegramLockedPollingStartOptions) => void | Promise<void>;
    stopPolling: () => Promise<void>;
    registerFollowerWithOwner?: (ctx: TContext, owner: TelegramLockEntry) => boolean | undefined | Promise<boolean | undefined>;
    stopFollowerRegistration?: () => void;
    updateStatus: (ctx: TContext) => void;
    /**
     * Best-effort hook fired after this instance successfully starts polling
     * (explicit connect or session auto-start), i.e. once it owns the bot's
     * direct API. Used to register the Telegram command menu so `/` autocomplete
     * appears without a manual `/help`. Never blocks or fails the polling start.
     */
    onPollingStarted?: (ctx: TContext) => void | Promise<void>;
    recordRuntimeEvent?: (category: string, error: unknown, details?: Record<string, unknown>) => void;
    ownershipCheckMs?: number;
}
export declare function createTelegramLockedPollingRuntime<TContext extends TelegramLockContext>(deps: TelegramLockedPollingRuntimeDeps<TContext>): TelegramLockedPollingRuntime<TContext>;
