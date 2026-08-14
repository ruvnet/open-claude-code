import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isProtectedHarnessPath } from "./path-safety.mjs";

const defaultAllowlist = [
  ".env.example",
];
const reportLimit = 50;
const staleAfterMs = 30 * 24 * 60 * 60 * 1000;
const contextSizeLimit = 25 * 1024;

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function readGitPaths(rootDir, args) {
  const output = execFileSync("git", [...args, "-z"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split("\0").filter(Boolean).map(normalizePath);
}

function readInventory(rootDir) {
  const protectedIgnored = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--",
      ":(icase).env",
      ":(icase).env.*",
      ":(icase)**/.env",
      ":(icase)**/.env.*",
    ],
    { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).split("\0").filter(Boolean).map(normalizePath);
  return {
    tracked: readGitPaths(rootDir, ["ls-files"]),
    untracked: [...new Set([
      ...readGitPaths(rootDir, ["ls-files", "--others", "--exclude-standard"]),
      ...protectedIgnored,
    ])],
  };
}

function isGenerated(filePath) {
  return /^(dist|coverage|\.cache|\.vite|reports\/generated)(\/|$)/i.test(filePath) || /\.tsbuildinfo$/i.test(filePath);
}

function isTemporary(filePath) {
  return /(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(filePath) || /(?:\.log|\.tmp|\.temp|\.swp|~)$/i.test(filePath);
}

function isDependency(filePath) {
  return /^(node_modules|vendor)(\/|$)/i.test(filePath);
}

function isSecretRisk(filePath) {
  const basename = path.posix.basename(filePath);
  return /^(credentials?|service-account|tokens?|api[-_]?key|secrets?|private[-_]?key)(?:\.[^.]+)?$/i.test(basename)
    || /^id_rsa$/i.test(basename)
    || /\.(?:pem|key|p12|pfx)$/i.test(basename);
}

function ownershipFor(filePath, tracked, untracked) {
  if (tracked.has(filePath) || [...tracked].some((entry) => entry.startsWith(`${filePath}/`))) return "tracked";
  if (untracked.has(filePath) || [...untracked].some((entry) => entry.startsWith(`${filePath}/`))) return "untracked";
  return "ignored";
}

async function statIfPresent(rootDir, filePath) {
  try {
    return await fs.stat(path.join(rootDir, ...filePath.split("/")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function mightBeStaleReport(filePath) {
  return /(^|\/)(?:harness|benchmark|evaluation|assessment)[-_].*\.(?:json|md|txt)$/i.test(filePath);
}

export async function scanCleanup({
  rootDir = process.cwd(),
  inventory: suppliedInventory,
  allowlist = [],
  now = new Date(),
} = {}) {
  const errors = [];
  let inventory = suppliedInventory;
  if (!inventory) {
    try {
      inventory = readInventory(rootDir);
    } catch (error) {
      errors.push(`Git inventory could not be read: ${error instanceof Error ? error.message : String(error)}`);
      inventory = { tracked: [], untracked: [] };
    }
  }

  const tracked = new Set(inventory.tracked.map(normalizePath));
  const untracked = new Set(inventory.untracked.map(normalizePath));
  const allowlisted = new Set([...defaultAllowlist, ...allowlist].map(normalizePath));
  const candidates = new Set([...tracked, ...untracked]);
  for (const directory of ["node_modules", "dist", "coverage", ".cache"]) {
    if (await statIfPresent(rootDir, directory)) candidates.add(directory);
  }
  try {
    const rootNames = await fs.readdir(rootDir);
    for (const name of rootNames) {
      if (isProtectedHarnessPath(name)) candidates.add(name);
    }
  } catch (error) {
    errors.push(`Repository root could not be listed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const hasPackageLock = candidates.has("package-lock.json") || Boolean(await statIfPresent(rootDir, "package-lock.json"));
  const findings = [];
  const protectedEntries = [];
  const allowed = [];

  for (const filePath of [...candidates].sort()) {
    const ownership = ownershipFor(filePath, tracked, untracked);
    const stat = await statIfPresent(rootDir, filePath);
    if (!stat) continue;
    if (isProtectedHarnessPath(filePath)) {
      protectedEntries.push({ path: filePath, ownership, reason: "Protected user or environment file; report only." });
      continue;
    }
    const secretRisk = isSecretRisk(filePath);
    if (allowlisted.has(filePath) && !secretRisk) {
      allowed.push({ path: filePath, ownership, reason: "Explicit cleanup allowlist." });
      continue;
    }

    const categories = [];
    if (isGenerated(filePath)) categories.push("generated");
    if (isTemporary(filePath)) categories.push("temporary");
    if (isDependency(filePath)) categories.push("dependency");
    if (secretRisk) categories.push("secret-risk");
    if (hasPackageLock && /^(pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(filePath)) {
      categories.push("duplicate");
    }

    if (
      (mightBeStaleReport(filePath) && stat && now.getTime() - stat.mtimeMs > staleAfterMs)
      || (["progress.md", "session-handoff.md"].includes(filePath) && stat && stat.size > contextSizeLimit)
    ) {
      categories.push("stale");
    }
    if (ownership === "untracked" && categories.length === 0) categories.push("unowned");
    if (categories.length === 0) continue;

    findings.push({
      path: filePath,
      ownership,
      categories: [...new Set(categories)],
      recommendation: categories.includes("secret-risk")
        ? "Review exposure and repository policy; do not print file contents."
        : "Review ownership and intent manually; this scanner takes no action.",
    });
  }

  return {
    errors,
    inventory: { tracked: tracked.size, untracked: untracked.size },
    findings,
    protected: protectedEntries,
    allowed,
    policy: "Report only: no delete, move, content read, or repository-state write operations are performed.",
  };
}

async function main() {
  const result = await scanCleanup();
  console.log("Cleanup scan (read-only)");
  console.log(`Inventory: ${result.inventory.tracked} tracked, ${result.inventory.untracked} untracked`);
  console.log(`Findings: ${result.findings.length}; protected: ${result.protected.length}; allowed: ${result.allowed.length}`);
  for (const finding of result.findings.slice(0, reportLimit)) {
    console.log(`- [${finding.ownership}] ${finding.path}: ${finding.categories.join(", ")}`);
  }
  if (result.findings.length > reportLimit) {
    console.log(`- ${result.findings.length - reportLimit} additional finding(s) omitted from bounded output.`);
  }
  for (const entry of result.protected.slice(0, reportLimit)) {
    console.log(`- [protected/${entry.ownership}] ${entry.path}`);
  }
  for (const error of result.errors) console.error(`Error: ${error}`);
  console.log(result.policy);
  if (result.errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
