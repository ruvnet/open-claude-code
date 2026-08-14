import path from "node:path";

export function isProtectedHarnessPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const normalizedLower = normalized.toLowerCase();
  const basenameLower = path.posix.basename(normalizedLower);
  return basenameLower === ".env"
    || /^\.env\.(?!example$)/.test(basenameLower);
}
