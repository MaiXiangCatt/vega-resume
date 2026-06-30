---
name: vega-experience
description: 处理 Vega workflow 的失败态和复盘沉淀：当 `vega next --json` 返回 `vega-experience`、当前阶段为 failed、用户执行过 `vega fail`、CI/lint/test/build/OpenSpec 失败，或用户要求沉淀经验/失败复盘时使用。负责提取根因、修复或规划修复、写入 `docs/experiences`，必要时更新规则文档，然后通过 `vega retry` 恢复原阶段。
---

# Vega Experience

`vega-experience` 是失败闭环 Skill。它把失败日志、阶段上下文和修复结论沉淀为仓库长期经验，避免同类问题反复发生。

当前 Vega CLI 的失败模型很简单：`vega fail --reason "<原因>"` 会把当前 phase 标记为 `failed`；`vega next --json` 会把任意 failed phase 路由到 `vega-experience`；修复后只能通过 `vega retry` 把同一 phase 恢复为 `in_progress`。

## 硬性边界

- 不直接编辑 `.vega-harness/requirements/*.json`。
- 不在没有根因判断时执行 `vega retry`。
- 不用 `vega complete` 跳过失败阶段；experience 只能恢复原阶段，不能完成原阶段。
- 不把一次性环境噪音写进长期规则；只有可复用、可验证、会重复影响后续任务的经验才沉淀。
- 不执行 `git commit`。
- 不为了“修复失败”扩大需求范围；只做解除当前失败所需的最小改动。

## 输入与产出

输入：

- `vega requirement status --json`；
- `vega next --json`；
- 当前 phase 的 `failed_reason`；
- 用户提供的 CI、lint、test、build、OpenSpec 或运行日志；
- 已登记的 PRD、brainstorm、tech design、OpenSpec、verification report；
- `git status --short` 和相关 diff。

产出：

- `docs/experiences/<YYYY-MM-DD>-<requirement>-<phase>-<slug>.md`；
- `documents.experience_report` 指向经验文档；
- 必要的代码、测试、配置、OpenSpec 或文档修复；
- 必要时更新 `AGENTS.md`、`CLAUDE.md`、相关 `docs/` 或 Skill；
- `vega retry` 后当前 phase 恢复为 `in_progress`，下一步回到原 phase Skill。

## 执行流程

为以下步骤建立任务清单并逐步更新。失败处理应先定位、再修复、再沉淀、最后重试。

### 1. 恢复失败上下文

执行：

```bash
vega requirement status --json
vega next --json
git status --short
git log -n 5 --oneline
```

继续条件：

- 当前需求存在；
- 若当前 phase 为 `failed`，`vega next --json` 的 `skill` 应为 `vega-experience`；
- 读取 `phases[current_phase].failed_reason`，如果为空，从用户消息和最近命令输出提取失败线索。

如果当前 phase 不是 failed：

- 用户只是要求复盘：可以写经验文档，但不要执行 `vega retry`；
- 用户要求处理 CI 失败但状态未 failed：先确认是否需要执行 `vega fail --reason "<原因>"`；没有用户确认时不要改状态。

### 2. 读取关联产物

执行并读取非空路径：

```bash
vega doc get prd --json
vega doc get brainstorm --json
vega doc get tech_design --json
vega doc get openspec_dir --json
vega doc get verification_report --json
```

按失败阶段补充读取：

- `openspec` / `implementation` / `verification` / `archive`：读取 `openspec_dir` 下的 `proposal.md`、`design.md`、`tasks.md`、`specs/**/spec.md`；
- `verification`：读取验证报告；
- `archive`：读取 OpenSpec 归档相关输出和主 specs；
- `init` / `brainstorm` / `tech_design` / `breakdown`：读取前置 PRD 和设计产物。

缺少关键产物时，不要猜测；将“缺少产物登记或文件不存在”本身作为候选根因。

### 3. 收集失败证据

优先使用用户提供的原始日志。如果日志不足，按阶段补跑最小复现命令。

常见命令：

```bash
make test-cli
make lint-cli
make build-cli
make test-web
make lint-web
make build-web
make test-server
make lint-server
make build-server
make spec-check
openspec validate <change-name> --strict --json
openspec validate --all --strict --json
```

选择原则：

- 只补跑与失败阶段相关的最小命令；
- 不为了复现而运行破坏性命令；
- OpenSpec 命令可能打印 PostHog / 网络遥测错误。只要命令退出码为 0 且 JSON 主体有效，不把遥测失败当作根因；
- 如果失败来自网络、依赖下载或本地工具缺失，按工具链问题记录，不伪装成业务失败。

### 4. 分类根因

将失败归入一个主类，并可记录次要因素：

| 类型 | 判断标准 | 典型处理 |
| --- | --- | --- |
| 需求/规约缺口 | PRD、OpenSpec、tasks 无法支撑实现判断 | 修订 OpenSpec 或返回前置阶段 |
| 实现缺陷 | 测试、lint、构建或运行行为证明代码错误 | 最小代码修复并补验证 |
| 测试缺陷 | 测试断言不合理、只测 mock、与 spec 冲突 | 修测试并解释为何不是削弱覆盖 |
| 契约不一致 | OpenAPI、生成物、前后端模型不一致 | 更新契约，运行 `make spec-check` / `make generate` |
| 流程误用 | 阶段跳过、产物未登记、错误使用 CLI | 修状态关联或回到正确 Skill |
| 工具链缺口 | 脚本未配置、依赖缺失、环境不可用 | 记录配置修复或阻塞条件 |
| Flaky / 外部不稳定 | 重跑可过、受外部系统影响 | 增加隔离、重试策略或稳定性记录 |

根因必须有证据：命令输出、文件引用、diff、OpenSpec 片段或用户日志。没有证据时不要写成结论。

### 5. 修复或制定恢复计划

如果根因可在当前仓库内安全修复：

1. 做最小改动；
2. 运行失败复现命令；
3. 运行受影响范围的验证命令；
4. 确认问题不再复现。

如果根因需要用户决策或外部系统：

1. 写清阻塞原因；
2. 写清需要用户提供的输入或外部动作；
3. 不执行 `vega retry`。

如果根因说明当前 OpenSpec 或 PRD 错误：

- 不直接在 implementation 中硬改需求；
- 修改对应 OpenSpec / docs 后重新验证；
- 必要时保持当前阶段 failed，等待用户确认需求变更。

### 6. 写经验文档

在 `docs/experiences/` 下创建经验文档：

```text
docs/experiences/<YYYY-MM-DD>-<requirement>-<phase>-<slug>.md
```

模板：

```markdown
# <Requirement> / <Phase> 失败复盘

## 背景
- Requirement:
- Phase:
- Failed reason:
- Date:

## 现象
- 原始日志或错误摘要：
- 复现命令：

## 根因
- 类型：
- 证据：

## 修复
- 改动：
- 验证命令：

## 经验规则
- 后续遇到什么信号时应如何处理：
- 是否需要更新 AGENTS / docs / Skill：

## Retry 决策
- 是否执行 `vega retry`：
- 下一步 Skill：
```

写完后登记：

```bash
vega doc set experience_report docs/experiences/<YYYY-MM-DD>-<requirement>-<phase>-<slug>.md
vega doc get experience_report --json
```

### 7. 更新长期规则

只有满足以下任一条件才更新长期规则：

- 同类问题已重复出现；
- 根因是流程约束缺失；
- 后续 agent 很可能在相同位置犯错；
- 修复方式稳定、可复用、不会误导其他任务。

可更新位置：

- `AGENTS.md`：仓库级工作规则、命令约束、危险操作；
- `CLAUDE.md`：Claude 专属协作约束；
- `docs/designAndPrd/`：设计事实或 CLI 设计变更；
- `docs/decisions/`：架构取舍；
- 对应 `skills/vega-*/SKILL.md`：阶段流程需要稳定修订时。

不要把一次性命令输出、临时环境问题、个人偏好写入长期规则。

### 8. 恢复原阶段

只有同时满足以下条件才执行：

- 当前 phase 仍为 failed；
- 根因已定位；
- 可修复问题已经修复并验证，或已经明确应交回原阶段 Skill 继续处理；
- 经验文档已写入并通过 `vega doc set experience_report` 登记；
- 没有等待用户决策的阻塞项。

执行：

```bash
vega retry
vega next --json
vega requirement status --json
```

验证：

- 当前 phase 仍是原失败 phase；
- phase 状态恢复为 `in_progress`；
- `vega next --json` 返回原阶段 Skill，不再返回 `vega-experience`。

如果用户要求“修复并继续”，在 `vega retry` 后按照 `vega next --json` 路由到原阶段 Skill；否则输出恢复摘要，让用户选择是否继续。

## 失败与中断

- 证据不足：要求用户提供原始日志或允许补跑最小复现命令。
- 修复超出当前需求范围：停止并说明需要新需求或用户确认。
- 工具链不可用：记录环境阻塞，不执行 `vega retry`。
- 经验文档无法写入：先修复路径或权限，不跳过沉淀。
- `vega retry` 失败：读取错误，保持 failed 状态，不直接改 JSON。

## 完成标准

- 已明确失败现象、根因类型和证据；
- 已完成必要修复或清楚记录阻塞；
- 已写入 `docs/experiences/` 并登记 `documents.experience_report`；
- 必要的长期规则已最小更新；
- 若可恢复，`vega retry` 已让原 phase 回到 `in_progress`；
- 最终摘要包含下一步 Skill。
