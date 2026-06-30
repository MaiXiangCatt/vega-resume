---
name: vega-archive
description: 在 Vega 需求通过 verification 后执行最终归档：同步 OpenSpec 主 specs 和长期文档，归档 OpenSpec change，并用 `vega archive` 标记需求完成。用于活跃需求处于 `archive`、用户要求归档/关闭/完成需求，或 `vega next --json` 返回 `vega-archive` 时。
---

# Vega 归档

归档阶段负责把已经验证通过的需求收口为长期可维护状态：OpenSpec delta 进入主 specs，用户文档和仓库知识反映当前事实，OpenSpec change 被归档，Vega 需求状态被关闭。

当前 Vega CLI 的 `vega archive` 只负责在 `archive` 阶段标记需求完成，不负责移动 OpenSpec 目录或同步文档。因此本 Skill 必须先完成 OpenSpec 与文档收尾，再执行 `vega archive`。

## 硬性边界

- 不执行 `git commit`。
- 不新增业务实现，不在归档阶段补做未完成需求。
- 不跳过 verification 报告；没有质量验证证据不归档。
- 不直接编辑 `.vega-harness/requirements/*.json`；状态关闭只使用 `vega archive`。
- 不手工移动 OpenSpec change 来替代 `openspec archive`，除非 OpenSpec CLI 不可用且用户明确批准。
- 不删除历史文档或既有 specs；只做必要同步、合并和纠偏。

## 输入与产出

输入：

- `vega requirement status --json`；
- `vega next --json`；
- `vega doc get openspec_dir --json`；
- `vega doc get verification_report --json`；
- PRD、brainstorm、tech design，如果已登记；
- OpenSpec change 目录；
- verification 报告和当前 `git diff`。

产出：

- OpenSpec 主 specs 已同步；
- OpenSpec change 已归档到 OpenSpec archive 区域；
- 必要的 `docs/`、`AGENTS.md`、`CLAUDE.md` 或其他长期文档已同步；
- `documents.openspec_dir` 指向归档后的 OpenSpec 路径；
- `vega archive` 已把需求标记为完成。

## 执行流程

为以下步骤建立任务清单并逐步更新。归档是最终收口动作，任何未完成实现、未解决 High 风险或不可解释的验证失败都应阻塞归档。

### 1. 恢复 Vega 上下文

执行：

```bash
vega requirement status --json
vega next --json
git status --short
git log -n 5 --oneline
```

只有同时满足以下条件才继续：

- 需求 `status` 为 `in_progress`；
- `current_phase` 为 `archive`；
- 当前阶段状态为 `in_progress`；
- 下一 Skill 为 `vega-archive`。

异常处理：

- 尚未进入 `archive`：停止并说明应先完成当前阶段；
- 当前阶段为 `failed`：遵循 `vega next --json` 的恢复路由；
- 没有活跃需求：停止并使用 `vega-requirement-init`；
- 需求已经 completed：只报告现状，不重复归档。

### 2. 检查归档前置条件

执行：

```bash
vega doc get openspec_dir --json
vega doc get verification_report --json
```

要求：

- `openspec_dir` 存在且指向未归档的 OpenSpec change；
- `verification_report` 存在，文件可读取；
- verification 报告没有未解决的 Critical / High 问题；
- 若报告中有 Medium 风险或工具链缺口，必须确认用户已接受或已经修复。

从 `openspec_dir` 推导 `<change-name>`，然后执行：

```bash
openspec validate <change-name> --strict --json
openspec status --change <change-name> --json
```

要求：

- OpenSpec strict validation 通过；
- `tasks.md` 不存在未完成的 `- [ ]`；
- OpenSpec 命令可能打印 PostHog / 网络遥测错误。只要退出码为 0 且 JSON 主体有效，不把遥测失败当作流程失败。

### 3. 盘点需要同步的长期事实

读取并对照：

- `<openspec_dir>/proposal.md`
- `<openspec_dir>/design.md`
- `<openspec_dir>/tasks.md`
- `<openspec_dir>/specs/**/spec.md`
- verification 报告；
- `git diff --name-only`、`git diff --cached --name-only`、未跟踪文件。

判断是否需要同步：

- OpenSpec 主 specs：任何 `openspec_dir/specs/**/spec.md` 的能力变更都需要进入主 specs；
- 用户文档：CLI 命令、工作流、配置、架构边界、运行方式有变化时更新 `docs/`；
- 仓库协作说明：影响 agent 工作方式、Makefile 命令、项目结构时更新 `AGENTS.md` 或 `CLAUDE.md`；
- 契约文档：API 或生成流程改变时同步 `contracts/` 相关说明。

文档原则：

- 写当前系统事实，不写“本次新增了什么”的流水账；
- 保留已有正确内容，只补充、纠偏或替换过时段落；
- 不能确定的事实不要写入长期文档，先问用户或保留为后续项。

### 4. 同步 OpenSpec 主 specs

优先使用 OpenSpec CLI 完成 specs 同步和归档准备：

```bash
openspec archive <change-name> -y
```

该命令会归档已完成 change 并更新主 specs。执行前必须已经完成第 2、3 步的检查。

如果当前 change 属于纯工具、文档或流程调整，且没有 `specs/**/spec.md` 需要进入主 specs，可以使用：

```bash
openspec archive <change-name> -y --skip-specs
```

只有在以下情况下才考虑手工处理：

- `openspec archive` 不可用；
- CLI 归档失败且错误明确指向可手工修复的文档冲突；
- 用户明确批准手工归档方案。

手工处理时必须：

- 对每个 `openspec/changes/<change-name>/specs/<capability>/spec.md` 合并到 `openspec/specs/<capability>/spec.md`；
- 保留既有 Requirement 和 Scenario；
- 只删除已经被新 spec 明确替代的过时内容；
- 归档目录使用 `openspec/changes/archive/<YYYY-MM-DD>-<change-name>/`；
- 完成后运行 `openspec validate --all --strict --json`。

### 5. 同步长期文档

根据第 3 步盘点结果更新必要文档。优先更新已有文档，不为了归档而创建空泛新文档。

常见同步点：

- 新增或修改 CLI 命令：更新相关 `docs/` 和 agent 指南；
- Makefile 目标变化：更新 `AGENTS.md` / `CLAUDE.md` 中的命令说明；
- OpenSpec 或 Vega workflow 变化：更新流程文档和对应 Skill；
- API 契约变化：更新契约说明和生成流程；
- 用户可见 UI / 服务行为变化：更新产品或使用说明。

同步后运行必要检查：

```bash
openspec validate --all --strict --json
make build-cli
```

如果文档同步涉及前端、后端或契约，再按影响面补充：

```bash
make build-web
make build-server
make spec-check
```

### 6. 重新登记归档路径

`openspec archive` 完成后，定位归档后的 change 目录。通常路径为：

```text
openspec/changes/archive/<YYYY-MM-DD>-<change-name>
```

执行：

```bash
vega doc set openspec_dir openspec/changes/archive/<YYYY-MM-DD>-<change-name>
vega doc get openspec_dir --json
```

如果 OpenSpec CLI 使用了不同归档路径，以实际存在路径为准。必须保证 `documents.openspec_dir` 指向可读取的归档产物，而不是已经不存在的旧 change 目录。

### 7. 关闭 Vega 需求

完成所有同步后执行：

```bash
vega archive
vega requirement status --json
vega next --json
```

验证：

- 需求 `status` 为 `completed`；
- 所有 phases 均为 `completed`；
- `vega next --json` 返回已完成状态，而不是新的 Skill 路由；
- 工作区没有未解释的临时文件。

### 8. 输出归档摘要

向用户报告：

- 归档的需求名称；
- OpenSpec 原目录和归档目录；
- 同步过的主 specs；
- 更新过的长期文档；
- 归档前最后运行的命令和结果；
- 未阻塞归档但需要后续跟踪的事项。

## 失败与中断

- verification 报告缺失或存在未解决 Critical / High：停止，不执行 `vega archive`。
- OpenSpec validation 失败：修复 specs / change 后重跑，不跳过 strict validation。
- `openspec archive` 失败：先根据错误修复；不可修复时询问用户是否允许手工归档。
- 文档事实不清楚：保持 archive 为 `in_progress`，询问用户，不写猜测内容。
- 已确认阻塞且无法继续时执行：
  ```bash
  vega fail --reason "<具体原因>"
  ```

## 完成标准

- verification 报告存在且无未解决 Critical / High；
- OpenSpec change 已通过 CLI 或批准的手工流程归档；
- 主 specs 与长期文档反映当前系统事实；
- `documents.openspec_dir` 指向归档后的 OpenSpec 目录；
- `vega archive` 已把需求标记为 `completed`；
- 未执行 git commit，未丢弃用户无关改动。
