import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const maxTextFileBytes = 2 * 1024 * 1024;
const detectors = [
  ["private-key material", /^\s*-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----\s*$/m],
  ["AWS access key", /(^|[^A-Z0-9])(?!AKIAIOSFODNN7EXAMPLE)AKIA[A-Z0-9]{16}([^A-Z0-9]|$)/],
  ["OpenAI-style API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  [
    "credential-bearing database URL",
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:]+:(?!(?:pass|password|strong_password_here|your[-_][^\s/@]+|<[^>]+>)@)[^\s/@]+@/i,
  ],
  [
    "secret assignment",
    /^[ \t]*(?:SESSION_SECRET|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|SMTP_PASS)[ \t]*=[ \t]*(?!$|\$\{|<|CHANGE[-_]?ME\b|REPLACE[-_]?ME\b|YOUR[-_])[^\s#]{8,}[ \t]*$/im,
  ],
];

function repositoryPaths(rootDir) {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split("\0").filter(Boolean);
}

function isContained(rootDir, candidate) {
  const relative = path.relative(rootDir, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function hasLinkedSegment(rootRealPath, rootDir, relativePath) {
  let candidate = rootDir;
  for (const segment of relativePath.replaceAll("\\", "/").split("/")) {
    candidate = path.join(candidate, segment);
    const linkStat = await fs.lstat(candidate);
    if (linkStat.isSymbolicLink()) return true;
    const realPath = await fs.realpath(candidate);
    if (!isContained(rootRealPath, realPath)) return true;
  }
  return false;
}

export async function scanTrackedFiles(rootDir = process.cwd()) {
  const findings = [];
  let scanned = 0;
  const rootRealPath = await fs.realpath(rootDir);

  for (const relativePath of repositoryPaths(rootDir)) {
    const absolutePath = path.join(rootDir, relativePath);
    let linked;
    try {
      linked = await hasLinkedSegment(rootRealPath, rootDir, relativePath);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    if (linked) {
      findings.push({ path: relativePath.replaceAll("\\", "/"), detector: "linked tracked path" });
      continue;
    }
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.size > maxTextFileBytes) continue;

    const content = await fs.readFile(absolutePath);
    if (content.includes(0)) continue;
    scanned += 1;
    const source = content.toString("utf8");

    for (const [name, pattern] of detectors) {
      if (pattern.test(source)) findings.push({ path: relativePath.replaceAll("\\", "/"), detector: name });
    }
  }

  return { findings, scanned };
}

async function main() {
  const result = await scanTrackedFiles();
  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      console.error(`Potential ${finding.detector} in ${finding.path}; value withheld.`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Secret scan passed: ${result.scanned} tracked and prospective text files checked; no credential patterns found.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
