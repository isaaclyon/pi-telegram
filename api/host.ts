/**
 * Telegram host capability API
 * Zones: package boundary, host interop
 * Exposes only the narrow session replacement capability required by Telegram /new
 */

export {
  registerTelegramHostNewSession,
  type TelegramHostNewSession,
  type TelegramHostNewSessionResult,
} from "../lib/host.ts";
