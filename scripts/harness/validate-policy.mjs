import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const decisions = new Set(["deny", "approval", "allow"]);
const kinds = new Set(["operation", "path", "content-category", "command-prefix"]);
const safeReadOperations = new Set(["read_file", "list_files", "search_text", "git_status", "git_diff"]);
const requiredSecretPaths = [".env", ".env.*", "**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx"];
const requiredSecretCategories = ["credentials", "access-token", "private-key", "session-secret"];
const requiredApprovalOperations = [
  "create_file",
  "edit_file",
  "overwrite_file",
  "move_path",
  "delete_path",
  "install_dependencies",
  "network_request",
  "package_download",
  "git_commit",
  "git_push",
  "create_pull_request",
  "deploy",
  "database_migration",
  "production_data_change",
  "infrastructure_change",
];
const requiredProtectedPaths = [".git/**", "node_modules/**", "dist/**", "build/**"];
const requiredDestructivePrefixes = ["rm -rf", "Remove-Item -Recurse", "DROP DATABASE", "DROP TABLE", "TRUNCATE TABLE", "git reset --hard", "git clean -fd"];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function hasRuleValue(rules, decision, kind, value) {
  return rules.some((rule) => rule.decision === decision && rule.kind === kind && rule.values.includes(value));
}

function isBroadPathPattern(value) {
  return value === "*" || value === "**" || value === "**/*" || value === "**/**";
}

function normalizePath(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/").replace(/^\.\//, "") : "";
}

function pathMatches(pattern, target) {
  const normalizedPattern = normalizePath(pattern);
  const normalizedTarget = normalizePath(target);
  let expression = "^";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    if (character === "*") {
      if (normalizedPattern[index + 1] === "*") {
        if (normalizedPattern[index + 2] === "/") {
          expression += "(?:.*/)?";
          index += 2;
        } else {
          expression += ".*";
          index += 1;
        }
      } else {
        expression += "[^/]*";
      }
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`).test(normalizedTarget);
}

export function validatePolicy(policy) {
  const errors = [];
  if (!isRecord(policy)) {
    return { errors: ["Policy must be an object."] };
  }

  if (policy.version !== 1) {
    errors.push("Policy version must be 1.");
  }

  if (!isRecord(policy.defaults)) {
    errors.push("Policy defaults must be an object.");
  } else {
    for (const key of ["decision", "untrustedWorkspace", "unlistedTool", "concurrentMutation", "recursiveDelegation"]) {
      if (policy.defaults[key] !== "deny") {
        errors.push(`Policy defaults.${key} must be deny.`);
      }
    }
  }

  if (!Array.isArray(policy.precedence) || policy.precedence.join("|") !== "deny|approval|allow") {
    errors.push("Policy precedence must be deny, approval, allow.");
  }

  if (!Array.isArray(policy.rules)) {
    errors.push("Policy rules must be an array.");
    return { errors };
  }

  const validRules = [];
  const seenIds = new Set();
  const seenValues = new Map();
  for (const [index, rule] of policy.rules.entries()) {
    const prefix = `Policy rule ${index + 1}`;
    if (!isRecord(rule)) {
      errors.push(`${prefix} must be an object.`);
      continue;
    }
    if (typeof rule.id !== "string" || !rule.id.trim()) {
      errors.push(`${prefix} must have a non-empty id.`);
    } else if (seenIds.has(rule.id)) {
      errors.push("Policy rule ids must be unique.");
    } else {
      seenIds.add(rule.id);
    }
    if (!decisions.has(rule.decision)) {
      errors.push(`${prefix} has an unsupported decision.`);
    }
    if (!kinds.has(rule.kind)) {
      errors.push(`${prefix} has an unsupported kind.`);
    }
    if (!Array.isArray(rule.values) || rule.values.length === 0 || rule.values.some((value) => typeof value !== "string" || !value.trim())) {
      errors.push(`${prefix} must have a non-empty string values array.`);
      continue;
    }
    if (!decisions.has(rule.decision) || !kinds.has(rule.kind)) {
      continue;
    }

    const values = [...new Set(rule.values)];
    if (values.length !== rule.values.length) {
      errors.push(`${prefix} must not repeat values.`);
    }
    validRules.push({ decision: rule.decision, kind: rule.kind, values });

    for (const value of values) {
      const key = `${rule.kind}\u0000${value}`;
      const priorDecision = seenValues.get(key);
      if (priorDecision && priorDecision !== rule.decision) {
        const label = safeReadOperations.has(value) ? value : "configured rule target";
        errors.push(`Policy conflict for ${rule.kind} value ${label}.`);
      } else {
        seenValues.set(key, rule.decision);
      }
      if (rule.decision === "allow" && rule.kind === "operation" && !safeReadOperations.has(value)) {
        errors.push("Allow operation rules may contain only declared read-only operations.");
      }
      if (rule.kind === "path" && isBroadPathPattern(value)) {
        errors.push("Path rules must not use a broad wildcard.");
      }
      if (rule.kind === "path" && rule.decision === "allow") {
        errors.push("Allow path rules are not permitted; use an explicit protected approval boundary.");
      }
      if (rule.kind === "path" && rule.decision === "approval" && !requiredProtectedPaths.includes(value)) {
        errors.push("Approval path rules must use explicit protected path boundaries.");
      }
      if (rule.kind === "content-category" && rule.decision !== "deny") {
        errors.push("Content-category rules must deny sensitive content.");
      }
      if (rule.kind === "command-prefix" && rule.decision !== "approval") {
        errors.push("Destructive command-prefix rules must require approval.");
      }
    }
  }

  for (const operation of safeReadOperations) {
    if (!hasRuleValue(validRules, "allow", "operation", operation)) {
      errors.push("Policy is missing a required read-only allow rule.");
      break;
    }
  }
  for (const operation of requiredApprovalOperations) {
    if (!hasRuleValue(validRules, "approval", "operation", operation)) {
      errors.push("Policy is missing a required approval operation rule.");
      break;
    }
  }
  for (const secretPath of requiredSecretPaths) {
    if (!hasRuleValue(validRules, "deny", "path", secretPath)) {
      errors.push("Policy is missing a required secret path denial.");
      break;
    }
  }
  for (const category of requiredSecretCategories) {
    if (!hasRuleValue(validRules, "deny", "content-category", category)) {
      errors.push("Policy is missing a required secret content denial.");
      break;
    }
  }
  for (const protectedPath of requiredProtectedPaths) {
    if (!hasRuleValue(validRules, "approval", "path", protectedPath)) {
      errors.push("Policy is missing a required protected path boundary.");
      break;
    }
  }
  for (const prefix of requiredDestructivePrefixes) {
    if (!hasRuleValue(validRules, "approval", "command-prefix", prefix)) {
      errors.push("Policy is missing a destructive command approval boundary.");
      break;
    }
  }
  return { errors };
}

export function evaluatePolicy(policy, request = {}) {
  if (validatePolicy(policy).errors.length > 0 || !isRecord(request)) {
    return "deny";
  }
  if (request.workspaceTrusted === false || request.unlistedTool === true || request.concurrentMutation === true || request.recursiveDelegation === true) {
    return "deny";
  }

  const decisionsForRequest = [];
  for (const rule of policy.rules) {
    const valueMatches = rule.values.some((value) => {
      if (rule.kind === "operation") {
        return typeof request.operation === "string" && value === request.operation;
      }
      if (rule.kind === "path") {
        return typeof request.path === "string" && pathMatches(value, request.path);
      }
      if (rule.kind === "content-category") {
        return typeof request.contentCategory === "string" && value === request.contentCategory;
      }
      return typeof request.commandPrefix === "string" && request.commandPrefix.trimStart().startsWith(value);
    });
    if (valueMatches) {
      decisionsForRequest.push(rule.decision);
    }
  }
  return ["deny", "approval", "allow"].find((decision) => decisionsForRequest.includes(decision)) ?? "deny";
}

export function loadPolicy(root = process.cwd()) {
  try {
    const raw = fs.readFileSync(path.join(root, ".agents", "policy.yml"), "utf8");
    return { policy: JSON.parse(raw), errors: [] };
  } catch {
    return { policy: null, errors: ["Policy file must be valid JSON-subset YAML."] };
  }
}

export function validatePolicyFile(root = process.cwd()) {
  const loaded = loadPolicy(root);
  if (loaded.errors.length > 0) {
    return loaded;
  }
  return validatePolicy(loaded.policy);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = validatePolicyFile();
  if (result.errors.length > 0) {
    console.error("Policy validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Policy valid: default-deny safety boundaries are present.");
  }
}
