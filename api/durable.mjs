// lib/locks.ts
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";

// lib/paths.ts
import { homedir } from "node:os";
import { join, resolve } from "node:path";
function resolveAgentDir(input = {}) {
  const env = input.env ?? process.env;
  if (env.PI_CODING_AGENT_DIR) return resolve(env.PI_CODING_AGENT_DIR);
  const execPath = input.execPath ?? process.execPath;
  const argv = input.argv ?? process.argv;
  const execBasename = execPath.toLowerCase().split(/[\\/]/u).pop() ?? "";
  const argv1Last = (argv[1] ?? "").toLowerCase().split(/[\\/]/u).pop() ?? "";
  if (execBasename.startsWith("omp") || argv1Last.startsWith("omp")) {
    return join(homedir(), ".omp", "agent");
  }
  return join(homedir(), ".pi", "agent");
}
function resolveTelegramConfigPath() {
  return join(resolveAgentDir(), "telegram.json");
}
function resolveTelegramLocksPath() {
  return join(resolveAgentDir(), "locks.json");
}

// lib/locks.ts
var TELEGRAM_LOCK_KEY = "@llblab/pi-telegram";
var TELEGRAM_LOCK_WRITE_RETRY_ATTEMPTS = 5;
var TELEGRAM_LOCK_WRITE_RETRY_DELAY_MS = 25;
function getLocksPath() {
  return resolveTelegramLocksPath();
}
function resolveTelegramLockKey(activeProfile) {
  if (activeProfile) return `${TELEGRAM_LOCK_KEY}:${activeProfile}`;
  return TELEGRAM_LOCK_KEY;
}
function readLocks(path = getLocksPath()) {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
function isRetryableLockWriteError(error) {
  const code = error?.code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}
function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}
function writeLocks(path, locks) {
  mkdirSync(dirname(path), { recursive: true });
  const payload = `${JSON.stringify(locks, null, 2)}
`;
  let lastError;
  for (let attempt = 0; attempt < TELEGRAM_LOCK_WRITE_RETRY_ATTEMPTS; attempt += 1) {
    const tempPath = `${path}.${process.pid}.${Date.now()}.${attempt}.tmp`;
    try {
      writeFileSync(tempPath, payload, {
        encoding: "utf8",
        mode: 384
      });
      renameSync(tempPath, path);
      return;
    } catch (error) {
      lastError = error;
      try {
        unlinkSync(tempPath);
      } catch {
      }
      if (!isRetryableLockWriteError(error) || attempt === TELEGRAM_LOCK_WRITE_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      sleepSync(TELEGRAM_LOCK_WRITE_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError;
}
function parseTelegramLockEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return void 0;
  const record = value;
  if (typeof record.pid !== "number") return void 0;
  return {
    pid: record.pid,
    cwd: typeof record.cwd === "string" ? record.cwd : void 0,
    instanceId: typeof record.instanceId === "string" ? record.instanceId : void 0,
    heartbeatMs: typeof record.heartbeatMs === "number" ? record.heartbeatMs : void 0,
    leaderEpoch: typeof record.leaderEpoch === "number" ? record.leaderEpoch : void 0,
    busSocketPath: typeof record.busSocketPath === "string" ? record.busSocketPath : void 0,
    busSecret: typeof record.busSecret === "string" ? record.busSecret : void 0
  };
}
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function formatTelegramLockEntry(lock) {
  return lock.cwd ? `pid ${lock.pid}, cwd ${lock.cwd}` : `pid ${lock.pid}`;
}
function getLockState(lock, pid, isAlive, options = {}) {
  if (!lock) return { kind: "inactive" };
  if (lock.pid === pid) return { kind: "active-here", lock };
  if (typeof lock.heartbeatMs === "number" && typeof options.nowMs === "number" && typeof options.staleHeartbeatMs === "number" && options.nowMs - lock.heartbeatMs > options.staleHeartbeatMs) {
    return { kind: "stale", lock };
  }
  if (isAlive(lock.pid)) return { kind: "active-elsewhere", lock };
  return { kind: "stale", lock };
}
function ownsLockContext(lock, pid, ctx) {
  if (!lock || lock.pid !== pid) return false;
  return !lock.cwd || !ctx || lock.cwd === ctx.cwd;
}
function createLockEntry(pid, ctx, options) {
  const lock = { pid, cwd: ctx.cwd };
  if (options.instanceId) {
    const nowMs = options.getNowMs?.();
    lock.instanceId = options.instanceId;
    lock.heartbeatMs = nowMs;
    lock.leaderEpoch = nowMs;
  }
  if (options.busSocketPath) lock.busSocketPath = options.busSocketPath;
  if (options.busSecret) lock.busSecret = options.busSecret;
  return lock;
}
function formatLockState(state) {
  switch (state.kind) {
    case "inactive":
      return "inactive";
    case "active-here":
      return "active here";
    case "active-elsewhere":
      return `active elsewhere (${formatTelegramLockEntry(state.lock)})`;
    case "stale":
      return `stale (${formatTelegramLockEntry(state.lock)})`;
  }
}
function createTelegramLockRuntime(options = {}) {
  const key = options.key ?? TELEGRAM_LOCK_KEY;
  const locksPath = options.locksPath ?? getLocksPath();
  const pid = options.pid ?? process.pid;
  const isAlive = options.isProcessAlive ?? isProcessAlive;
  const getNowMs = options.getNowMs ?? Date.now;
  const stateOptions = () => ({
    nowMs: getNowMs(),
    staleHeartbeatMs: options.staleHeartbeatMs
  });
  const resolveEffectiveKey = () => {
    if (typeof key === "function") return key() || TELEGRAM_LOCK_KEY;
    return key;
  };
  const readLock = () => {
    const effectiveKey = resolveEffectiveKey();
    return parseTelegramLockEntry(readLocks(locksPath)[effectiveKey]);
  };
  const writeLock = (lock) => {
    const effectiveKey = resolveEffectiveKey();
    const locks = readLocks(locksPath);
    locks[effectiveKey] = lock;
    writeLocks(locksPath, locks);
  };
  return {
    acquire: (ctx, acquireOptions = {}) => {
      const state = getLockState(readLock(), pid, isAlive, stateOptions());
      if (state.kind === "active-elsewhere" && !acquireOptions.force)
        return { ok: false, lock: state.lock };
      const lock = createLockEntry(pid, ctx, {
        instanceId: options.instanceId,
        busSocketPath: options.busSocketPath,
        busSecret: options.busSecret,
        getNowMs
      });
      writeLock(lock);
      return { ok: true, lock, replacedStale: state.kind === "stale" };
    },
    release: () => {
      const state = getLockState(readLock(), pid, isAlive, stateOptions());
      if (state.kind === "active-here" || state.kind === "stale") {
        const locks = readLocks(locksPath);
        delete locks[resolveEffectiveKey()];
        writeLocks(locksPath, locks);
      }
      return state;
    },
    getState: () => getLockState(readLock(), pid, isAlive, stateOptions()),
    getStatusLabel: () => formatLockState(getLockState(readLock(), pid, isAlive, stateOptions())),
    owns: (ctx) => ownsLockContext(readLock(), pid, ctx),
    refresh: (ctx) => {
      const lock = readLock();
      if (!lock || !ownsLockContext(lock, pid, ctx)) return false;
      if (!options.instanceId) return true;
      writeLock({
        pid: lock.pid,
        ...lock.cwd ? { cwd: lock.cwd } : {},
        instanceId: options.instanceId,
        heartbeatMs: getNowMs(),
        leaderEpoch: lock.leaderEpoch,
        ...options.busSocketPath ? { busSocketPath: options.busSocketPath } : {},
        busSecret: options.busSecret ?? lock.busSecret
      });
      return true;
    }
  };
}

// lib/config.ts
import { existsSync as existsSync2 } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";

// lib/host.ts
var TELEGRAM_HOST_REGISTRY_KEY = Symbol.for(
  "pi-telegram.host-capability-registry"
);

// lib/config.ts
function getConfigPath() {
  return resolveTelegramConfigPath();
}
function getInvalidTelegramConfigRecoveryPath(configPath) {
  return `${configPath}.invalid-${process.pid}-${Date.now()}`;
}
async function readTelegramConfig(configPath, options = {}) {
  if (!existsSync2(configPath)) return {};
  const content = await readFile(configPath, "utf8");
  try {
    return JSON.parse(content);
  } catch (error) {
    const recoveryPath = getInvalidTelegramConfigRecoveryPath(configPath);
    await rename(configPath, recoveryPath);
    options.onInvalidConfig?.({ configPath, recoveryPath, error });
    return {};
  }
}
async function writeTelegramConfig(agentDir, configPath, config) {
  await mkdir(agentDir, { recursive: true });
  const tempConfigPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempConfigPath, JSON.stringify(config, null, "	") + "\n", {
    encoding: "utf8",
    mode: 384
  });
  await chmod(tempConfigPath, 384);
  await rename(tempConfigPath, configPath);
  await chmod(configPath, 384);
}
function getTelegramProfileFields(config) {
  const token = config.botToken?.trim();
  if (!token) return void 0;
  return {
    botToken: token,
    botUsername: config.botUsername,
    botId: config.botId,
    allowedUserId: config.allowedUserId,
    lastUpdateId: config.lastUpdateId
  };
}
function applyTelegramProfile(config, profileName) {
  if (!profileName) return config;
  const profile = config.profiles?.[profileName];
  if (!profile) return config;
  return {
    ...config,
    botToken: profile.botToken,
    botUsername: profile.botUsername,
    botId: profile.botId,
    allowedUserId: profile.allowedUserId,
    lastUpdateId: profile.lastUpdateId
  };
}
function storeTelegramEffectiveConfig(baseConfig, nextConfig, profileName) {
  if (!profileName) return nextConfig;
  const profile = getTelegramProfileFields(nextConfig);
  const profiles = { ...baseConfig.profiles ?? {} };
  if (profile) profiles[profileName] = profile;
  else delete profiles[profileName];
  return {
    ...nextConfig,
    botToken: baseConfig.botToken,
    botUsername: baseConfig.botUsername,
    botId: baseConfig.botId,
    allowedUserId: baseConfig.allowedUserId,
    lastUpdateId: baseConfig.lastUpdateId,
    profiles: Object.keys(profiles).length > 0 ? profiles : void 0
  };
}
function createTelegramConfigStore(options = {}) {
  let config = options.initialConfig ?? {};
  let activeProfileName;
  const agentDir = options.agentDir ?? resolveAgentDir();
  const configPath = options.configPath ?? getConfigPath();
  const getEffectiveConfig = () => applyTelegramProfile(config, activeProfileName);
  const setEffectiveConfig = (nextConfig) => {
    config = storeTelegramEffectiveConfig(config, nextConfig, activeProfileName);
  };
  return {
    get: getEffectiveConfig,
    getStoredConfig: () => config,
    set: setEffectiveConfig,
    update: (mutate) => {
      const nextConfig = getEffectiveConfig();
      mutate(nextConfig);
      setEffectiveConfig(nextConfig);
    },
    activateProfile: (profileName) => {
      if (profileName && !config.profiles?.[profileName]) return false;
      activeProfileName = profileName;
      return true;
    },
    getActiveProfileName: () => activeProfileName,
    getBotToken: () => getEffectiveConfig().botToken,
    hasBotToken: () => !!getEffectiveConfig().botToken,
    getAllowedUserId: () => getEffectiveConfig().allowedUserId,
    getInboundHandlers: () => [
      ...config.inboundHandlers ?? [],
      ...config.attachmentHandlers ?? []
    ],
    getAttachmentHandlers: () => config.attachmentHandlers,
    getOutboundHandlers: () => config.outboundHandlers,
    setAllowedUserId: (userId) => {
      const nextConfig = getEffectiveConfig();
      nextConfig.allowedUserId = userId;
      setEffectiveConfig(nextConfig);
    },
    load: async () => {
      config = await readTelegramConfig(configPath, {
        onInvalidConfig: (recovery) => {
          options.recordRuntimeEvent?.("config", recovery.error, {
            phase: "load",
            configPath: recovery.configPath,
            recoveryPath: recovery.recoveryPath
          });
        }
      });
      if (activeProfileName && !config.profiles?.[activeProfileName]) {
        activeProfileName = void 0;
      }
    },
    persist: async (nextConfig = getEffectiveConfig()) => {
      const storedConfig = storeTelegramEffectiveConfig(
        config,
        nextConfig,
        activeProfileName
      );
      config = storedConfig;
      await writeTelegramConfig(agentDir, configPath, storedConfig);
    }
  };
}

// lib/keyboard.ts
var TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64;
function getTelegramCallbackDataByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}
function assertTelegramCallbackData(callbackData, context = "Telegram callback_data") {
  const byteLength = getTelegramCallbackDataByteLength(callbackData);
  if (byteLength > TELEGRAM_CALLBACK_DATA_MAX_BYTES) {
    throw new Error(
      `${context} exceeds ${TELEGRAM_CALLBACK_DATA_MAX_BYTES} bytes (${byteLength}). Use a shorter action/payload or store state behind a compact key.`
    );
  }
  return callbackData;
}
function assertTelegramInlineKeyboardCallbackData(replyMarkup, context = "Telegram inline keyboard callback_data") {
  if (!replyMarkup || typeof replyMarkup !== "object") return;
  const keyboard = replyMarkup.inline_keyboard;
  if (!Array.isArray(keyboard)) return;
  for (const row of keyboard) {
    if (!Array.isArray(row)) continue;
    for (const button of row) {
      if (!button || typeof button !== "object") continue;
      const callbackData = button.callback_data;
      if (typeof callbackData !== "string") continue;
      assertTelegramCallbackData(callbackData, context);
    }
  }
}

// lib/target.ts
function isTelegramThreadTarget(target) {
  return Number.isInteger(target.threadId);
}
function getTelegramTargetThreadParams(target) {
  return isTelegramThreadTarget(target) ? { message_thread_id: target.threadId } : {};
}

// lib/rendering.ts
var TELEGRAM_TABLE_GRAPHEME_SEGMENTER = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : void 0;

// lib/replies.ts
var TELEGRAM_RICH_MESSAGE_MAX_CHARS = 32768;
var TELEGRAM_RICH_MESSAGE_MAX_BLOCKS = 500;
var lastRepliedToMessageIdByTarget = /* @__PURE__ */ new Map();
function getReplyDedupTargetKey(chatId, target) {
  const threadId = target?.threadId;
  return typeof threadId === "number" ? `${chatId}:thread:${threadId}` : `${chatId}:private`;
}
function buildTelegramReplyParameters(chatId, messageId, target) {
  if (messageId === void 0 || messageId <= 0) return void 0;
  const key = getReplyDedupTargetKey(chatId, target);
  if (lastRepliedToMessageIdByTarget.get(key) === messageId) {
    return void 0;
  }
  lastRepliedToMessageIdByTarget.set(key, messageId);
  return {
    message_id: messageId,
    allow_sending_without_reply: true
  };
}
function normalizeIndentedTelegramNativeMarkdownList(line) {
  return line.replace(
    /^( +|\t+)([-*+] |\d+\. )/,
    (_match, indent, marker) => {
      const visibleIndent = indent.replace(/ /g, "\xA0").replace(/\t/g, "\xA0\xA0");
      return `${visibleIndent}${marker}`;
    }
  );
}
function normalizeTelegramNativeMarkdownLine(line) {
  let result = normalizeIndentedTelegramNativeMarkdownList(
    line.replace(/^( {0,3}>)[ \t]/, "$1")
  );
  const codeSpans = [];
  result = result.replace(/`+[^`]*`+/g, (code) => {
    const token = `\0${codeSpans.length}\0`;
    codeSpans.push(code);
    return token;
  });
  result = result.replace(
    /(^|[^\\$])\$([A-Z][A-Z0-9]{1,})(?!\$)(?=\b|[.,;:)/-])/g,
    (_match, prefix, ticker) => `${prefix}\\$${ticker}`
  );
  return result.replace(
    /\u0000(\d+)\u0000/g,
    (_match, index) => codeSpans[Number(index)] ?? ""
  );
}
function hasClosingDisplayMathDelimiter(lines, startIndex) {
  let fence;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && line.trim() === "$$") return true;
    if (!fence && fenceMatch) {
      const markerText = fenceMatch[1] ?? "```";
      fence = { marker: markerText[0], length: markerText.length };
      continue;
    }
    if (fence && new RegExp(`^ {0,3}${fence.marker}{${fence.length},}\\s*$`).test(line)) {
      fence = void 0;
    }
  }
  return false;
}
function normalizeTelegramNativeMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let fence;
  let displayMath = false;
  return lines.map((line, index) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    const inFence = fence !== void 0;
    if (!inFence && line.trim() === "$$") {
      if (displayMath) {
        displayMath = false;
        return "```";
      }
      if (hasClosingDisplayMathDelimiter(lines, index)) {
        displayMath = true;
        return "```math";
      }
    }
    if (displayMath) return line;
    if (!inFence && fenceMatch) {
      const markerText = fenceMatch[1] ?? "```";
      fence = {
        marker: markerText[0],
        length: markerText.length
      };
      return line;
    }
    if (inFence && new RegExp(`^ {0,3}${fence?.marker}{${fence?.length},}\\s*$`).test(line)) {
      fence = void 0;
      return line;
    }
    if (!inFence) return normalizeTelegramNativeMarkdownLine(line);
    return line;
  }).join("\n");
}
function splitTelegramNativeMarkdown(markdown) {
  const normalizedMarkdown = normalizeTelegramNativeMarkdown(markdown);
  if (normalizedMarkdown.length <= TELEGRAM_RICH_MESSAGE_MAX_CHARS && countTelegramNativeMarkdownBlocks(normalizedMarkdown) <= TELEGRAM_RICH_MESSAGE_MAX_BLOCKS) {
    return [normalizedMarkdown];
  }
  const chunks = [];
  let current = "";
  let currentBlockCount = 0;
  for (const rawBlock of splitTelegramNativeMarkdownBlocks(
    normalizedMarkdown
  )) {
    for (const block of splitTelegramNativeMarkdownCountedBlocks(rawBlock)) {
      const blockCount = countTelegramNativeMarkdownBlocks(block);
      const candidate = current ? `${current}

${block}` : block;
      const exceedsChars = candidate.length > TELEGRAM_RICH_MESSAGE_MAX_CHARS;
      const exceedsBlocks = currentBlockCount + blockCount > TELEGRAM_RICH_MESSAGE_MAX_BLOCKS;
      if (!exceedsChars && !exceedsBlocks) {
        current = candidate;
        currentBlockCount += blockCount;
        continue;
      }
      if (current) chunks.push(current.trimEnd());
      if (block.length <= TELEGRAM_RICH_MESSAGE_MAX_CHARS && blockCount <= TELEGRAM_RICH_MESSAGE_MAX_BLOCKS) {
        current = block;
        currentBlockCount = blockCount;
        continue;
      }
      chunks.push(...splitTelegramNativeMarkdownLongBlock(block));
      current = "";
      currentBlockCount = 0;
    }
  }
  if (current) chunks.push(current.trimEnd());
  return chunks;
}
function splitTelegramNativeMarkdownBlocks(markdown) {
  const blocks = [];
  const current = [];
  let fence;
  const flush = () => {
    if (current.length === 0) return;
    blocks.push(current.join("\n"));
    current.length = 0;
  };
  for (const line of markdown.split("\n")) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && line.trim().length === 0) {
      flush();
      continue;
    }
    current.push(line);
    if (!fence && fenceMatch) {
      const markerText = fenceMatch[1] ?? "```";
      fence = { marker: markerText[0], length: markerText.length };
      continue;
    }
    if (fence && new RegExp(`^ {0,3}${fence.marker}{${fence.length},}\\s*$`).test(line)) {
      fence = void 0;
    }
  }
  flush();
  return blocks;
}
function splitTelegramNativeMarkdownCountedBlocks(block) {
  if (countTelegramNativeMarkdownBlocks(block) <= TELEGRAM_RICH_MESSAGE_MAX_BLOCKS) {
    return [block];
  }
  const chunks = [];
  let current = [];
  let fence;
  for (const line of block.split("\n")) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && current.length >= TELEGRAM_RICH_MESSAGE_MAX_BLOCKS) {
      chunks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
    if (!fence && fenceMatch) {
      const markerText = fenceMatch[1] ?? "```";
      fence = { marker: markerText[0], length: markerText.length };
      continue;
    }
    if (fence && new RegExp(`^ {0,3}${fence.marker}{${fence.length},}\\s*$`).test(line)) {
      fence = void 0;
    }
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}
function countTelegramNativeMarkdownBlocks(block) {
  if (/^ {0,3}(`{3,}|~{3,})/.test(block)) return 1;
  const lines = block.split("\n").filter((line) => line.trim().length > 0);
  if (lines.some((line) => /^\s*([-*+] |\d+\. |>|\|)/.test(line))) {
    return Math.max(1, lines.length);
  }
  return 1;
}
function splitTelegramNativeMarkdownLongBlock(block) {
  return splitTelegramNativeMarkdownLongFenceBlock(block) ?? splitTelegramNativeMarkdownLongWrappedInlineBlock(block) ?? splitTelegramNativeMarkdownLongPlainBlock(block);
}
function splitTelegramNativeMarkdownLongPlainBlock(block) {
  const chunks = [];
  let remaining = block;
  while (remaining.length > TELEGRAM_RICH_MESSAGE_MAX_CHARS) {
    const window = remaining.slice(0, TELEGRAM_RICH_MESSAGE_MAX_CHARS + 1);
    const splitIndex = findTelegramNativeMarkdownSplitIndex(window);
    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
function splitTelegramNativeMarkdownLongFenceBlock(block) {
  const lines = block.split("\n");
  const opening = lines[0] ?? "";
  const closing = lines[lines.length - 1] ?? "";
  const openingMatch = opening?.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!openingMatch || !closing || lines.length < 2) return void 0;
  const markerText = openingMatch[1] ?? "```";
  const marker = markerText[0];
  if (!new RegExp(`^ {0,3}${marker}{${markerText.length},}\\s*$`).test(closing)) {
    return void 0;
  }
  const maxContentLength = TELEGRAM_RICH_MESSAGE_MAX_CHARS - opening.length - closing.length - 2;
  if (maxContentLength <= 0) return void 0;
  const content = lines.slice(1, -1).join("\n");
  return splitTelegramNativeMarkdownWrappedContent(
    content,
    maxContentLength,
    (chunk) => `${opening}
${chunk}${chunk.endsWith("\n") ? "" : "\n"}${closing}`
  );
}
function splitTelegramNativeMarkdownLongWrappedInlineBlock(block) {
  const delimiter = ["**", "__", "~~", "`", "*", "_"].find(
    (candidate) => block.startsWith(candidate) && block.endsWith(candidate) && block.length > candidate.length * 2
  );
  if (!delimiter) return void 0;
  const maxContentLength = TELEGRAM_RICH_MESSAGE_MAX_CHARS - delimiter.length * 2;
  if (maxContentLength <= 0) return void 0;
  return splitTelegramNativeMarkdownWrappedContent(
    block.slice(delimiter.length, -delimiter.length),
    maxContentLength,
    (chunk) => `${delimiter}${chunk}${delimiter}`
  );
}
function splitTelegramNativeMarkdownWrappedContent(content, maxContentLength, wrap) {
  const chunks = [];
  let remaining = content;
  while (remaining.length > maxContentLength) {
    const window = remaining.slice(0, maxContentLength + 1);
    const splitIndex = findTelegramNativeMarkdownSplitIndex(
      window,
      maxContentLength
    );
    chunks.push(wrap(remaining.slice(0, splitIndex)));
    remaining = remaining.slice(splitIndex);
  }
  if (remaining.length > 0) chunks.push(wrap(remaining));
  return chunks;
}
function findTelegramNativeMarkdownSplitIndex(text, hardLimit = TELEGRAM_RICH_MESSAGE_MAX_CHARS) {
  const paragraphIndex = text.lastIndexOf("\n\n", hardLimit);
  if (paragraphIndex > 0) return paragraphIndex + 2;
  const lineIndex = text.lastIndexOf("\n", hardLimit);
  if (lineIndex > 0) return lineIndex + 1;
  const spaceIndex = text.lastIndexOf(" ", hardLimit);
  if (spaceIndex > 0) return spaceIndex + 1;
  return hardLimit;
}
async function sendTelegramNativeMarkdownReply(chatId, replyToMessageId, markdown, deps, options) {
  assertTelegramInlineKeyboardCallbackData(options?.replyMarkup);
  let lastMessageId;
  const chunks = splitTelegramNativeMarkdown(markdown);
  for (const [index, chunk] of chunks.entries()) {
    const replyParameters = index === 0 ? buildTelegramReplyParameters(
      chatId,
      replyToMessageId,
      options?.target
    ) : void 0;
    const sent = await deps.sendRichMessage({
      chat_id: chatId,
      rich_message: { markdown: chunk, skip_entity_detection: true },
      reply_markup: index === chunks.length - 1 ? options?.replyMarkup : void 0,
      ...replyParameters ? { reply_parameters: replyParameters } : {},
      ...options?.target ? getTelegramTargetThreadParams(options.target) : {}
    });
    lastMessageId = sent.message_id;
    deps.recordOwnership?.({
      chatId,
      messageId: sent.message_id,
      target: options?.target
    });
  }
  return lastMessageId;
}

// lib/outbound-buttons.ts
var TELEGRAM_BUTTON_ACTION_TTL_MS = 24 * 60 * 60 * 1e3;

// lib/preview.ts
function createTelegramPreviewRuntimeState() {
  return {
    mode: "draft",
    pendingText: "",
    lastSentText: ""
  };
}
function shouldUseTelegramDraftPreview(_options) {
  return true;
}
async function clearTelegramPreview(chatId, deps, options = {}) {
  const state = deps.getState();
  if (!state) return;
  if (state.flushPromise && options.awaitFlush !== false) {
    state.flushRequested = false;
    await state.flushPromise.catch(() => {
    });
    if (deps.getState() !== state) return;
  }
  deps.setState(void 0);
  if (state.mode === "draft" && state.draftId !== void 0) {
    try {
      await deps.sendDraft(chatId, state.draftId, void 0, {
        ...getTelegramTargetThreadParams(options.target ?? { chatId })
      });
    } catch (error) {
      deps.recordRuntimeEvent?.("preview", error, {
        phase: "clear-draft",
        chatId,
        draftId: state.draftId
      });
    }
  }
}
function createTelegramDraftInlineState() {
  return {
    codeTicks: 0,
    htmlComment: false,
    displayMath: false,
    strongAsterisk: false,
    emphasisAsterisk: false,
    strongUnderscore: false,
    emphasisUnderscore: false,
    strike: false,
    linkText: false,
    linkDestination: false
  };
}
function isTelegramDraftInlineStateClosed(state) {
  return state.codeTicks === 0 && !state.htmlComment && !state.displayMath && !state.fence && !state.strongAsterisk && !state.emphasisAsterisk && !state.strongUnderscore && !state.emphasisUnderscore && !state.strike && !state.linkText && !state.linkDestination;
}
function countRepeatedChars(text, index, char) {
  let count = 0;
  while (text[index + count] === char) count += 1;
  return count;
}
function isEscapedMarkdownChar(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
function isInlineDelimiterCandidate(text, index, length) {
  const previous = text[index - 1] ?? "";
  const next = text[index + length] ?? "";
  if (!next || /\s/.test(next))
    return previous.length > 0 && !/\s/.test(previous);
  if (!previous || /\s/.test(previous)) return true;
  return /[\p{P}\p{S}]/u.test(previous) || /[\p{P}\p{S}]/u.test(next);
}
function updateTelegramDraftInlineStateForLine(line, state) {
  if (state.fence || state.displayMath) return;
  for (let index = 0; index < line.length; index += 1) {
    if (state.htmlComment) {
      const closeIndex = line.indexOf("-->", index);
      if (closeIndex === -1) return;
      state.htmlComment = false;
      index = closeIndex + 2;
      continue;
    }
    if (state.codeTicks > 0) {
      const ticks2 = countRepeatedChars(line, index, "`");
      if (ticks2 >= state.codeTicks) {
        state.codeTicks = 0;
        index += ticks2 - 1;
      }
      continue;
    }
    if (isEscapedMarkdownChar(line, index)) continue;
    if (line.startsWith("<!--", index)) {
      const closeIndex = line.indexOf("-->", index + 4);
      if (closeIndex === -1) {
        state.htmlComment = true;
        return;
      }
      index = closeIndex + 2;
      continue;
    }
    const ticks = countRepeatedChars(line, index, "`");
    if (ticks > 0) {
      state.codeTicks = ticks;
      index += ticks - 1;
      continue;
    }
    if (line.startsWith("][", index) || line.startsWith("](", index)) {
      state.linkText = false;
      state.linkDestination = true;
      index += 1;
      continue;
    }
    if (line[index] === "[" && !state.linkDestination) {
      state.linkText = true;
      continue;
    }
    if (line[index] === ")" && state.linkDestination) {
      state.linkDestination = false;
      continue;
    }
    if (line.startsWith("~~", index) && isInlineDelimiterCandidate(line, index, 2)) {
      state.strike = !state.strike;
      index += 1;
      continue;
    }
    if (line.startsWith("**", index) && isInlineDelimiterCandidate(line, index, 2)) {
      state.strongAsterisk = !state.strongAsterisk;
      index += 1;
      continue;
    }
    if (line[index] === "*" && isInlineDelimiterCandidate(line, index, 1)) {
      state.emphasisAsterisk = !state.emphasisAsterisk;
      continue;
    }
    if (line.startsWith("__", index) && isInlineDelimiterCandidate(line, index, 2)) {
      state.strongUnderscore = !state.strongUnderscore;
      index += 1;
      continue;
    }
    if (line[index] === "_" && isInlineDelimiterCandidate(line, index, 1)) {
      state.emphasisUnderscore = !state.emphasisUnderscore;
    }
  }
}
function updateTelegramDraftBlockStateForLine(line, state) {
  const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (state.fence) {
    if (new RegExp(
      `^ {0,3}${state.fence.marker}{${state.fence.length},}\\s*$`
    ).test(line)) {
      state.fence = void 0;
    }
    return true;
  }
  if (state.displayMath) {
    if (line.trim() === "$$") state.displayMath = false;
    return true;
  }
  if (fenceMatch) {
    const markerText = fenceMatch[1] ?? "```";
    state.fence = {
      marker: markerText[0],
      length: markerText.length
    };
    return true;
  }
  if (line.trim() === "$$") {
    state.displayMath = true;
    return true;
  }
  return false;
}
function findSafeTelegramRichMarkdownDraftEnd(markdown) {
  const state = createTelegramDraftInlineState();
  let offset = 0;
  let safeEnd = 0;
  for (const line of markdown.split("\n")) {
    const lineEnd = offset + line.length;
    const consumedAsBlock = updateTelegramDraftBlockStateForLine(line, state);
    if (!consumedAsBlock) updateTelegramDraftInlineStateForLine(line, state);
    const nextOffset = lineEnd + 1;
    if (isTelegramDraftInlineStateClosed(state)) safeEnd = lineEnd;
    offset = nextOffset;
  }
  if (isTelegramDraftInlineStateClosed(state)) return markdown.length;
  return safeEnd;
}
function hasTelegramPreviewVisibleContent(markdown) {
  return /[\p{L}\p{N}]/u.test(markdown);
}
function getSafeTelegramRichMarkdownDraftPrefix(markdown, maxMessageLength) {
  const source = markdown.trim();
  if (!source) return void 0;
  const limited = source.length > maxMessageLength ? source.slice(0, maxMessageLength) : source;
  const safeEnd = findSafeTelegramRichMarkdownDraftEnd(limited);
  if (safeEnd > 0) {
    const safePrefix = limited.slice(0, safeEnd).trimEnd();
    return hasTelegramPreviewVisibleContent(safePrefix) ? safePrefix : void 0;
  }
  let candidateEnd = limited.length;
  while (candidateEnd > 0) {
    candidateEnd = limited.lastIndexOf(" ", candidateEnd - 1);
    if (candidateEnd <= 0) return void 0;
    const candidate = limited.slice(0, candidateEnd).trimEnd();
    if (hasTelegramPreviewVisibleContent(candidate) && findSafeTelegramRichMarkdownDraftEnd(candidate) === candidate.length) {
      return candidate || void 0;
    }
  }
  return void 0;
}
function buildTelegramNativeMarkdownPreviewSnapshot(state, maxMessageLength) {
  const safeText = getSafeTelegramRichMarkdownDraftPrefix(
    state.pendingText,
    maxMessageLength
  );
  if (!safeText || safeText === state.lastSentText) return void 0;
  return { text: safeText };
}
async function performTelegramPreviewFlush(chatId, state, deps, options = {}) {
  if (deps.canSend && !deps.canSend()) {
    await clearTelegramPreview(chatId, deps, {
      awaitFlush: false,
      target: options.target
    });
    return;
  }
  const snapshot = buildTelegramNativeMarkdownPreviewSnapshot(
    state,
    deps.maxMessageLength
  );
  if (!snapshot) return;
  if (shouldUseTelegramDraftPreview({
    draftSupport: deps.getDraftSupport(),
    snapshot
  })) {
    const draftId = state.draftId ?? deps.allocateDraftId();
    state.draftId = draftId;
    try {
      await deps.sendDraft(
        chatId,
        draftId,
        normalizeTelegramNativeMarkdown(snapshot.text),
        { ...getTelegramTargetThreadParams(options.target ?? { chatId }) }
      );
      deps.setDraftSupport("supported");
      state.mode = "draft";
      state.lastSentText = snapshot.text;
      return;
    } catch (error) {
      deps.recordRuntimeEvent?.("preview", error, {
        phase: "draft",
        chatId,
        draftId
      });
      return;
    }
  }
}
async function flushTelegramPreview(chatId, deps, options = {}) {
  const state = deps.getState();
  if (!state) return;
  if (state.flushPromise) {
    state.flushRequested = true;
    await state.flushPromise;
    return;
  }
  state.flushPromise = (async () => {
    do {
      state.flushRequested = false;
      try {
        await performTelegramPreviewFlush(chatId, state, deps, options);
      } catch (error) {
        deps.recordRuntimeEvent?.("preview", error, {
          phase: "flush",
          chatId,
          draftId: state.draftId
        });
        break;
      }
    } while (deps.getState() === state && state.flushRequested);
  })();
  try {
    await state.flushPromise;
  } finally {
    if (deps.getState() === state) {
      state.flushPromise = void 0;
    }
  }
}
export {
  createTelegramConfigStore,
  createTelegramLockRuntime,
  createTelegramPreviewRuntimeState,
  flushTelegramPreview,
  isProcessAlive,
  normalizeTelegramNativeMarkdown,
  resolveTelegramLockKey,
  sendTelegramNativeMarkdownReply
};
