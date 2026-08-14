import fs from "node:fs";
import path from "node:path";

function readHookConfiguration(root) {
  try {
    const configuration = JSON.parse(fs.readFileSync(path.join(root, ".agents", "hooks", "hooks.json"), "utf8"));
    if (
      configuration?.version !== 1
      || configuration.optInEnvironment !== "HARNESS_TRUST_MODE"
      || configuration.trustedValue !== "trusted"
      || !Array.isArray(configuration.hooks)
    ) {
      return null;
    }
    return configuration;
  } catch {
    return null;
  }
}

export function isTrustedWorkspace(environment = process.env) {
  return environment.HARNESS_TRUST_MODE === "trusted";
}

export function invokeConfiguredHook(event, { environment = process.env, root = process.cwd() } = {}) {
  const configuration = readHookConfiguration(root);
  if (!configuration) {
    return { enabled: false, event, reason: "invalid-configuration" };
  }
  if (!isTrustedWorkspace(environment)) {
    return { enabled: false, event, reason: "untrusted-workspace" };
  }
  if (!configuration.hooks.some((hook) => hook?.event === event && typeof hook.command === "string")) {
    return { enabled: false, event, reason: "event-not-configured" };
  }
  // Hooks intentionally expose no credentials and perform no mutation; the lifecycle owns all state changes.
  return { enabled: true, event, reason: "metadata-only" };
}

export function formatHookStatus(result) {
  return result.enabled
    ? `Hook ${result.event} enabled: local metadata-only callback configured.`
    : `Hook ${result.event} disabled: ${result.reason}.`;
}

export function runTrustGatedHook(event, environment = process.env, root = process.cwd()) {
  const result = invokeConfiguredHook(event, { environment, root });
  console.log(formatHookStatus(result));
  return result;
}
