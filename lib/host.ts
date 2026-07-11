/**
 * Telegram host capability registry
 * Zones: pi agent host boundary, public interop
 * Owns the single narrow host-provided session replacement capability without exposing Pi runtime internals
 */

export interface TelegramHostNewSessionResult {
  cancelled: boolean;
}

export type TelegramHostNewSession = () => Promise<TelegramHostNewSessionResult>;

interface TelegramHostRegistry {
  readonly version: 1;
  provider?: TelegramHostNewSession;
  token?: object;
}

const TELEGRAM_HOST_REGISTRY_KEY = Symbol.for(
  "pi-telegram.host-capability-registry",
);

function isTelegramHostRegistry(value: unknown): value is TelegramHostRegistry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const provider = candidate.provider;
  const token = candidate.token;
  if (candidate.version !== 1) return false;
  if (provider !== undefined && typeof provider !== "function") return false;
  if (token !== undefined && (!token || typeof token !== "object")) {
    return false;
  }
  return (provider === undefined) === (token === undefined);
}

function getTelegramHostRegistry(): TelegramHostRegistry {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  const existing = globalStore[TELEGRAM_HOST_REGISTRY_KEY];
  if (existing !== undefined) {
    if (!isTelegramHostRegistry(existing)) {
      throw new Error(
        "Telegram host capability registry is occupied by a malformed or incompatible v1 registry.",
      );
    }
    return existing;
  }
  const registry: TelegramHostRegistry = { version: 1 };
  globalStore[TELEGRAM_HOST_REGISTRY_KEY] = registry;
  return registry;
}

export function registerTelegramHostNewSession(
  newSession: TelegramHostNewSession,
): () => void {
  if (typeof newSession !== "function") {
    throw new TypeError("Telegram host newSession capability must be a function");
  }
  const registry = getTelegramHostRegistry();
  if (registry.provider) {
    throw new Error(
      "Telegram host newSession capability is already registered",
    );
  }
  const token = {};
  registry.provider = newSession;
  registry.token = token;
  return () => {
    if (registry.token !== token) return;
    delete registry.provider;
    delete registry.token;
  };
}

export function getTelegramHostNewSession(): TelegramHostNewSession | undefined {
  return getTelegramHostRegistry().provider;
}
