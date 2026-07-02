---
name: vega-verification
description: 对已通过 implementation 测试的 Vega 需求执行代码质量验证、反退化扫描、lint/build/spec 一致性检查，形成验证报告并推进到 archive 阶段。用于活跃需求处于 `verification`、用户要求质量验证/代码审查/反退化检查，或 `vega next --json` 返回 `vega-verification` 时。
---

# Vega 质量验证

`implementation` 阶段已经负责 TDD 和测试通过；本 Skill 负责在合入或归档前做更高层的质量门禁：静态检查、架构边界、安全风险、复杂度、死代码、契约一致性和文档化验证结论。

验证以一个活跃需求为最终归档单元；Lite workflow 直接验证整需求，Full workflow 需要额外读取 `vega module list --json`，确认所有模块均已 completed，并按模块维度补充风险扫描和报告记录。当前 CLI 提供 `vega verify --json` 做状态文件完整性校验，但代码质量仍由本 Skill 的命令门禁和人工审查完成。

## 硬性边界

- 不新增需求范围，不把验证阶段变成二次实现阶段。
- 不执行 `git commit`。
- 不回滚用户已有改动；遇到相关脏改动时先理解来源。
- 不直接编辑 `.vega-harness/requirements/*.json`；验证报告通过 `vega doc set` 登记。
- 不在存在未解决的 Critical / High 质量问题时执行 `vega complete`。
- 不把“命令未配置”“依赖缺失”“脚本不存在”伪装成通过；这类问题要记录为工具链缺口或阻塞。

## 输入与产出

输入：

- `vega requirement status --json`；
- `vega next --json`；
- `vega doc get prd --json`；
- `vega doc get brainstorm --json`；
- `vega doc get tech_design --json`，如果存在；
- `vega doc get openspec_dir --json`；
- Full workflow 的 `vega module list --json`；
- OpenSpec change 中的 `proposal.md`、`design.md`、`tasks.md`、`specs/**/spec.md`；
- `git status --short`、`git diff --name-only`、`Makefile` 和受影响代码。

产出：

- `docs/verification/<requirement-name>-verification-<YYYY-MM-DD>.md`；
- `documents.verification_report` 指向验证报告；
- `verification` 阶段完成，状态推进到 `archive`。

## 执行流程

为以下步骤建立任务清单并逐步更新。发现问题后优先判断是否属于本次需求范围；能以小补丁修复的质量问题可以修复并重跑验证，不能可靠修复的要阻塞阶段推进。

### 1. 恢复 Vega 上下文

执行：

```bash
vega requirement status --json
vega next --json
vega verify --json
git status --short
git log -n 5 --oneline
```

只有同时满足以下条件才继续：

- 需求 `status` 为 `in_progress`；
- `current_phase` 为 `verification`；
- 当前阶段状态为 `in_progress`；
- 下一 Skill 为 `vega-verification`。

异常处理：

- 尚未进入 `verification`：停止并说明应先完成当前阶段；
- 当前阶段为 `failed`：遵循 `vega next --json` 的恢复路由；
- 没有活跃需求：停止并使用 `vega-requirement-init`；
- `vega verify --json` 失败：停止并报告 state verification 错误；不要把损坏状态归档；
- 已进入 `archive` 或更后阶段：不要重复推进，除非用户明确要求重新验证。

如果 workflow 为 `full`，执行：

```bash
vega module list --json
```

所有模块必须为 `completed`。如果存在 pending 模块，返回 `vega-implementation` 补齐对应模块，不进入质量验证结论。

### 2. 读取需求和 OpenSpec 产物

执行并解析：

```bash
vega doc get prd --json
vega doc get brainstorm --json
vega doc get tech_design --json
vega doc get openspec_dir --json
```

从 `openspec_dir` 推导 `<change-name>`，并读取：

- `<openspec_dir>/proposal.md`
- `<openspec_dir>/design.md`
- `<openspec_dir>/tasks.md`
- `<openspec_dir>/specs/**/spec.md`

然后执行：

```bash
openspec validate <change-name> --strict --json
openspec status --change <change-name> --json
```

要求：

- `tasks.md` 中不得存在未完成的 `- [ ]` 实现任务；
- OpenSpec strict validation 通过；
- OpenSpec 命令可能打印 PostHog / 网络遥测错误。只要退出码为 0 且 JSON 主体有效，不把遥测失败当作流程失败。

### 3. 确定验证范围

执行：

```bash
git diff --name-only
git diff --cached --name-only
git ls-files --others --exclude-standard
```

根据变更文件建立验证矩阵：

- `packages/vega-cli/**`：CLI 命令、状态机、文档登记、Vitest 测试；
- `apps/web/**`：React、前端构建、前端 lint、必要时 E2E；
- `apps/server/**`：Go API、`go vet`、`golangci-lint`、Go 测试；
- `contracts/**` 或 `openspec/**`：OpenSpec 与 OpenAPI 契约一致性；
- `docs/**`、`AGENTS.md`、`CLAUDE.md`：长期知识和用户文档是否反映当前状态。

如果工作区包含与当前需求无关的大量改动，不要擅自清理；在报告中区分“本次验证范围内”和“未归属改动”。

Full workflow 还要把验证范围按模块分组：

- 每个模块对应的 OpenSpec tasks 是否全部完成；
- 每个模块触达的文件、契约和测试命令；
- 模块间依赖是否按 design 的顺序实现；
- 已 completed 的模块是否存在后续改动导致的回归风险。

### 4. 执行命令级质量门禁

优先运行设计文档或 `tasks.md` 中列出的精确命令；然后按影响面补充 Makefile 目标。

常用矩阵：

```bash
vega verify --json
make lint-cli
make test-cli
make build-cli
make lint-web
make test-web
make build-web
make lint-server
make test-server
make build-server
make spec-check
make build
make e2e
```

选择规则：

- 总是先运行 `vega verify --json` 确认 harness 状态完整；
- CLI 改动至少运行 `make lint-cli`、`make test-cli`、`make build-cli`；
- Web 改动至少运行 `make lint-web`、`make test-web`、`make build-web`；
- Server 改动至少运行 `make lint-server`、`make test-server`、`make build-server`；
- 契约或 OpenSpec 改动运行 `make spec-check`，必要时运行 `make generate` 后检查生成物；
- 跨栈或发布前验证运行 `make lint`、`make test`、`make build`，必要时运行 `make e2e`。

处理失败：

- 如果失败来自真实代码问题，修复后重跑同一命令；
- 如果失败来自脚本未配置、依赖未安装或工具缺失，记录为 Tooling Gap，并判断是否阻塞本次归档；
- 不把没有运行过的命令写成通过。

### 5. 执行反退化代码审查

围绕本次 diff 和受影响模块做人工审查，至少覆盖以下类别。

#### Security

- Shell 命令是否存在未转义参数、命令拼接或任意路径执行；
- 文件读写是否防止路径穿越、覆盖用户未授权文件；
- 日志、错误信息、文档是否泄漏 token、密钥、个人敏感信息；
- 用户输入、CLI 参数、HTTP 参数是否有边界校验和清晰错误。

#### Architecture

- 前端、后端、CLI 代码是否保持在各自目录边界内；
- `apps/server/` 不引入 Node/package 体系；
- CLI 状态推进仍通过公开命令和 store API，不直接改 `.vega-harness`；
- OpenSpec、docs、contracts 的职责没有混在业务实现中；
- 新增抽象是否确实减少复杂度，而不是掩盖简单逻辑。

#### Complexity

- 单文件超过 500 行默认视为失败，超过 300 行至少给出拆分判断；
- 单函数超过 80 行默认要求拆分或说明原因；
- 避免深层嵌套、重复分支、过宽参数对象和“万能工具函数”；
- 公共类型、状态枚举和流程常量应集中复用，避免复制一份近似定义。

#### Dead Code

- 无未使用导出、无未引用配置、无死分支；
- 无大段注释掉的旧实现；
- 测试辅助函数应被真实测试使用；
- 生成物应能追溯到生成命令，不手写不可维护的生成结果。

#### Test Quality

- 不接受空测试、只断言 mock 被调用的测试、无意义 snapshot；
- 不允许 `skip`、`only`、临时扩大 timeout 来掩盖问题；
- 行为变更应能从测试或明确的静态验证命令中追溯；
- implementation 阶段已经通过的测试仍可作为证据，但 verification 报告必须写明本阶段实际重跑了哪些命令。

#### Contract And Docs

- OpenSpec tasks 已全部完成并与实现一致；
- API 变更有 `contracts/openapi/` 或等价契约更新；
- 用户可见命令、流程、状态字段变更已同步到相关 docs；
- docs 描述当前系统事实，不写成临时变更流水账。

### 6. 严重度判定

使用以下严重度：

- `Critical`：安全漏洞、数据破坏、状态机错误、归档后会导致需求不可恢复的问题；
- `High`：核心功能回归、必需质量命令失败、OpenSpec 与实现不一致；
- `Medium`：局部健壮性、复杂度、测试质量、文档缺口；
- `Low`：命名、格式、可读性和非阻塞维护建议。

推进规则：

- Critical / High 必须修复或明确标为阻塞；
- Medium 可以在用户同意后留下后续项，但要说明风险；
- Low 不阻塞推进，但应写入报告。

### 7. 生成验证报告

在 `docs/verification/` 下写报告，文件名使用需求名和日期：

```text
docs/verification/<requirement-name>-verification-<YYYY-MM-DD>.md
```

报告结构：

```markdown
# <Requirement Name> 质量验证报告

## 验证范围
- Requirement:
- OpenSpec change:
- Modules:
- Verified diff:

## 命令结果
| Command | Result | Notes |
| --- | --- | --- |

## 问题清单
| Severity | Area | File | Finding | Resolution |
| --- | --- | --- | --- | --- |

## 反退化检查
- Security:
- Architecture:
- Complexity:
- Dead code:
- Test quality:
- Contract/docs:

## 结论
- Result:
- Remaining follow-ups:
```

写完后执行：

```bash
vega doc set verification_report docs/verification/<requirement-name>-verification-<YYYY-MM-DD>.md
vega doc get verification_report --json
```

### 8. 推进阶段

满足以下条件后执行：

```bash
vega complete
vega requirement status --json
vega next --json
```

完成条件：

- 验证报告已保存并登记；
- `vega verify --json` 通过；
- Full workflow 中所有模块已完成；
- 所有必需命令通过，或非本次范围的工具链缺口已明确记录且用户接受；
- 没有未解决的 Critical / High 问题；
- OpenSpec validation 通过；
- 当前阶段推进到 `archive`，下一 Skill 为 `vega-archive`。

## 失败与中断

- 发现阻塞问题但可以修复时，保持 `verification` 为 `in_progress`，修复后重跑验证。
- 发现阻塞问题且无法继续时执行：
  ```bash
  vega fail --reason "<具体原因>"
  ```
- 等待用户确认是否接受 Medium 风险或工具链缺口时，不推进阶段。
- 不因为“implementation 曾经通过测试”而跳过本阶段报告和质量检查。

## 完成标准

- 验证范围清楚，命令结果有证据；
- `vega verify --json` 通过，Full workflow 的模块状态已核对；
- 反退化审查覆盖安全、架构、复杂度、死代码、测试质量、契约和文档；
- 验证报告登记到 `documents.verification_report`；
- 无未解决的 Critical / High 问题；
- `vega complete` 已把阶段推进到 `archive`。
