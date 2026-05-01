# Expert Brain Studio

AI-native document enhancement and Ground Truth workspace (monorepo).

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) 9+

## Commands

| Command | Description |
|--------|-------------|
| `pnpm install` | Install dependencies |
| `pnpm dev` | Run API + web dev servers |
| `pnpm dev:api` | API only (default http://localhost:8787) |
| `pnpm dev:web` | Web only (default http://localhost:5173) |
| `pnpm dev:worker` | Background job worker |
| `pnpm build` | Build all packages and apps |
| `pnpm test` | Unit tests (packages) |
| `pnpm typecheck` | TypeScript across workspace |
| `pnpm lint` | 同 `typecheck`（全仓） |
| `pnpm validate-schemas` | 校验 `data/fixtures` 样例 JSON |
| `pnpm test:e2e` | Playwright（自动拉起 Vite） |
| `pnpm eval` | 最小抽取评测脚本 |

## 作业队列

解析任务默认由 **API 进程内定时轮询**处理；`pnpm dev:worker` 共用 `data/store/jobs` 队列（可与 API 并行消费，生产环境建议只保留一种消费者）。

See [AGENTS.md](./AGENTS.md) and [docs/Architecture_PRD_UI.md](./docs/Architecture_PRD_UI.md).

Raw uploads are immutable; derived IR and drafts live under `data/store/` in dev.
