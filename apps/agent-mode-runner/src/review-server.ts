import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildReviewWorkbench } from "./review/build-review-workbench.js";
import { generateExpertSummaryArtifact } from "./review/expert-summary-adapter.js";
import {
  generateOneClickOptimizationArtifact,
  generateOneClickOptimizationPlanArtifact,
} from "./review/one-click-optimization-adapter.js";

type RunRecord = {
  run_id: string;
  run_dir: string;
  scene_name?: string;
  final_status?: string;
  updated_at?: string;
};

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function stringArg(args: Record<string, string | boolean>, key: string, fallback?: string) {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function textResponse(
  res: ServerResponse,
  status: number,
  body: string,
  contentType = "text/plain; charset=utf-8",
) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function safeReadSummary(runDir: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(runDir, "run_summary.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function discoverRunRoots(input: { repoRoot: string; outputRoot?: string }) {
  if (input.outputRoot) return [resolve(input.outputRoot)];
  const dataDir = join(input.repoRoot, "data");
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir)
    .filter((name) => name.startsWith("agent-mode-runs"))
    .map((name) => join(dataDir, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    });
}

function listRuns(roots: string[]): RunRecord[] {
  const runs: RunRecord[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const runDir = join(root, name);
      if (!statSync(runDir).isDirectory()) continue;
      if (!existsSync(join(runDir, "run_summary.json"))) continue;
      const summary = safeReadSummary(runDir);
      runs.push({
        run_id: String(summary.run_id ?? name),
        run_dir: runDir,
        scene_name: typeof summary.scene_name === "string" ? summary.scene_name : undefined,
        final_status:
          typeof summary.final_status === "string" ? summary.final_status : undefined,
        updated_at: statSync(join(runDir, "run_summary.json")).mtime.toISOString(),
      });
    }
  }
  return runs.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
}

function findRunDir(roots: string[], runId: string): string | null {
  return listRuns(roots).find((run) => run.run_id === runId || run.run_dir.endsWith(runId))
    ?.run_dir ?? null;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  input: { roots: string[]; uiPath: string },
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/api/runs") {
      jsonResponse(res, 200, { runs: listRuns(input.roots) });
      return;
    }

    const reviewMatch = /^\/api\/runs\/([^/]+)\/review-workbench$/.exec(url.pathname);
    if (reviewMatch) {
      const runId = decodeURIComponent(reviewMatch[1]!);
      const runDir = findRunDir(input.roots, runId);
      if (!runDir) {
        jsonResponse(res, 404, { error: "run_not_found", run_id: runId });
        return;
      }
      jsonResponse(res, 200, buildReviewWorkbench({ runDir }));
      return;
    }

    const summaryMatch = /^\/api\/runs\/([^/]+)\/expert-summary$/.exec(url.pathname);
    if (summaryMatch) {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "method_not_allowed" });
        return;
      }
      const runId = decodeURIComponent(summaryMatch[1]!);
      const runDir = findRunDir(input.roots, runId);
      if (!runDir) {
        jsonResponse(res, 404, { error: "run_not_found", run_id: runId });
        return;
      }
      const expert_summary = await generateExpertSummaryArtifact({ runDir });
      jsonResponse(res, 200, {
        expert_summary,
        review_workbench: buildReviewWorkbench({ runDir }),
      });
      return;
    }

    const optimizePlanMatch = /^\/api\/runs\/([^/]+)\/one-click-optimize-plan$/.exec(
      url.pathname,
    );
    if (optimizePlanMatch) {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "method_not_allowed" });
        return;
      }
      const runId = decodeURIComponent(optimizePlanMatch[1]!);
      const runDir = findRunDir(input.roots, runId);
      if (!runDir) {
        jsonResponse(res, 404, { error: "run_not_found", run_id: runId });
        return;
      }
      buildReviewWorkbench({ runDir });
      const one_click_optimization_plan = await generateOneClickOptimizationPlanArtifact({
        runDir,
        useDefaultLlm: true,
      });
      jsonResponse(res, 200, {
        one_click_optimization_plan,
        review_workbench: buildReviewWorkbench({ runDir }),
      });
      return;
    }

    const optimizeMatch = /^\/api\/runs\/([^/]+)\/one-click-optimize$/.exec(url.pathname);
    if (optimizeMatch) {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "method_not_allowed" });
        return;
      }
      const runId = decodeURIComponent(optimizeMatch[1]!);
      const runDir = findRunDir(input.roots, runId);
      if (!runDir) {
        jsonResponse(res, 404, { error: "run_not_found", run_id: runId });
        return;
      }
      try {
        const one_click_optimization = await generateOneClickOptimizationArtifact({ runDir });
        jsonResponse(res, 200, {
          one_click_optimization,
          review_workbench: buildReviewWorkbench({ runDir }),
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            endpoint: "one-click-optimize",
            run_id: runId,
            stage: "preview_generation",
            message: err instanceof Error ? err.message : String(err),
          }),
        );
        jsonResponse(res, 200, {
          error: "one_click_optimize_preview_failed",
          message: err instanceof Error ? err.message : String(err),
          review_workbench: buildReviewWorkbench({ runDir }),
        });
      }
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      textResponse(res, 200, readFileSync(input.uiPath, "utf8"), "text/html; charset=utf-8");
      return;
    }

    jsonResponse(res, 404, { error: "not_found" });
  } catch (err) {
    jsonResponse(res, 500, {
      error: "review_server_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function listenWithFallback(server: ReturnType<typeof createServer>, port: number, attempts = 10) {
  let currentPort = port;
  return new Promise<number>((resolveListen, rejectListen) => {
    const tryListen = () => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attempts > 0) {
          attempts -= 1;
          currentPort += 1;
          tryListen();
          return;
        }
        rejectListen(err);
      });
      server.listen(currentPort, () => resolveListen(currentPort));
    };
    tryListen();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(stringArg(args, "repo-root", process.cwd())!);
  const roots = discoverRunRoots({
    repoRoot,
    outputRoot: stringArg(args, "output-root"),
  });
  const port = Number(stringArg(args, "port", process.env.PORT ?? "8797"));
  const uiPath = join(repoRoot, "apps/agent-mode-runner/review-ui/index.html");
  const server = createServer((req, res) => {
    void handleRequest(req, res, { roots, uiPath });
  });
  const actualPort = await listenWithFallback(server, port);
  console.log(`Agent Runner review workbench listening on http://localhost:${actualPort}/`);
  console.log(`Run roots: ${roots.length ? roots.join(", ") : "(none found)"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
