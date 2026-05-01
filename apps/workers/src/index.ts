import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { processParseJobs } from "@ebs/job-runner";
import { FileStore } from "@ebs/storage";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "../../..");
const store = new FileStore(join(repoRoot, "data/store"));

const intervalMs = Number(process.env.WORKER_POLL_MS ?? 2000);

async function tick() {
  const n = await processParseJobs(store);
  if (n > 0) console.log(`[worker] processed ${n} parse job(s)`);
}

void tick();
setInterval(() => void tick(), intervalMs);
console.log(`Worker polling every ${intervalMs}ms on ${store.root}`);
