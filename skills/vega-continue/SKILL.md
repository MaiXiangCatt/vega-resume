---
name: vega-continue
description: 恢复并继续当前 Vega 需求流程：从 `vega requirement status --json` 和 `vega next --json` 重建上下文，读取已登记产物，按当前阶段或失败态路由到对应 Skill。用于用户说“继续”“下一步”“恢复中断任务”“推进当前需求”，或任意阶段完成后需要自动判断下一步时。
---

# Vega Continue

`vega-continue` 是 Vega workflow 的调度 Skill。它不替代具体阶段 Skill，而是把跨 Session 的状态恢复、产物检查和下一步路由收敛到一个入口。

当前 CLI 已实现 `requirement status/current/list/switch/init`、`next`、`complete`、`archive`、`fail`、`retry`、`doc set/get`。设计文档中的 `transition`、`verify`、`module` 系列命令尚未落地；本 Skill 不要求使用这些未实现命令。

## 硬性边界

- 只以 `vega` CLI 状态为事实源，不依赖聊天记忆判断阶段。
- 不直接编辑 `.vega-harness/requirements/*.json`。
- 不自己完成业务阶段；具体阶段由 `vega-requirement-init`、`vega-brainstorm`、`vega-openspec` 等 Skill 执行并推进。
- 不在 failed 阶段调用原阶段 Skill；必须先进入 `vega-experience`。
- 不在缺少关键产物时编造路径；要让用户补充、回到产出该产物的阶段，或明确阻塞。
- 不执行 `git commit`。

## 路由表

`vega next --json` 是最终路由事实源。常规映射如下：

| Phase | Skill |
| --- | --- |
| `init` | `vega-requirement-init` |
| `brainstorm` | `vega-brainstorm` |
| `tech_design` | `vega-tech-design` |
| `breakdown` | `vega-breakdown` |
| `openspec` | `vega-openspec` |
| `implementation` | `vega-implementation` |
| `verification` | `vega-verification` |
| `archive` | `vega-archive` |
| 任意 failed phase | `vega-experience` |
| completed requirement | 无需继续 |

如果 `vega next --json` 返回的 Skill 在当前环境中不可用，先检查本仓库 `skills/<skill>/SKILL.md` 是否存在；仍不存在时停止并报告缺失，不要用相近 Skill 代替。

## 执行流程

为以下步骤建立任务清单并逐步更新。`continue` 的目标是把 agent 放回正确阶段，而不是尽快跳过阶段。

### 1. 确认仓库根目录

执行：

```bash
git rev-parse --show-toplevel
```

如果当前目录不是仓库根目录，切换到输出路径后再继续。后续所有命令都从仓库根执行。

### 2. 重建上下文

先执行且只用这些命令恢复基础上下文：

```bash
vega requirement status --json
vega next --json
git log -n 5 --oneline
git status --short
```

解析：

- 活跃需求名称；
- workflow：`lite` 或 `full`；
- `current_phase`；
- 当前 phase 状态；
- `documents` 中已登记的路径；
- `vega next --json` 返回的 `skill` 和 `done`。

异常处理：

- 没有活跃需求：停止并提示先使用 `vega-requirement-init` 创建或切换需求。
- 状态文件损坏或缺少当前 phase：停止，不直接修 JSON。
- `done: true`：报告需求已完成，不再推进。

### 3. 读取已登记产物

优先从 `vega requirement status --json` 的 `documents` 字段读取路径；也可以用以下命令补查：

```bash
vega doc get prd --json
vega doc get brainstorm --json
vega doc get tech_design --json
vega doc get openspec_dir --json
vega doc get verification_report --json
vega doc get experience_report --json
```

只读取非空且存在的本地路径。远程 URL 或不存在的本地路径不能当成已验证产物。

按阶段检查最低产物：

| Current phase | 最低上下文 |
| --- | --- |
| `init` | 用户原始需求或 PRD；缺失时交给 `vega-requirement-init` |
| `brainstorm` | `prd` |
| `tech_design` | `prd`、`brainstorm` |
| `breakdown` | `prd`、`brainstorm`、`tech_design` |
| `openspec` | `prd`、`brainstorm`，full workflow 还应有 `tech_design` |
| `implementation` | `openspec_dir` |
| `verification` | `openspec_dir` |
| `archive` | `openspec_dir`、`verification_report` |
| failed phase | `failed_reason`、相关阶段产物，交给 `vega-experience` |

如果关键产物缺失：

1. 判断哪个前置 Skill 应产生该产物；
2. 如果当前阶段正是产物生产阶段，让该阶段 Skill 继续；
3. 如果已经越过产物生产阶段，询问用户是否补登记路径，或返回前置 Skill 修正；
4. 不用 `vega complete` 越过缺失产物。

### 4. 处理失败态

如果 `vega next --json` 返回：

```json
{ "status": "failed", "skill": "vega-experience" }
```

则立即进入 `vega-experience`，并把以下信息作为输入：

- 当前需求和 phase；
- `phases[current_phase].failed_reason`；
- 最近 git 日志和工作区状态；
- 已登记产物路径；
- 用户在本轮消息里提供的失败日志。

不要先执行 `vega retry`。`retry` 必须由 `vega-experience` 在完成复盘、必要修复和经验沉淀后执行。

### 5. 路由到当前阶段 Skill

如果状态为 `in_progress`，按 `vega next --json` 的 `skill` 执行对应 Skill。

执行方式：

- 如果当前会话的 Skill 列表中有该 Skill，使用该 Skill。
- 如果 Skill 列表没有但本仓库存在 `skills/<skill>/SKILL.md`，读取该文件并按其说明执行。
- 如果本仓库也没有该 Skill，停止并报告需要先创建对应 Skill。

不要手工调用另一个阶段的 Skill。`vega next --json` 已经包含 workflow 分支，例如 Lite 的 `brainstorm -> openspec` 和 Full 的 `brainstorm -> tech_design`。

### 6. 阶段执行后的收尾

被路由 Skill 完成后，重新执行：

```bash
vega requirement status --json
vega next --json
git status --short
```

输出简短进度摘要：

```text
需求：<name> (<workflow>)
当前阶段：<phase> / <status>
下一步：<skill 或 done>
关键产物：prd=<...>, brainstorm=<...>, openspec_dir=<...>, verification_report=<...>
工作区：<clean 或列出需要用户关注的改动>
```

如果被路由 Skill 暂停等待用户确认，不要额外推进阶段；只报告暂停点和下一步需要用户确认的内容。

## 常见场景

### 用户说“继续”

执行上下文重建，读取 `vega next --json`，直接进入返回的 Skill。

### 用户说“下一步是什么”

只运行状态和路由命令，输出下一步摘要；不要自动执行阶段 Skill，除非用户明确要求继续执行。

### 中断后恢复

先读取状态和已登记产物，不要假设上次做到哪一步。目标阶段 Skill 会根据自己的产物和任务清单恢复。

### 失败后继续

如果当前 phase 是 failed，进入 `vega-experience`。等 experience 执行 `vega retry` 后，再通过 `vega next --json` 回到原阶段 Skill。

## 完成标准

- 已从 CLI 状态恢复上下文；
- 已读取或检查当前阶段必需产物；
- 已根据 `vega next --json` 路由到正确 Skill，或清楚报告阻塞；
- 没有跳过 failed 阶段、没有手工改状态文件；
- 结束前输出当前需求进度摘要。
