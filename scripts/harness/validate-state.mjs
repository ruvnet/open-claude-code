import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const allowedStatuses = new Set(["not-started", "in-progress", "blocked", "done"]);
const featureIdPattern = /^feat-\d{3,}$/;

function isObjectRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseStrictIsoTimestamp(value) {
  if (typeof value !== "string") return Number.NaN;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) return Number.NaN;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone, sign, offsetHourText, offsetMinuteText] = match;
  const [year, month, day, hour, minute, second] =
    [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return Number.NaN;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return Number.NaN;
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteText);
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
    return Number.NaN;
  }
  const offsetDirection = sign === "-" ? -1 : 1;
  const offsetMs = offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
  const millisecond = Number(fraction.slice(0, 3).padEnd(3, "0"));
  return Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offsetMs;
}

async function readJson(filePath, errors, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function readText(filePath, errors, label) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    errors.push(`${label} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function findDependencyCycles(featureIds) {
  const errors = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(id) {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      errors.push(`Dependency cycle detected: ${[...stack.slice(start), id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;

    visiting.add(id);
    stack.push(id);
    const feature = featureIds.get(id);
    const dependencies = Array.isArray(feature?.dependencies) ? feature.dependencies : [];
    for (const dependency of dependencies) {
      if (featureIds.has(dependency)) visit(dependency);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of featureIds.keys()) visit(id);
  return errors;
}

function normalizeFeatureDirectory(value) {
  return path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "");
}

function validateFeatureShape(feature, index, errors) {
  const label = typeof feature?.id === "string" ? feature.id : `features[${index}]`;
  if (!feature || typeof feature !== "object" || Array.isArray(feature)) {
    errors.push(`features[${index}] must be an object`);
    return;
  }
  if (!featureIdPattern.test(feature.id ?? "")) errors.push(`${label} has an invalid feature id`);
  for (const field of ["name", "description"]) {
    if (typeof feature[field] !== "string" || feature[field].trim() === "") {
      errors.push(`${label} requires a non-empty ${field}`);
    }
  }
  if (!allowedStatuses.has(feature.status)) {
    errors.push(`${label} has invalid status ${JSON.stringify(feature.status)}`);
  }
  if (!Array.isArray(feature.dependencies)) {
    errors.push(`${label} dependencies must be an array`);
  } else {
    if (new Set(feature.dependencies).size !== feature.dependencies.length) {
      errors.push(`${label} contains duplicate dependencies`);
    }
    for (const [dependencyIndex, dependency] of feature.dependencies.entries()) {
      if (typeof dependency !== "string" || !featureIdPattern.test(dependency)) {
        errors.push(`${label} dependencies[${dependencyIndex}] must be a feature id`);
      }
    }
  }
  if (typeof feature.evidence !== "string") errors.push(`${label} evidence must be a string`);
  if (
    feature.status === "done" &&
    (typeof feature.evidence !== "string" || feature.evidence.trim() === "")
  ) {
    errors.push(`Done feature ${label} requires verification evidence`);
  }
  if (feature.status === "done") validateVerification(feature, label, errors);
  if (feature.status === "blocked") {
    if (typeof feature.blocker !== "string" || feature.blocker.trim() === "") {
      errors.push(`Blocked feature ${label} requires a blocker`);
    }
    if (typeof feature.recommendedNextStep !== "string" || feature.recommendedNextStep.trim() === "") {
      errors.push(`Blocked feature ${label} requires a recommendedNextStep`);
    }
  }
}

function validateVerification(feature, label, errors) {
  const commands = feature.verification?.commands;
  if (!Array.isArray(commands) || commands.length === 0) {
    errors.push(`Done feature ${label} requires structured verification commands`);
    return;
  }

  for (const [index, verification] of commands.entries()) {
    const commandLabel = `${label} verification.commands[${index}]`;
    if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
      errors.push(`${commandLabel} must be an object`);
      continue;
    }
    if (typeof verification.command !== "string" || verification.command.trim() === "") {
      errors.push(`${commandLabel}.command must be non-empty`);
    }
    const start = parseStrictIsoTimestamp(verification.startTime);
    const end = parseStrictIsoTimestamp(verification.endTime);
    if (!Number.isFinite(start)) errors.push(`${commandLabel}.startTime must be an ISO timestamp`);
    if (!Number.isFinite(end)) errors.push(`${commandLabel}.endTime must be an ISO timestamp`);
    if (Number.isFinite(start) && Number.isFinite(end) && end < start) {
      errors.push(`${label} verification endTime must not precede startTime`);
    }
    if (!Number.isInteger(verification.exitCode)) {
      errors.push(`${commandLabel}.exitCode must be an integer`);
    } else if (verification.exitCode !== 0) {
      errors.push(`${label} verification exitCode must be 0`);
    }
    if (typeof verification.result !== "string" || verification.result.trim() === "") {
      errors.push(`${commandLabel}.result must be non-empty`);
    }
    if (!verification.counts || typeof verification.counts !== "object" || Array.isArray(verification.counts)) {
      errors.push(`${commandLabel}.counts is required and must be an object`);
    } else {
      for (const requiredCount of ["passed", "failed"]) {
        if (!Number.isInteger(verification.counts[requiredCount]) || verification.counts[requiredCount] < 0) {
          errors.push(`${commandLabel}.counts.${requiredCount} must be a non-negative integer`);
        }
      }
      if (verification.counts.failed !== 0) {
        errors.push(`${label} verification counts.failed must be 0`);
      }
      for (const [countName, count] of Object.entries(verification.counts)) {
        if (!Number.isInteger(count) || count < 0) {
          errors.push(`${commandLabel}.counts.${countName} must be a non-negative integer`);
        }
      }
    }
    if (verification.notes !== undefined && typeof verification.notes !== "string") {
      errors.push(`${commandLabel}.notes must be a string`);
    }
  }
}

export async function validateHarnessState({ rootDir = process.cwd() } = {}) {
  const errors = [];
  const state = await readJson(path.join(rootDir, "feature_list.json"), errors, "feature_list.json");
  const features = Array.isArray(state?.features) ? state.features : [];
  if (!Array.isArray(state?.features)) errors.push("feature_list.json must contain a features array");

  const featureIds = new Map();
  for (const [index, feature] of features.entries()) {
    validateFeatureShape(feature, index, errors);
    if (typeof feature?.id !== "string" || !featureIdPattern.test(feature.id)) continue;
    if (featureIds.has(feature.id)) errors.push(`Duplicate feature id: ${feature.id}`);
    else if (feature && typeof feature === "object" && !Array.isArray(feature)) {
      featureIds.set(feature.id, feature);
    }
  }

  for (const feature of featureIds.values()) {
    if (!Array.isArray(feature.dependencies)) continue;
    for (const dependency of feature.dependencies) {
      if (typeof dependency !== "string" || !featureIdPattern.test(dependency)) continue;
      if (!featureIds.has(dependency)) errors.push(`${feature.id} has missing dependency ${dependency}`);
      else if (feature.status === "done" && featureIds.get(dependency).status !== "done") {
        errors.push(`Done feature ${feature.id} has unfinished dependency ${dependency}`);
      }
    }
  }
  errors.push(...findDependencyCycles(featureIds));

  const activeFeatures = features.filter((feature) => feature?.status === "in-progress");
  if (activeFeatures.length > 1) {
    errors.push(`Expected at most one in-progress feature; found ${activeFeatures.length}`);
  }
  const activeFeature = activeFeatures.length === 1 ? activeFeatures[0] : undefined;

  if (activeFeature) {
    const activeDependencies = Array.isArray(activeFeature.dependencies)
      ? activeFeature.dependencies
      : [];
    for (const dependency of activeDependencies) {
      const dependencyFeature = featureIds.get(dependency);
      if (dependencyFeature && dependencyFeature.status !== "done") {
        errors.push(`Active feature ${activeFeature.id} depends on unfinished ${dependency}`);
      }
    }

    const progress = await readText(path.join(rootDir, "progress.md"), errors, "progress.md");
    const progressMatch = progress?.match(/\*\*Active feature:\*\*\s*`(feat-\d{3,})`/i);
    if (!progressMatch) errors.push("progress.md must identify an active feature");
    else if (progressMatch[1] !== activeFeature.id) {
      errors.push(`progress.md names ${progressMatch[1]} but active state is ${activeFeature.id}`);
    }

    const activeState = await readJson(
      path.join(rootDir, ".agents", "memory", "active-feature.json"),
      errors,
      ".agents/memory/active-feature.json",
    );
    if (activeState !== undefined && !isObjectRecord(activeState)) {
      errors.push("active-feature state must be an object");
    } else if (activeState) {
      if (activeState.feature_id !== activeFeature.id) {
        errors.push(`active-feature state does not describe active feature ${activeFeature.id}`);
      }
      if (typeof activeState.feature_directory !== "string" || activeState.feature_directory.trim() === "") {
        errors.push("active-feature state requires feature_directory");
      } else {
        const specPath = path.resolve(rootDir, activeState.feature_directory, "spec.md");
        if (!specPath.startsWith(path.resolve(rootDir) + path.sep)) {
          errors.push("active-feature feature_directory escapes the repository root");
        } else {
          const spec = await readText(specPath, errors, "active feature spec");
          const specFeatureId = spec?.match(/^Feature ID:\s*(feat-\d{3,})\s*$/im)?.[1];
          if (specFeatureId !== activeFeature.id) {
            errors.push(
              `active-feature feature_directory metadata ${specFeatureId ?? "missing"} does not match active ${activeFeature.id}`,
            );
          }
          const declaredDirectory = spec?.match(/^Feature Directory:\s*([^\r\n]+?)\s*$/im)?.[1];
          const stateDirectory = normalizeFeatureDirectory(activeState.feature_directory);
          const actualDirectory = normalizeFeatureDirectory(
            path.relative(rootDir, path.dirname(specPath)),
          );
          if (
            !declaredDirectory ||
            normalizeFeatureDirectory(declaredDirectory) !== stateDirectory ||
            actualDirectory !== stateDirectory
          ) {
            errors.push(
              `Feature Directory ${declaredDirectory ?? "missing"} does not match active-feature ${stateDirectory} and actual directory ${actualDirectory}`,
            );
          }
        }
      }
    }
  } else if (activeFeatures.length === 0) {
    const progress = await readText(path.join(rootDir, "progress.md"), errors, "progress.md");
    if (!/^\*\*Active feature:\*\*\s*none\s*$/im.test(progress ?? "")) {
      errors.push("progress.md must use the canonical inactive declaration **Active feature:** none");
    }

    const activeState = await readJson(
      path.join(rootDir, ".agents", "memory", "active-feature.json"),
      errors,
      ".agents/memory/active-feature.json",
    );
    if (
      activeState !== undefined &&
      (!isObjectRecord(activeState) || activeState.feature_id !== null || activeState.feature_directory !== null)
    ) {
      errors.push("inactive active-feature state must be an object with feature_id and feature_directory set to null");
    }
  }

  return { errors, activeFeatureId: activeFeature?.id ?? null, featureCount: features.length };
}

async function main() {
  const result = await validateHarnessState();
  if (result.errors.length > 0) {
    console.error("Feature state validation failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Feature state valid: ${result.featureCount} features; active ${result.activeFeatureId}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
