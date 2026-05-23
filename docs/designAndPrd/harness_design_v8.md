# 在线简历平台 Harness 方案 v8.0

> 本方案面向 **MVP 阶段的全栈在线简历编辑平台**。

---

## 1. 结论摘要

- **基线架构：** 同仓多语言（`apps/web / apps/server / packages/vega-cli / contracts`）。`frontend` 使用 `Vite + React + TypeScript`，`backend` 使用 `Go + Gin`，CLI 使用 `Node.js + commander.js`，数据库采用 `PostgreSQL + JSONB`，鉴权采用 `JWT + bcrypt`，文件存储采用 `Local File System`。
- **顶层编排：** 根目录 `Makefile` 作为**唯一对外命令入口**。Makefile 内部分别调度 `pnpm` (JS 生态) 和 `go` (Go 生态)，以及 `docker`、`playwright` 等异构工具。
- **包管理：** Node.js 部分由 `pnpm workspace` 管理（`apps/web` + `packages/vega-cli`）；Go 部分由 `apps/server/go.mod` 独立管理；两者通过 `contracts/` 桥接，互不干扰。
- **流程驱动：** **Skill 文件存放在 Agent 原生配置目录**（如 `.claude/skills/`），**需求状态文件**存放于 `.vega-harness/requirements/<name>.json`。通过 `vega` (Node.js CLI) 操作状态，支持 `continue` 机制自动推进或恢复中断任务。
- **契约驱动：** `contracts/openapi` 维护 `OpenAPI 3.1` 契约，结合 `Fission-AI/OpenSpec` 管理变更链路。
- **质量保障：** 严格 TDD，`Vitest + Playwright + Go test` 多层拦截，`GitHub Actions` 门禁。
- **归档学习：** 每轮交付后回写 `docs/decisions`、`openspec/archive`、`AGENTS.md`，形成持续学习闭环。

---

## 2. 核心原则

| 原则 | 工程含义 | 在本项目中的落点 |
| --- | --- | --- |
| 系统优于工具 | 不把 Agent 当自由发挥的代码助手，而是放进有规则、有门禁的工程系统里 | 先建 AGENTS.md、Skill 体系、CI 基座，再开始业务开发 |
| 人类掌舵，Agent 执行 | 人类负责目标、边界和验收标准，Agent 负责具体实现与迭代 | 每个功能先写 spec 与验收项，再让 Agent 进入编码 |
| 仓库即事实源 | 知识不能只留在聊天记录中，必须沉淀在仓库结构、文档和契约文件里 | 约束、架构、领域模型、接口契约全部收敛到仓库内可检索文件 |
| 边界清晰，互不干扰 | JS 与 Go 在同一个仓库中应保持物理与配置上的独立性 | `pnpm` 只管 JS 包，`go.mod` 只管 Go 包，Makefile 做异构调度 |
| 验证优于信任 | 不默认相信 Agent 的实现正确，必须通过机械化验证兜底 | 所有 PR 默认经过 lint、typecheck、unit、e2e 和契约检查 |
| 编排优于单点 | 多 Skill 协同推进，而非一个大 prompt 解决所有问题 | 拆分为原子 Skill，通过状态机编排 |
| 闭环优于线性 | 失败信息直接回灌到下一轮修复，经验沉淀让系统越用越强 | CI 输出结构化，归档机制回写规则文件 |

---

## 3. 技术选型

### 3.1 选型总览

| 层 | 选型 | 角色 | 选择理由 |
| --- | --- | --- | --- |
| **顶层编排** | `Makefile` | 跨语言/异构环境的统一命令入口 | 透明、跨平台、零额外依赖；天然适合调度 `pnpm` + `go` + `docker` 等多套工具链 |
| **JS 包管理** | `pnpm workspace` | Node.js 子项目（应用 + 工具）的隔离与共享 | 高效现代，`--filter` 精确调度子包；将 CLI 与前端应用从物理层面切分 |
| 前端应用 | `Vite` + `React` + `TypeScript` | 简历编辑器、预览页、公开分享页 | HMR 快，适合 Agent 高频迭代 |
| 后端 API | `Go` + `Gin` | 简历 CRUD、模板、导出任务、分享接口 | Go 生态最成熟 HTTP 框架，长期维护确定性高；`apps/server` 独立 `go.mod`，与 JS 栈互不依赖 |
| 数据库 | `PostgreSQL` + `JSONB` | 用户、分享记录与简历内容存储 | 兼顾关系约束与简历树状结构的灵活性 |
| 鉴权 | `JWT` + `bcrypt` | 注册、登录、会话签发与校验 | 权限边界保持在自有服务内部 |
| 文件存储 | `Local File System` | 头像、附件、导出 PDF | MVP 阶段降低外部依赖 |
| 样式与组件 | `Tailwind CSS` + `shadcn/ui` + `Storybook` | 设计系统、组件隔离预览 | 便于局部修改和隔离开发 |
| 状态管理 | `TanStack Query` + `Zustand` | 服务端状态与本地编辑状态分治 | 与前端五层结构协同 |
| 契约与代码生成 | `OpenSpec` + `OpenAPI 3.1` + `orval` + `oapi-codegen` | 变更规约、TS client、Go 桩代码 | 变更治理与 API 契约治理分层 |
| **流程工具** | **`vega` (Node.js + commander.js)** | 需求状态管理、阶段推进 | 与前端心智一致；`packages/vega-cli` 下统一维护，支持 `pnpm link --global` 实时调试 |
| 测试 | `Vitest` + `RTL` + `Playwright` + `Go test` | 单元、组件、服务、关键链路回归 | 多层闭环 |
| CI 与部署 | `GitHub Actions` + `Docker` + 自有服务器 | 流水线、镜像构建、发布与回滚 | 控制在自有基础设施中 |

### 3.2 为什么是 Makefile 而不是 `package.json`

| 维度 | `package.json scripts` | `Makefile` |
| --- | --- | --- |
| 调用前端 | 天然支持 | 需 `cd` + 调用 `pnpm` |
| 调用 Go | 需 `cd backend && go ...`，易混乱 | 原生胜任 |
| 调用 Docker / DB / Playwright | 同样需要拼接 shell | 原生胜任 |
| 多目标依赖 | 无 | 一等公民（`make build: lint test`） |
| Agent 心智 | 必须先知道是 JS 项目还是 Go 项目 | `make <target>` 始终一致 |

**结论：** 在 **JS + Go 同仓**的多语言项目中，`package.json` 不适合承担"全栈编排器"的角色。Makefile 作为顶层入口、`pnpm` 作为 JS 子生态的内部编排器，是最清晰的分工。

---

## 4. Skill 体系与状态机编排

### 4.1 设计理念

参考 CSPADK 的核心设计，本项目的研发流程由 **Skill + 状态机 + CLI** 三件套驱动：

- **Skill**：一个原子化的研发能力单元。以 Markdown 文件形式存在，包含指令描述、输入输出约定和执行逻辑。Agent 在对应阶段被激活时读取并执行。
- **需求状态文件**：位于 `.vega-harness/requirements/<name>.json`，是一个 JSON 格式的状态机文件。
- **`vega` CLI**：Node.js 命令行工具，负责状态文件的 CRUD 和阶段校验。Agent 通过 `vega requirement status --json`、`vega complete`、`vega next --json` 等命令操作状态。
- **`continue` 机制**：每次 Agent 执行 continue 时，先调用 `vega status --json` 获取当前阶段，再调用对应的 Skill 推进流程。

### 4.2 Skill 存放位置：Agent 原生配置目录

Skill 文件 **不放在 `.vega-harness/` 中**。它们属于 Agent 的能力配置，应跟随各 Agent 工具的配置目录分发：

| Agent 工具 | Skill 存放路径 | 说明 |
| --- | --- | --- |
| Claude Code | `.claude/skills/` | Claude Code 原生支持读取该目录下的 skill |
| Cursor | `.cursor/rules/` 或 `.cursorrules` | Cursor 通过 rules 文件加载约束 |
| Codex | `.codex/skills/` 或 `AGENTS.md` 引用 | Codex 依赖 AGENTS.md 和目录约定 |

Skill 文件的**命名和内容保持统一**（如 `vega-continue.md`、`vega-brainstorm.md`），只是分发路径根据 Agent 工具不同而异。可通过配置目录软链接或指定单层真实路径来复用同一份源文件。

### 4.3 `.vega-harness/` 目录：只存状态与产物

`.vega-harness/` 是**纯数据目录**，**不包含 Skill 定义**，只包含：

```
.vega-harness/
├── .active                     # 当前活跃需求名称（纯文本，单行）
├── requirements/               # 需求状态文件
│   └── <requirement-name>.json
└── docs/                       # 流程产物（PRD 下载、brainstorm、TD 等）
    ├── prd-<name>.md
    ├── brainstorm-<name>.md
    └── td-<name>.md
```

与根目录 `docs/` 的分工：

| 目录 | 存放内容 | 生命周期 | 面向对象 |
| --- | --- | --- | --- |
| `.vega-harness/docs/` | 流程中间产物（PRD 下载、brainstorm、TD 初稿等） | 随需求生命周期，归档后可清理 | Agent 流程 |
| `docs/` | 永久文档（ADR、architecture、experiences） | 永久保留，持续积累 | 人类 + Agent 长期参考 |
| `openspec/archive/` | 归档后的 OpenSpec 四件套 | 永久保留 | 历史可检索范式 |

### 4.4 需求状态文件结构

```json
{
  "name": "resume-editor-mvp",
  "workflow": "full",
  "current_phase": "brainstorm",
  "phases": {
    "init":           { "status": "completed", "completed_at": "2026-05-20T10:00:00Z" },
    "brainstorm":     { "status": "in_progress" },
    "tech_design":    { "status": "pending" },
    "breakdown":      { "status": "pending" },
    "openspec":       { "status": "pending" },
    "implementation": { "status": "pending" },
    "verification":   { "status": "pending" },
    "archive":        { "status": "pending" }
  },
  "documents": {
    "prd":          ".vega-harness/docs/prd-resume-editor-mvp.md",
    "brainstorm":   null,
    "tech_design":  null,
    "openspec_dir": null
  },
  "modules": [],
  "created_at": "2026-05-20T09:30:00Z",
  "updated_at": "2026-05-20T10:00:00Z"
}
```

### 4.5 `vega` CLI 设计（Node.js + commander.js）

`vega` 存放于 `packages/vega-cli`，使用 `commander.js` 实现。

**为什么用 Node.js 而非 Go：**
1. **开发者心智一致**：前端开发者无需切换 Go 环境即可修改 CLI 逻辑。
2. **生态丰富**：可集成 `chalk`（终端颜色）、`ora`（加载动画）、`enquirer`（交互式询问）提升 Agent 执行体验。
3. **分发便捷**：本地通过 `pnpm link --global` 即可全局可用；团队/CI 通过 `pnpm publish` 发布。
4. **与 pnpm workspace 天然契合**：和 `apps/web` 共享 lockfile、tsconfig、lint 规则。

**核心命令清单：**

```bash
# 项目初始化
vega init                                              # 初始化 .vega-harness/ 目录结构，校验项目骨架

# 需求管理
vega requirement init <name> [--workflow lite|full]    # 创建需求状态文件（默认 lite）
vega requirement status [--json]                       # 查看当前活跃需求状态
vega requirement list [--json]                         # 列出所有需求
vega requirement current [--json]                      # 获取当前活跃需求名称
vega requirement switch <name>                         # 切换活跃需求

# 阶段推进
vega transition <phase> [--force]                      # 推进到指定阶段（默认校验顺序，--force 跳过）
vega complete                                          # 标记当前阶段为 completed 并自动推进到下一阶段
vega fail [--reason "..."]                             # 标记当前阶段为 failed
vega retry                                             # 将当前 failed 阶段重置为 in_progress

# 模块管理（Full 链路）
vega module add <module-name>                          # 添加拆解模块
vega module list [--json]                              # 列出当前需求的所有模块及状态
vega module status <module-name> [--json]              # 查看指定模块状态
vega module complete <module-name>                     # 标记模块完成

# 产物关联
vega doc set <type> <path>                             # 关联产物路径到状态文件
vega doc get <type>                                    # 获取产物路径

# 校验与路由
vega verify [--json]                                   # 校验状态文件完整性
vega next [--json]                                     # 输出下一个应该执行的 Skill 名称

# 归档
vega archive                                           # 归档当前需求
```

CLI 的设计原则：
- **只做状态读写和校验**，不包含业务逻辑。业务逻辑在 Skill 中。
- **`--json` 全面覆盖**：所有查询类命令均支持 `--json`，便于 Agent 解析。
- **幂等操作**，重复执行不产生副作用。
- **`complete` 自动推进**：标记当前阶段完成的同时，自动将 `current_phase` 推进到下一阶段并设为 `in_progress`。

### 4.6 十个核心 Skill 清单

| Skill 名称 | 触发阶段 | 职责 | 涉及 CLI 命令 |
| --- | --- | --- | --- |
| `vega-continue` | 任意阶段完成后 | 调用 `vega next` 判断下一步，调用对应 Skill | `vega requirement status --json`、`vega next --json` |
| `vega-requirement-init` | 拿到新需求时 | 创建状态文件、下载 PRD、设置 workflow | `vega requirement init`、`vega doc set prd <path>` |
| `vega-brainstorm` | init 完成后 | 需求澄清与方案探索，产出设计思路文档 | `vega complete`、`vega doc set brainstorm <path>` |
| `vega-tech-design` | brainstorm 后（仅 full） | 技术方案设计，生成 TD 文档 | `vega complete`、`vega doc set tech_design <path>` |
| `vega-breakdown` | tech-design 后（仅 full） | 需求拆解为可并行子模块 | `vega module add`、`vega complete` |
| `vega-openspec` | 设计确认后 | OpenSpec 四件套生成，同步更新 OpenAPI 契约 | `vega complete`、`vega doc set openspec_dir <path>` |
| `vega-implementation` | OpenSpec 就绪后 | TDD 实现：先写失败测试，再补实现 | `vega module complete`、`make tdd-check` |
| `vega-verification` | 实现完成后 | 全面验证 | `make lint && make test && make e2e`、`vega complete` |
| `vega-archive` | 验证通过后 | 归档 specs、更新 docs、回写 AGENTS.md | `vega complete`、`make archive` |
| `vega-experience` | CI 失败、`vega fail` 执行后或复盘时 | 从失败日志提取根因，更新规则文件，修复后调用 `vega retry` 重试 | `vega fail`、`vega retry` |

### 4.7 双链路设计

- **Lite 链路（简单需求）：** `init → brainstorm → openspec → implementation → verification → archive`
- **Full 链路（复杂需求）：** `init → brainstorm → tech_design → breakdown → openspec → implementation → verification → archive`

### 4.8 `continue` 机制流程与上下文恢复

**跨 Session 恢复的上下文重建：**
Agent 执行 continue 的**第一步**必须且仅能通过以下三项重建上下文（桥接跨 Session 的记忆）：
1. **当前状态**：执行 `vega requirement status --json` 获取当前需求及模块所处阶段。
2. **近期动作**：执行 `git log -n 5` 了解最近的改动。
3. **关键产物**：读取 `vega requirement status --json` 返回的 `documents` 字段关联的核心产物（如 PRD、Tech Design 或 OpenSpec）。

**执行链路：**
```
Agent 执行 continue
    │
    ▼
vega requirement status --json  →  获取 current_phase
    │
    ▼
vega next --json  →  输出下一个 Skill 名称
    │
    ▼
Agent 读取对应 Skill 文件（位于 .claude/skills/ 等 Agent 配置目录）并执行
    │
    ▼
Skill 执行完毕 → vega complete → 状态文件更新
```

阶段路由表：

```
init (completed)               → vega-brainstorm
brainstorm (completed) + full  → vega-tech-design
brainstorm (completed) + lite  → vega-openspec
tech_design (completed)        → vega-breakdown
breakdown (completed)          → vega-openspec (选择模块)
openspec (completed)           → vega-implementation (选择模块)
implementation (completed)     → vega-verification
verification (completed)       → vega-archive
archive (completed)            → 需求完成
any_phase (failed)             → vega-experience (修复后 vega retry 重置状态并重试当前阶段)
```

---

## 5. pnpm Workspace 架构

### 5.1 工作区定义

`pnpm-workspace.yaml`：

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- **`apps/web`**：前端业务应用（Vite + React + TS）。
- **`packages/vega-cli`**：流程工具 CLI（Node.js + commander.js）。
- **`apps/server`** ：Go + Gin 后端，**不进入 pnpm 治理范围**，独立 `go.mod` 管理。

### 5.2 JS 与 Go 同仓互不干扰原则

1. **依赖隔离**：根目录的 `node_modules` 和 `pnpm-lock.yaml` 仅服务于 JS 项目。`apps/server` 严禁包含 `package.json`，仅保留 `go.mod` 和 `go.sum`。
2. **构建解耦**：Go 项目的编译与测试完全由 Go 工具链处理。Makefile 通过 `cd apps/server && go ...` 调用，不让 `pnpm` 介入。
3. **契约桥接**：唯一的交集是 `contracts/openapi/`。JS 通过 `orval` 生成 TS Client，Go 通过 `oapi-codegen` 生成 Server Stub，两端通过同一份 OpenAPI 契约对齐。

### 5.3 `vega` CLI 本地调试工作流

1. `cd packages/vega-cli`
2. `pnpm install && pnpm build`
3. `pnpm link --global`
4. 在仓库任何目录执行 `vega requirement status` 即可调用本地源码产物，实现"即改即用"。

CI / 团队分发：由于 npm 官方已有 `vega` 包，为防冲突，在 `packages/vega-cli/package.json` 中使用命名空间 `"name": "@vega-resume/vega-cli"`，升版后执行 `pnpm publish --access public`（或发内网）。CLI 的暴露命令为 `"bin": { "vega": "./dist/index.mjs" }`，构建工具使用 `tsdown`。MVP 阶段无需频繁发包，本地链接 + 仓库源码即可高效运转。

---

## 6. Makefile 顶层编排

Makefile 作为**异构环境的统一命令入口**，内部分别调用 `pnpm` 和 `go`，不让两者互相侵入。

```makefile
# ==========================================
# Vega Harness - 顶层任务编排
# 命令分类：环境/契约/静态/测试/构建/部署/工具
# ==========================================

.PHONY: help install dev clean
.DEFAULT_GOAL := help

help: ## 列出所有可用命令
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---- 环境与初始化 ----
install:           ## 安装所有依赖（JS + Go）
	pnpm install
	cd apps/server && go mod download
	cd packages/vega-cli && pnpm link --global

clean:             ## 清理所有构建产物与缓存
	pnpm -r clean || true
	cd apps/server && go clean -cache

# ---- 契约与生成 ----
spec-check:        ## 检查 OpenSpec 变更与 OpenAPI 契约一致性
	pnpm --filter web spec:check
generate:          ## 从 OpenAPI 契约生成 TS client 与 Go stub
	pnpm --filter web gen:api
	cd apps/server && oapi-codegen -config config.yaml ../../contracts/openapi.yaml

# ---- 静态检查 ----
lint: lint-web lint-server lint-cli  ## 全量 lint
lint-web:     ## ESLint + tsc
	pnpm --filter web lint
lint-server:      ## go vet + golangci-lint
	cd apps/server && go vet ./... && golangci-lint run
lint-cli:          ## CLI 自身 lint
	pnpm --filter @vega-resume/vega-cli lint

# ---- 测试 ----
test: test-web test-server test-cli  ## 全量单元测试
test-web:     ## Vitest + RTL
	pnpm --filter web test
test-server:      ## Go test
	cd apps/server && go test ./...
test-cli:          ## CLI 单元测试
	pnpm --filter @vega-resume/vega-cli test
tdd-check:         ## 综合执行所有测试层，返回 red/green 状态
	@$(MAKE) test || (echo "❌ TDD: RED" && exit 1)
	@echo "✅ TDD: GREEN"
e2e:               ## Playwright 全链路 E2E
	pnpm --filter web e2e

# ---- 构建与部署 ----
build: build-web build-server build-cli  ## 全栈构建
build-web:
	pnpm --filter web build
build-server:
	cd apps/server && go build -o ../../dist/server ./cmd/api
build-cli:
	pnpm --filter @vega-resume/vega-cli build
storybook:         ## 启动 Storybook UI 隔离开发环境
	pnpm --filter web storybook
docker-build:      ## Docker 镜像构建
	docker build -t resume-platform:latest .
deploy:            ## 部署到自有服务器
	bash scripts/deploy.sh
smoke:             ## 部署后冒烟测试
	bash scripts/smoke.sh

# ---- 开发环境（统一拉起前端、后端、Docker）----
dev:               ## 启动完整本地开发环境（前端 + 后端 + DB）
	$(MAKE) db-up
	@trap '$(MAKE) db-down' EXIT; \
	  (pnpm --filter web dev &) \
	  && (cd apps/server && go run ./cmd/api &) \
	  && wait
dev-web:      ## 仅前端
	pnpm --filter web dev
dev-server:       ## 仅后端
	cd apps/server && go run ./cmd/api
db-up:             ## 启动 PostgreSQL (Docker)
	docker compose -f deploy/docker-compose.dev.yml up -d postgres
db-down:           ## 停止 PostgreSQL
	docker compose -f deploy/docker-compose.dev.yml down

# ---- 归档 ----
archive:           ## 归档已完成需求，同步 docs 与规则文件
	vega archive

# ---- vega CLI ----
vega-build:        ## 构建 vega CLI
	pnpm --filter @vega-resume/vega-cli build
vega-link:         ## 本地全局链接 vega
	cd packages/vega-cli && pnpm link --global
vega-publish:      ## 发布 vega CLI（需内部 registry）
	pnpm --filter @vega-resume/vega-cli publish
```

**关键约定：**
- **对外**：开发者和 Agent 永远只调用 `make <target>`，不直接调用 `pnpm` 或 `go`。
- **对内**：Makefile 通过 `pnpm --filter` 调度 JS 子包，通过 `cd apps/server && go ...` 调度 Go。
- **Agent 优先级**：所有 Skill 中涉及的命令都通过 Makefile 暴露，避免 Agent 误执行底层工具命令。

---

## 7. 约束与拦截机制

| 拦截层 | 工具 | 调度命令 | 主要检查点 | 本项目示例 |
| --- | --- | --- | --- | --- |
| 契约与生成 | OpenSpec + OpenAPI lint + orval + oapi-codegen | `make spec-check`、`make generate` | 接口字段、数据模型、生成物与契约一致 | 修改 resume 响应后，TS client 与 Go stub 同步更新 |
| 前端单元/组件 | Vitest + RTL | `make test-web` | models、controller、store、表单交互 | 修改工作经历顺序后状态映射正确 |
| 后端服务/API | Go test + httptest + PostgreSQL 测试库 | `make test-server` | handler 输入输出、鉴权、JSONB 读写 | 更新简历接口拒绝非法 payload |
| CLI 自身 | Vitest | `make test-cli` | `vega` 命令的状态机流转、参数校验 | `vega transition` 在非法阶段时报错 |
| 全链路 E2E | Playwright | `make e2e` | 真实浏览器 + Go 服务 + PostgreSQL | 创建 → 编辑 → 保存 → 预览 → 分享 |

所有拦截层在 `GitHub Actions` 中对应 `make spec-check`、`make lint`、`make test`、`make e2e`，**任何一层失败都阻断合并**。

---

## 8. Spec Coding 驱动闭环

基于 [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) 的理念，在进入具体实现前，必须产出并确认“四件套”（通常存放于 `openspec/changes/`）：
- **Proposal（提案）**：一句话背景、目标描述、核心 User Story。
- **Design（设计）**：技术选型、数据库表结构变动、核心模块交互图（Mermaid）。
- **Spec（规约）**：数据模型（Type/Model 定义）、接口契约（如 OpenAPI 变动点）。
- **Tasks（任务拆解）**：将开发工作拆解为可验证的 TDD 任务列表，明确每步验收条件。

**闭环流程：**
1. 需求进入后，先由 `vega-openspec` 产出上述 OpenSpec 四件套。
2. 把接口与关键数据模型沉淀为 `contracts/openapi/` 下的 OpenAPI 3.1 契约。
3. `make generate` 生成前端 TS client 与后端 Go stub。
4. Agent 基于 spec + contract + stubs 生成失败测试（确认 red 状态）。
5. 在前端五层目录和后端业务层中编写代码，`make tdd-check` 持续验证。
6. 若失败，优先回到 OpenSpec / OpenAPI 契约修正。

---

## 9. 归档与持续学习

| 载体 | 何时更新 | 记录内容 | 对 Agent 的作用 |
| --- | --- | --- | --- |
| `AGENTS.md` | 规则变化、重复错误 | 仓库地图、危险操作限制 | 第一份规则入口 |
| `docs/decisions/adr-*.md` | 架构取舍 | 选型理由、拒绝方案 | 避免反复推翻已确认决策 |
| `openspec/archive/` | 功能验收完成 | 归档的 OpenSpec 四件套 | 可检索历史范式 |
| `docs/experiences/` | CI 失败、线上缺陷 | 最小复现、根因、修复步骤 | 可引用的修复手册 |
| Agent Skill 文件 | 重复流程稳定 | 新的或修订的 Skill | 可执行的能力单元 |

---

## 10. 仓库目录结构

```
vega-resume/
├── Makefile                            # 顶层异构编排入口（唯一对外命令面）
├── pnpm-workspace.yaml                 # pnpm 工作区配置（仅 JS）
├── pnpm-lock.yaml                      # JS 全局锁文件
├── package.json                        # 根 package.json（仅声明 workspace，无业务脚本）
├── CLAUDE.md                           # Claude Code 专属约束
│
├── .claude/                            # Claude Code 配置
│   └── skills/                         # ← Skill 文件存放位置（Agent 原生目录）
│       ├── vega-continue.md
│       ├── vega-requirement-init.md
│       ├── vega-brainstorm.md
│       ├── vega-tech-design.md
│       ├── vega-breakdown.md
│       ├── vega-openspec.md
│       ├── vega-implementation.md
│       ├── vega-verification.md
│       ├── vega-archive.md
│       └── vega-experience.md
│
├── .vega-harness/                      # 需求状态与流程产物（纯数据，无 Skill）
│   ├── .active                         # 当前活跃需求名称（纯文本，单行）
│   ├── requirements/                   # 需求状态文件
│   │   └── <requirement-name>.json
│   └── docs/                           # 流程中间产物
│       ├── prd-<name>.md
│       ├── brainstorm-<name>.md
│       └── td-<name>.md
│
├── apps/
│   ├── web/                            # Vite + React + TS（受 pnpm workspace 管理）
│   │   ├── package.json
│   │   └── src/
│   │       ├── ui/                     # 展示层
│   │       ├── controller/             # 流程编排
│   │       ├── services/               # 业务逻辑
│   │       ├── store/                  # 状态管理
│   │       └── models/                 # 领域模型
│   │
│   └── server/                         # Go + Gin（独立 go.mod，不进入 pnpm）
│       ├── go.mod
│       ├── go.sum
│       ├── cmd/api/main.go
│       ├── internal/
│       │   ├── handler/                # 路由处理
│       │   ├── service/                # 业务逻辑
│       │   ├── repository/             # 数据访问
│       │   └── auth/                   # 鉴权
│       └── assets/                     # 文件资源
│           ├── avatars/
│           ├── exports/
│           └── tmp/
│
├── packages/
│   └── vega-cli/                       # Node.js CLI（受 pnpm workspace 管理）
│       ├── package.json                # 定义 bin: { "vega": "./dist/index.mjs" }
│       ├── tsconfig.json
│       ├── tsdown.config.ts
│       ├── src/
│       │   ├── index.ts                # commander.js 入口
│       │   ├── commands/               # 各子命令实现
│       │   │   ├── init.ts
│       │   │   ├── requirement.ts
│       │   │   ├── transition.ts
│       │   │   ├── complete.ts
│       │   │   ├── retry.ts
│       │   │   ├── module.ts
│       │   │   ├── doc.ts
│       │   │   ├── next.ts
│       │   │   └── archive.ts
│       │   └── core/                   # 状态机引擎
│       └── tests/
│
├── contracts/                          # 契约目录（JS 与 Go 的唯一桥梁）
│   └── openapi/                        # OpenAPI 3.1 契约文件
│
├── openspec/                           # OpenSpec 规约目录（由 openspec init 生成）
│   └── config.yaml                     # OpenSpec 配置
│
├── docs/                               # 永久项目文档
│   ├── designAndPrd/                   # 设计文档与 PRD
│   ├── UIdesign/                       # UI 设计稿
│   ├── decisions/                      # ADR 决策记录
│   └── experiences/                    # 经验沉淀
│
├── deploy/                             # 部署相关
│   ├── docker-compose.dev.yml
│   └── Dockerfile
│
└── scripts/                            # 辅助脚本
    ├── deploy.sh
    └── smoke.sh
```

### 10.1 前端五层架构约束
为避免 Agent 把业务逻辑随意塞入 UI 层，前端代码必须严格遵守以下越层禁止规则：
- **ui/**：只允许视图渲染和用户事件传递。禁止直接调用 `services` 或直接修改 `store`，只能通过 `controller` 桥接或派发。
- **controller/**：充当“胶水层”，编排 `services` 与 `store`，处理页面级的副作用（Effects）与业务流程。
- **services/**：纯粹的业务逻辑与 API 请求。无任何 UI 依赖，必须能在 Node.js 或测试环境中独立运行。
- **store/**：全局状态定义（Zustand 等）。禁止包含复杂业务逻辑，只暴露基础的 state 和纯粹的 action。
- **models/**：只包含 TS 类型定义（Types/Interfaces）和纯函数（数据转换、格式化），绝对禁止任何副作用。

---

## 11. MVP 落地建议

### 11.1 最小闭环

1. 邮箱密码注册与登录
2. 创建简历
3. 删除简历
4. 编辑基础信息
5. 编辑教育 / 工作 / 项目 / 技能四类模块
6. 实时预览
7. 保存版本
8. JSON 导入导出
9. 无水印 PDF 导出

### 11.2 推荐实施顺序

1. **基建初始化**：建立根目录 `Makefile`、`pnpm-workspace.yaml`、`AGENTS.md`、`.claude/skills/`、`.vega-harness/` 骨架。
2. **CLI 落地**：在 `packages/vega-cli` 初始化 Node.js 项目（commander.js），实现最小可用命令集（`init / status / complete / next`），执行 `pnpm link --global` 全局可用。
3. **Skill 投放**：把 10 个核心 Skill 文件写入 `.claude/skills/`。
4. **Go 后端骨架**：在 `apps/server` 初始化 Go + Gin 项目，独立 `go.mod`，确保 `make test-server` 可独立通过。
5. **前端骨架**：在 `apps/web` 初始化 Vite + React，建立五层目录结构。
6. **契约链路**：建立 `openspec/changes` 与 `contracts/openapi`，跑通 `proposal / design / spec / tasks` 最小模板。
7. **代码生成**：接入 `make generate`（orval + oapi-codegen）。
8. **拦截网建设**：建立 Vitest、Go test、Playwright 与 GitHub Actions，跑通 `make lint && make test && make e2e`。
9. **主链路验证**：用 `vega init` 初始化项目骨架，再用 `vega requirement init` 创建一个测试需求，跑通完整 Skill 链路。
10. **归档机制**：每个里程碑执行 `make archive`，把决策、规则、经验回写到 `docs/` 与 Skill 文件。

### 11.3 关键提醒

- **Makefile 是唯一对外入口**：Agent 与开发者均通过 `make <target>` 操作，不要直接调 `pnpm` 或 `go`。
- **pnpm 与 go 物理隔离**：`apps/server` 不要出现 `package.json`；`packages/vega-cli` 不要出现 `go.mod`。
- **Skill 文件就近分发**：Skill 永远跟随 Agent 配置目录（`.claude/skills/` 等），而不是塞进 `.vega-harness/`。
- **vega CLI 与业务代码物理隔离**：`packages/vega-cli` 独立维护，便于发包；与 `apps/web` 共享 lockfile 与工具链。
- **宁可少做一个业务功能，也不要省掉 spec、契约、测试拦截网和归档机制。**

---

## 12. 最终建议

**Harness v8.0 是最具实战指导意义的设计里程碑：**

- **流程层**：回归 v3.1 的 **Skill 体系（10 个原子能力单元） + 需求状态机 + Agent 原生目录分发**，并通过 `.vega-harness/` 沉淀状态与中间产物。
- **工具层**：保留 v4/v5 的 **Node.js `vega` CLI（commander.js）+ pnpm workspace（`apps/web` + `packages/vega-cli`）**，让前端开发者无需切换语言生态即可维护流程工具。
- **后端层**：保留 v5 的 **Go 独立模块（`apps/server` + `go.mod`）**，与 JS 栈通过 `contracts/openapi` 桥接，互不干扰。
- **编排层**：**回归 Makefile** 作为跨语言/异构环境的顶层入口，不再让 `package.json` 越权承担"全栈编排器"角色。

**一句话总结：用 Skill + 状态机驱动需求闭环，用 Node.js `vega` CLI 操作状态机，用 pnpm workspace 管理 JS 生态，用独立 `go.mod` 管理 Go 生态，用根目录 Makefile 把上述一切异构工具链统一为对外的单一命令面；任何一轮交付完成后，把决策、规则和经验归档到 `docs/decisions`、`openspec/archive`、`AGENTS.md` 与 Skill 文件中，让下一轮 Agent 在更完整的上下文里继续工作。**
