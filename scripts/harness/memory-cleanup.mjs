import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readMemoryIndex, resolveMemoryPaths } from "./memory-save.mjs";

const recovery = "Review each orphaned topic, validate it with saveMemory, then manually re-save or remove it only with explicit approval.";

export function inspectMemory(root = process.cwd()) {
  let paths;
  try {
    paths = resolveMemoryPaths(root);
  } catch {
    return {
      errors: ["Memory cleanup refused a linked or out-of-root memory path."],
      orphans: [],
      totalTopics: 0,
      mode: "report-only",
      recovery,
    };
  }

  const topicPaths = fs.existsSync(paths.topics)
    ? fs.readdirSync(paths.topics, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(paths.topics, entry.name))
    : [];
  const errors = [];
  let referenced = new Set();
  try {
    referenced = new Set(readMemoryIndex(paths.root).entries.map((entry) => entry.topic));
  } catch {
    errors.push("Memory index is invalid; every topic is reported as an orphan until repaired.");
  }

  return {
    errors,
    orphans: topicPaths.filter((topicPath) => !referenced.has(path.basename(topicPath))),
    totalTopics: topicPaths.length,
    mode: "report-only",
    recovery,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = inspectMemory();
  console.log(`Memory cleanup scan (${report.mode}): ${report.orphans.length} orphaned topic(s).`);
  console.log(`Recovery: ${report.recovery}`);
  for (const error of report.errors) {
    console.log(`- ${error}`);
  }
}
