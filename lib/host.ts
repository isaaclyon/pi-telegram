/**
 * Telegram host capability registry
 * Zones: pi agent host boundary, public interop
 * Owns narrow host-provided session replacement and household-surface capabilities without exposing Pi runtime internals
 */

export interface TelegramHostNewSessionResult {
  cancelled: boolean;
}

export type TelegramHostNewSession = () => Promise<TelegramHostNewSessionResult>;

export interface TelegramHostHouseholdActor {
  userId: number;
  label: string;
}

export interface TelegramHostHouseholdGroup {
  kind: "household-group";
  chatId: number;
  actors: readonly TelegramHostHouseholdActor[];
}

interface TelegramHostRegistry {
  readonly version: 1;
  provider?: TelegramHostNewSession;
  token?: object;
  householdGroup?: TelegramHostHouseholdGroup;
  householdToken?: object;
}

const TELEGRAM_HOST_REGISTRY_KEY = Symbol.for(
  "pi-telegram.host-capability-registry",
);

function isTelegramHostRegistry(value: unknown): value is TelegramHostRegistry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const provider = candidate.provider;
  const token = candidate.token;
  const householdGroup = candidate.householdGroup;
  const householdToken = candidate.householdToken;
  if (candidate.version !== 1) return false;
  if (provider !== undefined && typeof provider !== "function") return false;
  if (token !== undefined && (!token || typeof token !== "object")) {
    return false;
  }
  if (
    householdGroup !== undefined &&
    (!householdGroup ||
      typeof householdGroup !== "object" ||
      !isValidTelegramHostHouseholdGroup(householdGroup))
  ) {
    return false;
  }
  if (
    householdToken !== undefined &&
    (!householdToken || typeof householdToken !== "object")
  ) {
    return false;
  }
  return (
    (provider === undefined) === (token === undefined) &&
    (householdGroup === undefined) === (householdToken === undefined)
  );
}

function isValidTelegramHostHouseholdGroup(value: unknown): boolean {
  try {
    validateTelegramHostHouseholdGroup(value as TelegramHostHouseholdGroup);
    return true;
  } catch {
    return false;
  }
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

function validateTelegramHostHouseholdGroup(
  policy: TelegramHostHouseholdGroup,
): TelegramHostHouseholdGroup {
  if (!policy || typeof policy !== "object" || policy.kind !== "household-group") {
    throw new TypeError("Telegram host household policy must be a household-group object");
  }
  if (!Number.isSafeInteger(policy.chatId) || policy.chatId >= 0) {
    throw new TypeError("Telegram host household policy requires a negative Telegram group chat id");
  }
  if (!Array.isArray(policy.actors) || policy.actors.length !== 2) {
    throw new TypeError("Telegram host household policy requires exactly two actors");
  }
  const userIds = new Set<number>();
  const labels = new Set<string>();
  for (const actor of policy.actors) {
    if (
      !actor ||
      typeof actor !== "object" ||
      !Number.isSafeInteger(actor.userId) ||
      actor.userId <= 0 ||
      userIds.has(actor.userId)
    ) {
      throw new TypeError("Telegram host household policy requires distinct positive Telegram user ids");
    }
    if (
      typeof actor.label !== "string" ||
      !/^[A-Z][A-Za-z0-9_-]{0,31}$/.test(actor.label) ||
      labels.has(actor.label)
    ) {
      throw new TypeError("Telegram host household policy requires distinct safe stable actor labels");
    }
    userIds.add(actor.userId);
    labels.add(actor.label);
  }
  return {
    kind: "household-group",
    chatId: policy.chatId,
    actors: policy.actors.map((actor) => ({
      userId: actor.userId,
      label: actor.label,
    })),
  };
}

export function registerTelegramHostHouseholdGroup(
  policy: TelegramHostHouseholdGroup,
): () => void {
  const validated = validateTelegramHostHouseholdGroup(policy);
  const registry = getTelegramHostRegistry();
  if (registry.householdGroup) {
    throw new Error("Telegram host household group capability is already registered");
  }
  const token = {};
  registry.householdGroup = validated;
  registry.householdToken = token;
  return () => {
    if (registry.householdToken !== token) return;
    delete registry.householdGroup;
    delete registry.householdToken;
  };
}

export function getTelegramHostHouseholdGroup():
  | TelegramHostHouseholdGroup
  | undefined {
  return getTelegramHostRegistry().householdGroup;
}

export function getTelegramHostHouseholdActorLabel(
  userId: number | undefined,
): string | undefined {
  if (userId === undefined) return undefined;
  return getTelegramHostHouseholdGroup()?.actors.find(
    (actor) => actor.userId === userId,
  )?.label;
}

export function getTelegramHostHouseholdTarget():
  | { chatId: number }
  | undefined {
  const policy = getTelegramHostHouseholdGroup();
  return policy ? { chatId: policy.chatId } : undefined;
}

export function getTelegramHostHouseholdStatus():
  | { kind: "household-group"; actorLabels: readonly string[] }
  | undefined {
  const policy = getTelegramHostHouseholdGroup();
  return policy
    ? {
        kind: "household-group",
        actorLabels: policy.actors.map(function (actor) {
          return actor.label;
        }),
      }
    : undefined;
}

export function isTelegramHostPrivateChatThreadedModeAllowed(): boolean {
  return getTelegramHostHouseholdGroup() === undefined;
}
