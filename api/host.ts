/**
 * Telegram host capability API
 * Zones: package boundary, host interop
 * Exposes narrow host-owned session replacement and household authorization capabilities
 */

export {
  registerTelegramHostHouseholdGroup,
  registerTelegramHostNewSession,
  registerTelegramHostPromptPreparation,
  type TelegramHostHouseholdActor,
  type TelegramHostHouseholdGroup,
  type TelegramHostNewSession,
  type TelegramHostNewSessionResult,
  type TelegramHostPromptPreparation,
  type TelegramHostPromptPreparationInput,
  type TelegramHostPromptPreparationResult,
} from "../lib/host.ts";
