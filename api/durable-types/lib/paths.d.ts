export interface TelegramAgentDirResolutionInput {
    env?: Partial<Pick<NodeJS.ProcessEnv, "PI_CODING_AGENT_DIR">>;
    execPath?: string;
    argv?: readonly string[];
}
/**
 * Resolve the agent data directory for the current Pi-compatible runtime.
 *
 * Precedence:
 * 1. `PI_CODING_AGENT_DIR` env variable, when explicitly set.
 * 2. Detect Pi-compatible runtime identity from the executable or argv[1]
 *    (e.g. OMP vs standard Pi agent).
 * 3. Fallback: `~/.pi/agent`.
 */
export declare function resolveAgentDir(input?: TelegramAgentDirResolutionInput): string;
/** Telegram bridge configuration file (<agentDir>/telegram.json). */
export declare function resolveTelegramConfigPath(): string;
/** Telegram singleton lock file (<agentDir>/locks.json). */
export declare function resolveTelegramLocksPath(): string;
/** Telegram bridge temporary directory (<agentDir>/tmp/telegram). */
export declare function resolveTelegramTempDir(agentDir?: string): string;
export declare function getTelegramProfilePathSuffix(profileName?: string): string;
export declare function resolveTelegramProfileTempFilePath(baseName: string, extension: string, agentDir?: string, profileName?: string): string;
export declare function getTelegramDiagnosticsDisplayPaths(profileName?: string): {
    state: string;
    logs: string;
};
/** Runtime event log (<agentDir>/tmp/telegram/logs.jsonl). */
export declare function resolveTelegramRuntimeLogPath(): string;
