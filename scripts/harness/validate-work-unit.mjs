import path from "node:path";

import { isProtectedHarnessPath } from "./path-safety.mjs";

const requiredFields = ["work_id", "owner", "state", "file_boundaries", "allowed_tools", "output_path", "verification", "parent_notified"];
const activeStates = new Set(["requested", "running"]);
const states = new Set(["requested", "running", "completed", "failed", "cancelled", "blocked"]);
const allowedTools = new Set(["read", "search", "edit", "test", "git_status", "git_diff"]);

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || !value.trim() || path.isAbsolute(value) || value.includes("\0")) {
    return false;
  }
  const normalized = normalizePath(value);
  return !normalized.split("/").includes("..");
}

function splitList(value) {
  return typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function pathsOverlap(first, second) {
  return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`);
}

export function parseWorkUnit(text) {
  const errors = [];
  if (typeof text !== "string") {
    return { errors: ["Work unit must be text."], values: {} };
  }
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) break;
    const match = rawLine.match(/^([a-z_]+):\s*(.*?)\s*$/);
    if (!match) {
      errors.push("Work unit header rows must use key: value.");
      continue;
    }
    const [, key, value] = match;
    if (!requiredFields.includes(key)) {
      errors.push("Work unit contains an unsupported header field.");
    } else if (Object.hasOwn(values, key)) {
      errors.push(`Work unit repeats ${key}.`);
    } else {
      values[key] = value;
    }
  }
  for (const field of requiredFields) {
    if (!values[field]) errors.push(`Work unit is missing ${field}.`);
  }
  return { errors, values };
}

function validateUnit(values) {
  const errors = [];
  if (!/^[a-z][a-z0-9-]{2,80}$/.test(values.work_id ?? "")) {
    errors.push("work_id must be a stable lowercase identifier.");
  }
  if (typeof values.owner !== "string" || !/^[a-z][a-z0-9-]{1,80}$/.test(values.owner)) {
    errors.push("owner must be one named worker.");
  }
  if (!states.has(values.state)) {
    errors.push("state must be an allowed work-unit state.");
  }

  const boundaries = splitList(values.file_boundaries);
  if (boundaries.length === 0 || boundaries.some((boundary) => !isSafeRelativePath(boundary) || isProtectedHarnessPath(normalizePath(boundary)))) {
    errors.push("file_boundaries must be safe, non-protected repository-relative paths.");
  }
  const tools = splitList(values.allowed_tools);
  if (tools.length === 0 || tools.some((tool) => !allowedTools.has(tool))) {
    errors.push("allowed_tools must use the restricted worker tool set.");
  }
  const outputPath = normalizePath(values.output_path ?? "");
  if (
    !isSafeRelativePath(values.output_path)
    || !outputPath.startsWith("docs/harness/work-results/")
    || !outputPath.endsWith(".md")
    || !outputPath.includes(`${values.work_id}.md`)
  ) {
    errors.push("output_path must be a sanitized repository-relative work-result Markdown path.");
  }
  if (typeof values.verification !== "string" || !values.verification.trim()) {
    errors.push("verification must name an exact local check.");
  }
  if (!["true", "false"].includes(values.parent_notified)) {
    errors.push("parent_notified must be true or false.");
  }
  return { errors, boundaries, outputPath };
}

export function validateWorkUnits(workUnitTexts) {
  const errors = [];
  if (!Array.isArray(workUnitTexts)) {
    return { errors: ["Work units must be an array."], units: [] };
  }
  const units = workUnitTexts.map((text) => {
    const parsed = parseWorkUnit(text);
    const validated = validateUnit(parsed.values);
    errors.push(...parsed.errors, ...validated.errors);
    return { ...parsed.values, boundaries: validated.boundaries, outputPath: validated.outputPath };
  });

  const workIds = new Set();
  const outputPaths = new Set();
  for (const unit of units) {
    if (workIds.has(unit.work_id)) errors.push("work_id values must be unique.");
    workIds.add(unit.work_id);
    if (outputPaths.has(unit.outputPath)) errors.push("output_path values must be unique.");
    outputPaths.add(unit.outputPath);
  }
  for (let firstIndex = 0; firstIndex < units.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < units.length; secondIndex += 1) {
      const first = units[firstIndex];
      const second = units[secondIndex];
      if (!activeStates.has(first.state) || !activeStates.has(second.state)) continue;
      if (first.boundaries.some((firstBoundary) => second.boundaries.some((secondBoundary) => pathsOverlap(firstBoundary, secondBoundary)))) {
        errors.push("Active work units have overlapping file boundaries; resolve ownership before dispatch.");
      }
    }
  }
  return { errors, units };
}
