import fs from "node:fs";
import path from "node:path";

import { parseStrictIsoTimestamp } from "./validate-state.mjs";

export const MAX_MEMORY_ENTRIES = 200;
export const MAX_MEMORY_INDEX_BYTES = 8 * 1024;
export const MAX_MEMORY_TOPIC_BYTES = 8 * 1024;

const allowedScopes = new Set(["decision", "preference", "constraint", "feedback"]);
const safeTitle = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const safeTopic = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const sensitivePatterns = [
  /(?:^|\n)\s*[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)\s*=\s*\S+/im,
  /\b(?:authorization|token|secret|password|api[ _-]?key)\s*:\s*(?:bearer\s+)?\S{8,}/i,
  /\bbearer\s+[A-Za-z0-9._-]{12,}\b/i,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/i,
  /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/i,
  /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})\b/,
];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const realpath = fs.realpathSync.native ?? fs.realpathSync;

function defaultIndex() {
  return {
    version: 1,
    maxEntries: MAX_MEMORY_ENTRIES,
    maxIndexBytes: MAX_MEMORY_INDEX_BYTES,
    entries: [],
  };
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveRoot(root) {
  if (typeof root !== "string" || !root) {
    throw new Error("Memory root must be a directory.");
  }
  try {
    const resolved = realpath(root);
    if (!fs.lstatSync(resolved).isDirectory()) {
      throw new Error("not a directory");
    }
    return resolved;
  } catch {
    throw new Error("Memory root must resolve to an existing directory.");
  }
}

function ensureSafeDirectory(root, directory, create) {
  if (fs.existsSync(directory)) {
    const details = fs.lstatSync(directory);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new Error("Memory paths must not traverse links or non-directory boundaries.");
    }
  } else if (create) {
    fs.mkdirSync(directory);
  } else {
    return directory;
  }
  const resolved = realpath(directory);
  if (!isInside(root, resolved)) {
    throw new Error("Memory paths must remain inside the selected root.");
  }
  return resolved;
}

export function resolveMemoryPaths(root = process.cwd(), { create = false } = {}) {
  const resolvedRoot = resolveRoot(root);
  const agents = ensureSafeDirectory(resolvedRoot, path.join(resolvedRoot, ".agents"), create);
  const memory = ensureSafeDirectory(resolvedRoot, path.join(agents, "memory"), create);
  const topics = ensureSafeDirectory(resolvedRoot, path.join(memory, "topics"), create);
  return {
    root: resolvedRoot,
    memory,
    topics,
    index: path.join(memory, "index.json"),
  };
}

function assertSafeRegularFile(root, file) {
  if (!fs.existsSync(file)) {
    return;
  }
  const details = fs.lstatSync(file);
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new Error("Memory index must be a regular file inside the selected root.");
  }
  if (!isInside(root, realpath(file))) {
    throw new Error("Memory index must remain inside the selected root.");
  }
}

function containsSensitiveContent(value) {
  return sensitivePatterns.some((pattern) => pattern.test(value));
}

function validateText(value, label, { minimum = 1, maximum = MAX_MEMORY_TOPIC_BYTES } = {}) {
  if (typeof value !== "string" || value.trim().length < minimum || Buffer.byteLength(value, "utf8") > maximum) {
    throw new Error(`Memory ${label} is outside its bounded format.`);
  }
  if (containsSensitiveContent(value)) {
    throw new Error("Memory content appears sensitive and cannot be persisted.");
  }
}

function validateIndexEntry(entry) {
  if (!isRecord(entry)) {
    throw new Error("Memory index entries must be well-formed and non-sensitive.");
  }
  const allowedKeys = ["topic", "retrieval", "title", "scope", "savedAt", "reason"];
  if (Object.keys(entry).length !== allowedKeys.length || Object.keys(entry).some((key) => !allowedKeys.includes(key))) {
    throw new Error("Memory index entries must be well-formed and non-sensitive.");
  }
  if (typeof entry.topic !== "string" || !safeTopic.test(entry.topic)
    || entry.retrieval !== `.agents/memory/topics/${entry.topic}`
    || typeof entry.title !== "string" || !safeTitle.test(entry.title) || entry.title.length > 80
    || !allowedScopes.has(entry.scope)
    || typeof entry.savedAt !== "string" || !Number.isFinite(parseStrictIsoTimestamp(entry.savedAt))) {
    throw new Error("Memory index entries must be well-formed and non-sensitive.");
  }
  validateText(entry.reason, "index reason", { minimum: 24, maximum: 1024 });
}

function validateIndex(index, serializedBytes) {
  if (!isRecord(index) || index.version !== 1 || !Array.isArray(index.entries)) {
    throw new Error("Memory index must be a versioned object with an entries array.");
  }
  if (!Number.isInteger(index.maxEntries) || index.maxEntries < 1 || index.maxEntries > MAX_MEMORY_ENTRIES) {
    throw new Error("Memory index maxEntries must be a positive bounded integer.");
  }
  if (!Number.isInteger(index.maxIndexBytes) || index.maxIndexBytes < 256 || index.maxIndexBytes > MAX_MEMORY_INDEX_BYTES) {
    throw new Error("Memory index maxIndexBytes must be a positive bounded integer.");
  }
  if (index.entries.length > index.maxEntries || index.entries.length > MAX_MEMORY_ENTRIES || serializedBytes > index.maxIndexBytes) {
    throw new Error("Memory index exceeds its bounded entry or byte budget.");
  }
  for (const entry of index.entries) {
    validateIndexEntry(entry);
  }
  return index;
}

function readMemoryIndexAt(paths) {
  if (!fs.existsSync(paths.index)) {
    return defaultIndex();
  }
  try {
    assertSafeRegularFile(paths.root, paths.index);
    const size = fs.statSync(paths.index).size;
    if (size > MAX_MEMORY_INDEX_BYTES) {
      throw new Error("Memory index exceeds the read-time byte budget.");
    }
    const raw = fs.readFileSync(paths.index, "utf8");
    return validateIndex(JSON.parse(raw), Buffer.byteLength(raw, "utf8"));
  } catch {
    throw new Error("Memory index is invalid and was left unchanged.");
  }
}

function validateSaveInput({ title, scope, durabilityReason, content, savedAt }) {
  if (typeof title !== "string" || !safeTitle.test(title) || title.length > 80) {
    throw new Error("Memory title must be a short lowercase kebab-case identifier.");
  }
  if (!allowedScopes.has(scope)) {
    throw new Error("Memory scope is not allowed.");
  }
  validateText(title, "title", { maximum: 80 });
  validateText(durabilityReason, "durability reason", { minimum: 24, maximum: 1024 });
  validateText(content, "content");
  if (typeof savedAt !== "string" || !Number.isFinite(parseStrictIsoTimestamp(savedAt))) {
    throw new Error("Memory savedAt must be a strict ISO timestamp.");
  }
}

function writeAtomically(root, file, content) {
  const parent = realpath(path.dirname(file));
  if (!isInside(root, parent)) {
    throw new Error("Memory write target must remain inside the selected root.");
  }
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    // This is the unique temporary file created above; durable topics and indexes stay untouched.
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function nextTopicPath(paths, title) {
  let suffix = 1;
  let candidate = path.join(paths.topics, `${title}.md`);
  while (fs.existsSync(candidate)) {
    suffix += 1;
    candidate = path.join(paths.topics, `${title}-${suffix}.md`);
  }
  return candidate;
}

export function readMemoryIndex(root = process.cwd()) {
  return readMemoryIndexAt(resolveMemoryPaths(root));
}

export function saveMemory({ root = process.cwd(), title, scope, durabilityReason, content, savedAt = new Date().toISOString() }) {
  validateSaveInput({ title, scope, durabilityReason, content, savedAt });
  const paths = resolveMemoryPaths(root, { create: true });
  const index = readMemoryIndexAt(paths);
  if (index.entries.length >= index.maxEntries) {
    throw new Error("Memory index entry limit reached before a topic write.");
  }

  const topicPath = nextTopicPath(paths, title);
  const entry = {
    topic: path.basename(topicPath),
    retrieval: `.agents/memory/topics/${path.basename(topicPath)}`,
    title,
    scope,
    savedAt,
    reason: durabilityReason.trim(),
  };
  const nextIndex = { ...index, entries: [...index.entries, entry] };
  const serializedIndex = `${JSON.stringify(nextIndex, null, 2)}\n`;
  if (Buffer.byteLength(serializedIndex, "utf8") > index.maxIndexBytes) {
    throw new Error("Memory index size limit reached before a topic write.");
  }

  const topic = [
    `# Durable Memory: ${title}`,
    "",
    `- Scope: ${scope}`,
    `- Saved: ${savedAt}`,
    `- Why durable: ${durabilityReason.trim()}`,
    "",
    "## Detail",
    "",
    content.trim(),
    "",
  ].join("\n");
  // The topic becomes durable before its pointer update; a process crash here yields a report-only orphan.
  writeAtomically(paths.root, topicPath, topic);
  writeAtomically(paths.root, paths.index, serializedIndex);

  return { topicPath, entry };
}
