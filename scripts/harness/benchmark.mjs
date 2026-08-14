import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanCleanup } from "./cleanup-scanner.mjs";
import { scanTrackedFiles } from "./secret-scan.mjs";
import { collectSessionStart } from "./session-start.mjs";
import { evaluatePolicy, loadPolicy, validatePolicy } from "./validate-policy.mjs";
import { validateHarnessState } from "./validate-state.mjs";

const reportRelativePath = "reports/generated/harness-benchmark.json";
const maxReportBytes = 16 * 1024;

function isContained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function writeSanitizedReport(rootDir, report, relativePath = reportRelativePath) {
  const rootRealPath = await fs.realpath(rootDir);
  const normalizedRelativePath = relativePath.replaceAll("\\", "/");
  const outputPath = path.resolve(rootDir, normalizedRelativePath);
  const allowedDirectory = path.resolve(rootDir, "reports", "generated");
  if (
    path.posix.dirname(normalizedRelativePath) !== "reports/generated"
    || !/^[a-z0-9][a-z0-9-]*\.json$/.test(path.posix.basename(normalizedRelativePath))
    || !isContained(allowedDirectory, outputPath)
  ) {
    throw new Error("Benchmark output must stay under reports/generated as JSON.");
  }

  let currentDirectory = rootDir;
  for (const segment of ["reports", "generated"]) {
    currentDirectory = path.join(currentDirectory, segment);
    try {
      const stat = await fs.lstat(currentDirectory);
      if (stat.isSymbolicLink()) throw new Error("Benchmark output parent is linked.");
      if (!stat.isDirectory()) throw new Error("Benchmark output parent is not a directory.");
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      await fs.mkdir(currentDirectory);
    }
    const realDirectory = await fs.realpath(currentDirectory);
    if (!isContained(rootRealPath, realDirectory)) {
      throw new Error("Benchmark output directory resolves outside the repository.");
    }
  }
  const outputDirectoryRealPath = await fs.realpath(allowedDirectory);
  if (!isContained(rootRealPath, outputDirectoryRealPath)) {
    throw new Error("Benchmark output directory resolves outside the repository.");
  }

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (report?.sanitized !== true) throw new Error("Benchmark report must declare sanitized output.");
  if (Buffer.byteLength(serialized) > maxReportBytes) throw new Error("Benchmark report exceeds its 16 KiB budget.");
  await fs.writeFile(outputPath, serialized, { encoding: "utf8", mode: 0o600 });
  return relativePath.replaceAll("\\", "/");
}

async function scenario(id, evidence, operation) {
  const startedAt = performance.now();
  let status = "pass";
  try {
    const passed = await operation();
    if (!passed) status = "fail";
  } catch {
    status = "fail";
  }
  return {
    id,
    status,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    evidence: status === "pass" ? evidence : "sanitized failure; rerun the focused gate",
  };
}

async function readText(rootDir, relativePath) {
  return fs.readFile(path.join(rootDir, ...relativePath.split("/")), "utf8");
}

async function rejectsDuplicateState() {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "harness-state-invalid-"));
  try {
    await fs.mkdir(path.join(fixture, ".agents", "memory"), { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(fixture, "feature_list.json"), JSON.stringify({
        features: [
          { id: "feat-001", name: "One", description: "One", dependencies: [], status: "not-started", evidence: "" },
          { id: "feat-001", name: "Two", description: "Two", dependencies: [], status: "not-started", evidence: "" },
        ],
      })),
      fs.writeFile(path.join(fixture, "progress.md"), "**Active feature:** none\n"),
      fs.writeFile(path.join(fixture, ".agents", "memory", "active-feature.json"), JSON.stringify({ feature_id: null, feature_directory: null })),
    ]);
    return (await validateHarnessState({ rootDir: fixture })).errors.some((error) => /duplicate feature id/i.test(error));
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
}

export async function runBenchmark({ rootDir = process.cwd(), writeReport = true, now = new Date() } = {}) {
  const scenarios = [];
  scenarios.push(await scenario("state-valid", "current feature state accepted", async () => (
    await validateHarnessState({ rootDir })
  ).errors.length === 0));
  scenarios.push(await scenario("state-invalid", "known duplicate state rejected", rejectsDuplicateState));
  scenarios.push(await scenario("lifecycle-restart", "restart contracts agree", async () => {
    const progress = await readText(rootDir, "progress.md");
    const branch = progress.match(/\*\*Branch:\*\*\s*`([^`]+)`/i)?.[1] ?? "unknown";
    return (await collectSessionStart({
      rootDir,
      trustMode: "untrusted",
      gitSnapshot: { branch, commit: "benchmark", trackedChanges: [], untrackedFiles: [] },
    })).errors.length === 0;
  }));
  scenarios.push(await scenario("policy-deny", "policy valid and nested environment path denied", async () => {
    const loaded = loadPolicy(rootDir);
    return loaded.errors.length === 0
      && validatePolicy(loaded.policy).errors.length === 0
      && evaluatePolicy(loaded.policy, { operation: "read_file", path: "nested/.env.production" }) === "deny";
  }));
  scenarios.push(await scenario("secret-scan", "tracked secret scan has no findings", async () => (
    await scanTrackedFiles(rootDir)
  ).findings.length === 0));
  scenarios.push(await scenario("cleanup-read-only", "cleanup inventory reported without errors", async () => (
    await scanCleanup({ rootDir, now })
  ).errors.length === 0));
  scenarios.push(await scenario("bounded-agent-assets", "context, memory, and coordination contracts present", async () => {
    const [contextMap, memoryIndex, coordination] = await Promise.all([
      readText(rootDir, "docs/harness/CONTEXT-MAP.md"),
      readText(rootDir, ".agents/memory/index.json"),
      readText(rootDir, ".agents/coordination.md"),
    ]);
    const parsedIndex = JSON.parse(memoryIndex);
    return /load only the information needed/i.test(contextMap)
      && Number(parsedIndex.maxIndexBytes) <= 8 * 1024
      && /workers must not delegate/i.test(coordination);
  }));
  scenarios.push(await scenario("workflow-gates", "verification and safe deployment contract are present", async () => {
    const [verify, security] = await Promise.all([
      readText(rootDir, ".github/workflows/verify.yml"),
      readText(rootDir, "docs/harness/SECURITY-GATES.md"),
    ]);
    return /bash \.\/init\.sh/.test(verify)
      && /permissions:\s*\n\s*contents:\s*read/i.test(verify)
      && /immutable|commit-SHA/i.test(security)
      && /protected/i.test(security)
      && /rollback/i.test(security);
  }));

  const passed = scenarios.filter((entry) => entry.status === "pass").length;
  const report = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    sanitized: true,
    summary: { total: scenarios.length, passed, failed: scenarios.length - passed },
    scenarios,
  };
  if (writeReport) report.output = await writeSanitizedReport(rootDir, report);
  return report;
}

async function main() {
  const report = await runBenchmark();
  console.log(`Harness benchmark: ${report.summary.passed}/${report.summary.total} passed.`);
  console.log(`Sanitized report: ${report.output}`);
  if (report.summary.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
