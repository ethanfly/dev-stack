import { createReadStream, existsSync, readdirSync } from "fs";
import { join } from "path";
import unzipper from "unzipper";

export function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: destDir }))
      .on("close", () => resolve())
      .on("error", reject);
  });
}

export function findFile(
  root: string,
  fileName: string,
  maxDepth = 5,
): string | null {
  if (!existsSync(root) || maxDepth < 0) return null;
  const direct = join(root, fileName);
  if (existsSync(direct)) return direct;
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const hit = findFile(join(root, entry.name), fileName, maxDepth - 1);
      if (hit) return hit;
    }
  } catch {
    return null;
  }
  return null;
}
