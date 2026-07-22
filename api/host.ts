/**
 * Telegram host capability API
 * Zones: package boundary, host interop
 * Exposes narrow host-owned session replacement and household authorization capabilities
 */

export {
  registerTelegramHostHouseholdGroup,
  registerTelegramHostNewSession,
  type TelegramHostHouseholdActor,
  type TelegramHostHouseholdGroup,
  type TelegramHostNewSession,
  type TelegramHostNewSessionResult,
} from "../lib/host.ts";
