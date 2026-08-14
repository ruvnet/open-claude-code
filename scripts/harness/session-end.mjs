import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatHookStatus, invokeConfiguredHook } from "../../.agents/hooks/hook-gate.mjs";
import { collectSessionStart } from "./session-start.mjs";

const defaultEvidenceAgeHours = 24;

function isCompletionClaim(status) {
  return /\b(?:done|complete|completed|completion|ready for completion)\b/i.test(status ?? "");
}

function parseTimestamp(value) {
  if (typeof value !== "string") return Number.NaN;
  return Date.parse(value);
}

export async function checkSessionEnd({
  rootDir = process.cwd(),
  gitSnapshot,
  now = new Date(),
  maxEvidenceAgeHours = defaultEvidenceAgeHours,
} = {}) {
  const start = await collectSessionStart({ rootDir, gitSnapshot });
  const errors = [...start.errors];
  const warnings = [...start.warnings];
  const { progress, handoff } = start.contracts;
  const capturedMs = parseTimestamp(progress.verificationCaptured);
  const nowMs = now.getTime();
  const ageMs = nowMs - capturedMs;
  const maxAgeMs = maxEvidenceAgeHours * 60 * 60 * 1000;
  const verificationIsFresh = Number.isFinite(capturedMs) && ageMs >= -5 * 60 * 1000 && ageMs <= maxAgeMs;
  const canonicalVerifyPassed = progress.hasCanonicalVerification && handoff.hasCanonicalVerification;

  if (!canonicalVerifyPassed || !verificationIsFresh) {
    errors.push(
      `Session handoff requires a passing ./init.sh result captured within ${maxEvidenceAgeHours} hours.`,
    );
  }
  if ((isCompletionClaim(progress.status) || isCompletionClaim(handoff.status)) && (!canonicalVerifyPassed || !verificationIsFresh)) {
    errors.push("A completion claim requires fresh successful ./init.sh evidence.");
  }
  if (!progress.nextAction || !handoff.nextAction) {
    errors.push("A restartable session end requires one canonical next action.");
  }

  const ready = errors.length === 0;
  return {
    ready,
    errors,
    warnings,
    summary: start.summary,
    message: ready
      ? "Session state is restartable; verification and handoff checks passed."
      : "Session end check failed; state is not restartable.",
  };
}

async function main() {
  console.log(formatHookStatus(invokeConfiguredHook("session-end")));
  const result = await checkSessionEnd();
  console.log("Session end (read-only)");
  console.log(result.message);
  console.log(`Feature: ${result.summary.activeFeatureId ?? "none"}`);
  console.log(`Next action: ${result.summary.nextAction ?? "missing"}`);
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  for (const error of result.errors) console.error(`Error: ${error}`);
  if (!result.ready) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
