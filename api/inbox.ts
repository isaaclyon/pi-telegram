/**
 * Telegram inbound durable-inbox API
 * Zones: package boundary, host interop
 * Exposes only the narrow durable-inbox capability the host implements; queue
 * reconciliation and replay internals stay package-private.
 */

export {
  registerTelegramInboundInbox,
  getTelegramInboundInbox,
  type TelegramInboundInbox,
  type TelegramInboundInboxRecord,
} from "../lib/inbox.ts";
