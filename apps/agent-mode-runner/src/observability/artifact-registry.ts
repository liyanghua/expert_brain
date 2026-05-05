import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export class ArtifactRegistry {
  readonly runDir: string;
  private readonly artifacts: string[] = [];

  constructor(runDir: string) {
    this.runDir = runDir;
    mkdirSync(runDir, { recursive: true });
  }

  writeJson<T>(relativePath: string, value: T): string {
    const target = join(this.runDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(value, null, 2));
    if (!this.artifacts.includes(relativePath)) this.artifacts.push(relativePath);
    return relativePath;
  }

  list(): string[] {
    return [...this.artifacts];
  }
}
