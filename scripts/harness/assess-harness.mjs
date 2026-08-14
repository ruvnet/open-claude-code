import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, writeSanitizedReport } from "./benchmark.mjs";

const requiredArtifacts = [
  "feature_list.json",
  "progress.md",
  "session-handoff.md",
  "quality-document.md",
  "evaluator-rubric.md",
  "docs/harness/CONTEXT-MAP.md",
  "docs/harness/RELIABILITY.md",
  "docs/harness/TOOL-SAFETY.md",
  ".agents/policy.yml",
  ".agents/coordination.md",
  ".agents/memory/index.json",
  ".github/workflows/verify.yml",
];
const categoryScenarios = [
  { name: "stateAndLifecycle", weight: 20, ids: ["state-valid", "state-invalid", "lifecycle-restart"] },
  { name: "verification", weight: 25, ids: ["workflow-gates"] },
  { name: "safety", weight: 25, ids: ["policy-deny", "secret-scan", "cleanup-read-only"] },
  { name: "contextMemoryCoordination", weight: 15, ids: ["bounded-agent-assets"] },
  { name: "deliveryRecoveryContract", weight: 15, ids: ["workflow-gates"] },
];

async function artifactExists(rootDir, relativePath) {
  try {
    const stat = await fs.stat(path.join(rootDir, ...relativePath.split("/")));
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export async function assessHarness({
  rootDir = process.cwd(),
  benchmarkReport,
  writeReport = true,
  now = new Date(),
} = {}) {
  const artifacts = await Promise.all(requiredArtifacts.map(async (artifact) => ({
    artifact,
    present: await artifactExists(rootDir, artifact),
  })));
  const agentInstructionPresent = await artifactExists(rootDir, "AGENTS.md")
    || await artifactExists(rootDir, "CLAUDE.md");
  const benchmark = benchmarkReport ?? await runBenchmark({ rootDir, writeReport: false, now });
  const scenarioStatus = new Map(benchmark.scenarios.map((entry) => [entry.id, entry.status]));
  const categories = categoryScenarios.map((category) => {
    const complete = category.ids.every((id) => scenarioStatus.get(id) === "pass");
    return { name: category.name, weight: category.weight, score: complete ? category.weight : 0, complete };
  });
  const score = categories.reduce((total, category) => total + category.score, 0);
  const structuralComplete = agentInstructionPresent && artifacts.every((entry) => entry.present);
  const operationalComplete = benchmark.summary.failed === 0
    && benchmark.summary.total > 0
    && benchmark.summary.passed === benchmark.summary.total;
  const passed = structuralComplete && operationalComplete && score >= 90;
  const assessment = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    sanitized: true,
    structural: {
      complete: structuralComplete,
      present: artifacts.filter((entry) => entry.present).length + Number(agentInstructionPresent),
      required: artifacts.length + 1,
      missing: [
        ...(!agentInstructionPresent ? ["AGENTS.md or CLAUDE.md"] : []),
        ...artifacts.filter((entry) => !entry.present).map((entry) => entry.artifact),
      ],
    },
    operational: { complete: operationalComplete, ...benchmark.summary },
    categories,
    score,
    passed,
    independentReviewRequired: true,
    decision: !structuralComplete
      ? "Missing structural artifact."
      : !operationalComplete
        ? "Failed operational scenario; structural completeness cannot override executable evidence."
        : score < 90
          ? "Evaluator score is below the required threshold."
          : "Automated gates pass; independent review is still required.",
  };
  if (writeReport) {
    assessment.output = await writeSanitizedReport(
      rootDir,
      assessment,
      "reports/generated/harness-assessment.json",
    );
  }
  return assessment;
}

async function main() {
  const assessment = await assessHarness();
  console.log(`Harness assessment: ${assessment.score}/100; ${assessment.passed ? "automated pass" : "fail"}.`);
  console.log(`Sanitized report: ${assessment.output}`);
  console.log(assessment.decision);
  if (!assessment.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
