import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatHookStatus, invokeConfiguredHook } from "../../.agents/hooks/hook-gate.mjs";
import { isProtectedHarnessPath } from "./path-safety.mjs";
import { parseStrictIsoTimestamp, validateHarnessState } from "./validate-state.mjs";

const previewLimit = 20;
const allowedLifecycleStatuses = new Set(["in-progress", "blocked", "done"]);

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function runGit(rootDir, args) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function readNullSeparatedGit(rootDir, args) {
  const output = execFileSync("git", [...args, "-z"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split("\0").filter(Boolean).map(normalizePath);
}

function readIgnoredEnvironmentPaths(rootDir) {
  const output = execFileSync(
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
  );
  return output.split("\0").filter(Boolean).map(normalizePath).filter(isProtectedHarnessPath);
}

export function readGitSnapshot(rootDir) {
  const trackedChanges = new Set([
    ...readNullSeparatedGit(rootDir, ["diff", "--name-only"]),
    ...readNullSeparatedGit(rootDir, ["diff", "--cached", "--name-only"]),
  ]);
  const untrackedFiles = new Set([
    ...readNullSeparatedGit(rootDir, ["ls-files", "--others", "--exclude-standard"]),
    ...readIgnoredEnvironmentPaths(rootDir),
  ]);
  return {
    branch: runGit(rootDir, ["branch", "--show-current"]),
    commit: runGit(rootDir, ["rev-parse", "HEAD"]),
    trackedChanges: [...trackedChanges].sort(),
    untrackedFiles: [...untrackedFiles].sort(),
  };
}

function extractUniqueField(text, field, source, errors) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...text.matchAll(new RegExp(`^(?:-\\s*)?\\*\\*${escaped}:\\*\\*\\s*(.+?)\\s*$`, "gim"))];
  if (matches.length > 1) errors.push(`${source} contains duplicate ${field} rows`);
  return matches[0]?.[1]?.trim();
}

function normalizeInline(value) {
  return value?.replace(/\s+/g, " ").trim();
}

function extractBoundedSection(text, heading, source, errors, { maxLines, maxChars }) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingMatches = [...text.matchAll(new RegExp(`^## ${escaped}\\s*$`, "gim"))];
  const headingMatch = headingMatches[0];
  if (!headingMatch) {
    errors.push(`${source} is missing ${heading}`);
    return "";
  }
  if (headingMatches.length > 1) errors.push(`${source} contains duplicate ${heading} headings`);
  const contentStart = headingMatch.index + headingMatch[0].length;
  const remaining = text.slice(contentStart);
  const nextHeading = /^##\s+/m.exec(remaining);
  const section = (nextHeading ? remaining.slice(0, nextHeading.index) : remaining).trim();
  const normalizedLines = section.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (normalizedLines.length === 0) {
    errors.push(`${source} ${heading} must be non-empty`);
    return "";
  }
  if (normalizedLines.length > maxLines || section.length > maxChars) {
    errors.push(`${source} ${heading} exceeds its bounded size (${maxLines} lines/${maxChars} characters)`);
  }
  return normalizedLines.join("\n");
}

function stripCode(value) {
  return value?.replace(/^`([^`]+)`(?:\s+-\s+.*)?$/, "$1").trim();
}

function parseVerificationContract(text, source, errors) {
  const section = extractBoundedSection(text, "Verification Contract", source, errors, {
    maxLines: 8,
    maxChars: 1024,
  });
  const verification = {
    command: stripCode(extractUniqueField(section, "Command", `${source} Verification Contract`, errors)),
    result: normalizeInline(extractUniqueField(section, "Result", `${source} Verification Contract`, errors)),
    count: stripCode(extractUniqueField(section, "Count", `${source} Verification Contract`, errors)),
    captured: stripCode(extractUniqueField(section, "Captured", `${source} Verification Contract`, errors)),
    completePassingCount: false,
  };
  for (const field of ["command", "result", "count", "captured"]) {
    const value = verification[field];
    if (!value) errors.push(`${source} Verification Contract is missing ${field}`);
  }
  if (verification.command && verification.command !== "./init.sh") {
    errors.push(`${source} verification command must be ./init.sh`);
  }
  if (verification.result && !/^(Pass|Fail)$/i.test(verification.result)) {
    errors.push(`${source} verification result must be Pass or Fail`);
  }
  if (verification.count) {
    const countMatch = verification.count.match(/^(\d+)\/(\d+)$/);
    if (!countMatch) {
      errors.push(`${source} verification count must use passed/total integer format`);
    } else {
      const passed = Number(countMatch[1]);
      const total = Number(countMatch[2]);
      if (total === 0) errors.push(`${source} verification count total must be greater than zero`);
      if (passed > total) errors.push(`${source} verification count passed must not exceed total`);
      if (/^Pass$/i.test(verification.result ?? "") && passed !== total) {
        errors.push(`${source} passing verification count requires passed to equal total`);
      }
      verification.completePassingCount = total > 0 && passed === total;
    }
  }
  if (verification.captured && !Number.isFinite(parseStrictIsoTimestamp(verification.captured))) {
    errors.push(`${source} verification captured must be an ISO timestamp`);
  }
  return verification;
}

function parseRisksContract(text, source, errors) {
  const section = extractBoundedSection(text, "Risks / Boundaries", source, errors, {
    maxLines: 10,
    maxChars: 2048,
  });
  if (!section) return "";
  const entries = [];
  const seen = new Set();
  for (const line of section.split("\n")) {
    const match = line.match(/^- \*\*([^:*]+):\*\*\s*(.+)$/);
    if (!match) {
      errors.push(`${source} Risks / Boundaries rows must use - **Name:** value`);
      continue;
    }
    const key = normalizeInline(match[1]).toLowerCase();
    const value = normalizeInline(match[2]);
    if (!value) errors.push(`${source} Risks / Boundaries ${key} must be non-empty`);
    if (seen.has(key)) errors.push(`${source} Risks / Boundaries contains duplicate ${key}`);
    seen.add(key);
    entries.push(`${key}: ${value}`);
  }
  for (const required of ["protected files", "package manager", "external mutations"]) {
    if (!seen.has(required)) errors.push(`${source} Risks / Boundaries requires ${required}`);
  }
  return entries.join("\n");
}

function parseRestartContract(text, source, errors, featureField) {
  const restartSection = extractBoundedSection(text, "Restart Contract", source, errors, {
    maxLines: 12,
    maxChars: 4096,
  });
  const rawFeature = extractUniqueField(restartSection, featureField, `${source} Restart Contract`, errors);
  const featureId = rawFeature?.match(/`?(feat-\d{3,})`?/i)?.[1] ?? null;
  const verification = parseVerificationContract(text, source, errors);
  const risks = parseRisksContract(text, source, errors);
  const contract = {
    featureId,
    branch: stripCode(extractUniqueField(restartSection, "Branch", `${source} Restart Contract`, errors)),
    objective: normalizeInline(extractUniqueField(restartSection, "Objective", `${source} Restart Contract`, errors)),
    status: normalizeInline(extractUniqueField(restartSection, "Status", `${source} Restart Contract`, errors))?.toLowerCase(),
    nextAction: normalizeInline(extractUniqueField(restartSection, "Canonical next action", `${source} Restart Contract`, errors)),
    verificationCommand: verification.command,
    verificationResult: verification.result,
    verificationCount: verification.count,
    verificationCaptured: verification.captured,
    hasCanonicalVerification: verification.command === "./init.sh"
      && /^Pass$/i.test(verification.result ?? "")
      && verification.completePassingCount,
    risks,
  };

  for (const [field, value] of Object.entries(contract)) {
    if (["hasCanonicalVerification", "risks"].includes(field)) continue;
    if (field === "featureId" && /^none$/i.test(rawFeature ?? "")) continue;
    if (value === null || value === undefined || value === "") {
      errors.push(`${source} is missing restart field ${field}`);
    }
  }
  if (contract.status && !allowedLifecycleStatuses.has(contract.status)) {
    errors.push(`${source} status ${JSON.stringify(contract.status)} is unsupported; use in-progress, blocked, or done`);
  }
  return contract;
}

async function readRequired(rootDir, relativePath, errors) {
  try {
    return await fs.readFile(path.join(rootDir, relativePath), "utf8");
  } catch (error) {
    errors.push(`${relativePath} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

function compareContracts(progress, handoff, errors) {
  for (const field of [
    "featureId",
    "branch",
    "objective",
    "status",
    "nextAction",
    "verificationCommand",
    "verificationResult",
    "verificationCount",
    "verificationCaptured",
  ]) {
    if (progress[field] !== handoff[field]) {
      const labels = {
        nextAction: "canonical next action",
        verificationCommand: "verification command",
        verificationResult: "verification result",
        verificationCount: "verification count",
        verificationCaptured: "verification captured",
      };
      const label = labels[field] ?? field;
      errors.push(`progress.md and session-handoff.md ${label} values disagree`);
    }
  }
  if (progress.risks !== handoff.risks) {
    errors.push("progress.md and session-handoff.md Risks / Boundaries values disagree");
  }
}

function parseEvidenceSummary(evidence) {
  if (typeof evidence !== "string") return null;
  const match = evidence.match(
    /Latest verification:\s*`?(\.\/init\.sh)`?\s*=>\s*(Pass|Fail)\s*\((\d+\/\d+)\)\s*at\s*([^\s.]+(?:[+-]\d{2}:\d{2}|Z))/i,
  );
  if (!match) return null;
  return { command: match[1], result: match[2], count: match[3], captured: match[4] };
}

function containsCompletionWording(status) {
  return /\b(?:done|complete|completed|completion|ready for completion)\b/i.test(status ?? "");
}

export async function collectSessionStart({
  rootDir = process.cwd(),
  gitSnapshot: suppliedGitSnapshot,
  trustMode: suppliedTrustMode = process.env.HARNESS_TRUST_MODE,
} = {}) {
  const errors = [];
  const warnings = [];
  const trustMode = suppliedTrustMode === "trusted" ? "trusted" : "untrusted";
  if (suppliedTrustMode && !["trusted", "untrusted"].includes(suppliedTrustMode)) {
    warnings.push(`Unknown trust mode ${JSON.stringify(suppliedTrustMode)}; using fail-closed untrusted mode.`);
  }
  const state = await validateHarnessState({ rootDir });
  errors.push(...state.errors.map((error) => `State: ${error}`));

  const [progressText, handoffText, featureListText] = await Promise.all([
    readRequired(rootDir, "progress.md", errors),
    readRequired(rootDir, "session-handoff.md", errors),
    readRequired(rootDir, "feature_list.json", errors),
  ]);
  const progress = parseRestartContract(progressText, "progress.md", errors, "Active feature");
  const handoff = parseRestartContract(handoffText, "session-handoff.md", errors, "Feature");
  compareContracts(progress, handoff, errors);

  let gitSnapshot = suppliedGitSnapshot;
  if (!gitSnapshot) {
    try {
      gitSnapshot = readGitSnapshot(rootDir);
    } catch (error) {
      errors.push(`Git state could not be read: ${error instanceof Error ? error.message : String(error)}`);
      gitSnapshot = { branch: "unknown", commit: "unknown", trackedChanges: [], untrackedFiles: [] };
    }
  }

  if (state.activeFeatureId !== progress.featureId) {
    errors.push(`Validated active feature ${state.activeFeatureId ?? "none"} does not match progress ${progress.featureId ?? "none"}`);
  }
  let activeFeatureStatus = null;
  let activeFeature = null;
  try {
    const featureList = JSON.parse(featureListText);
    activeFeature = featureList.features?.find((feature) => feature?.id === state.activeFeatureId) ?? null;
    activeFeatureStatus = activeFeature?.status ?? null;
  } catch {
    // validateHarnessState already supplies the actionable JSON parsing error.
  }
  if (
    activeFeatureStatus === "in-progress"
    && containsCompletionWording(progress.status)
  ) {
    errors.push("A completion claim conflicts with feature_list.json status in-progress.");
  }
  if (activeFeatureStatus && progress.status !== activeFeatureStatus) {
    errors.push(`Restart status ${progress.status ?? "missing"} does not match feature_list.json status ${activeFeatureStatus}.`);
  }
  if (!activeFeatureStatus && progress.status === "in-progress") {
    errors.push("Restart status in-progress requires an active feature in feature_list.json.");
  }
  if (activeFeature) {
    const evidenceSummary = parseEvidenceSummary(activeFeature.evidence);
    if (!evidenceSummary) {
      errors.push("Active feature evidence is missing the canonical Latest verification summary.");
    } else {
      for (const [field, expected] of Object.entries({
        command: progress.verificationCommand,
        result: progress.verificationResult,
        count: progress.verificationCount,
        captured: progress.verificationCaptured,
      })) {
        if (evidenceSummary[field] !== expected) {
          errors.push(`Active feature evidence verification ${field} disagrees with the restart contract.`);
        }
      }
    }
    if (
      /^Pass$/i.test(progress.verificationResult ?? "")
      && /(?:baseline|init|typescript)[^.\n]*(?:fail|error)/i.test(activeFeature.evidence ?? "")
    ) {
      errors.push("Active feature evidence contradicts the passing verification baseline.");
    }
  }
  if (gitSnapshot.branch !== progress.branch) {
    errors.push(`Git branch ${gitSnapshot.branch} does not match declared branch ${progress.branch}`);
  }

  const untrackedFiles = [...gitSnapshot.untrackedFiles].map(normalizePath).sort();
  const protectedUntracked = untrackedFiles.filter(isProtectedHarnessPath);
  const otherUntracked = untrackedFiles.filter((file) => !isProtectedHarnessPath(file));
  if (untrackedFiles.length > 0) {
    warnings.push(`${untrackedFiles.length} untracked path(s) reported; no files were modified.`);
  }

  return {
    errors,
    warnings,
    summary: {
      trustMode,
      branch: gitSnapshot.branch,
      commit: gitSnapshot.commit,
      activeFeatureId: state.activeFeatureId,
      activeFeatureStatus,
      objective: progress.objective ?? null,
      status: progress.status ?? null,
      nextAction: progress.nextAction ?? null,
      verificationCaptured: progress.verificationCaptured ?? null,
      trackedChangeCount: gitSnapshot.trackedChanges.length,
      untrackedCount: untrackedFiles.length,
      protectedUntracked,
      untrackedPreview: [...protectedUntracked, ...otherUntracked].slice(0, previewLimit),
    },
    contracts: { progress, handoff },
  };
}

function printResult(result) {
  console.log("Session start (read-only)");
  console.log(`Trust mode: ${result.summary.trustMode}`);
  console.log(`Feature: ${result.summary.activeFeatureId ?? "none"}`);
  console.log(`Branch: ${result.summary.branch}`);
  console.log(`Commit: ${result.summary.commit}`);
  console.log(`Objective: ${result.summary.objective ?? "missing"}`);
  console.log(`Next action: ${result.summary.nextAction ?? "missing"}`);
  console.log(`Changes: ${result.summary.trackedChangeCount} tracked, ${result.summary.untrackedCount} untracked`);
  if (result.summary.untrackedPreview.length > 0) {
    console.log(`Untracked preview (max ${previewLimit}): ${result.summary.untrackedPreview.join(", ")}`);
  }
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  for (const error of result.errors) console.error(`Error: ${error}`);
}

async function main() {
  console.log(formatHookStatus(invokeConfiguredHook("session-start")));
  const result = await collectSessionStart();
  printResult(result);
  if (result.errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
