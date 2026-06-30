---
name: vega-requirement-init
description: 初始化或恢复 Vega Harness 中的新需求，完成需求命名、Lite/Full 工作流选择、需求上下文落盘、状态创建与 init 阶段推进。用于用户提出“开始新需求”“初始化需求”“开发新功能”、提供 PRD/需求链接，或 `vega next --json` 返回 `vega-requirement-init` 时。此 Skill 只建立需求上下文和流程状态，不做头脑风暴、技术设计、任务拆解、编码或测试。
---

# Vega 需求初始化

把用户输入转换为一个可恢复、可路由的 Vega Harness 需求。只初始化流程，不实现需求。

## 硬性边界

- 不编写或修改业务代码、测试、OpenSpec、技术设计。
- 不创建或切换 Git 分支；当前 `vega` CLI 不管理分支。
- 不执行 `git commit`。
- 不直接编辑 `.vega-harness/requirements/*.json` 或 `.vega-harness/.active`。
- 不把需求澄清提前塞进初始化。影响方案的未知项留给 `vega-brainstorm`。

## 输入与产出

至少需要以下输入之一：

- 一段需求描述；
- 一个本地需求文档；
- 一个可读取的 PRD/需求文档 URL。

产出：

- 活跃需求 `.vega-harness/requirements/<name>.json`；
- 需求上下文 `.vega-harness/docs/prd-<name>.md`；
- `documents.prd` 指向需求上下文路径；
- `init` 阶段完成，状态推进到 `brainstorm`；
- 下一步路由结果。

## 执行流程

严格按顺序执行。需要用户选择时，每条消息只问一个问题；能从仓库和输入可靠推断的内容不要重复询问。

### 1. 检查 CLI

先执行：

```bash
vega --help
```

如果命令不可用，使用仓库 Makefile 构建并链接：

```bash
make vega-build
make vega-link
vega --help
```

仍不可用时停止，不要绕过 CLI 手改状态文件。

### 2. 收集需求来源

1. 从用户消息中提取需求描述、本地文件路径和文档 URL。
2. URL 需要认证或专用解析时，调用当前环境对应的文档 Skill；飞书/Lark 文档优先使用 `lark-doc`。不要手写未验证的下载 API。
3. 暂时无法读取文档时，说明缺失内容，并让用户在“补充文档”和“仅基于现有描述继续”之间选择。
4. 不猜测文档中不存在的目标、约束或验收标准。

### 3. 生成并确认需求名

根据标题或描述提取 2-5 个关键词，生成小写 kebab-case 名称：

- 只使用字母、数字和连字符；
- 以字母或数字开头；
- 表达业务目标，不使用 `new-feature`、`temp` 等空泛名称；
- 示例：`新增简历实时预览` → `resume-live-preview`。

向用户展示推荐名称并确认。用户已明确给出合法名称时直接采用。

执行以下命令检查重名：

```bash
vega requirement list --json
```

如果名称已存在，不要假设 `requirement init` 会覆盖或修改其 workflow：

- 用户要继续旧需求：执行 `vega requirement switch <name>`，读取状态并按当前阶段路由；
- 用户要创建新需求：让用户确认另一个名称；
- 禁止删除或覆盖已有状态文件。

### 4. 选择并确认工作流

只允许：

- `lite`：范围集中，可在一次 brainstorm 后直接进入 OpenSpec，不需要独立技术设计和模块拆解；
- `full`：跨前后端或多子系统，涉及数据模型/接口契约/架构取舍，或适合拆为并行模块。

根据需求推荐一种并说明一句理由，再让用户确认。无法判断时默认推荐 `lite`，但不要替用户静默决定。

### 5. 初始化 Harness 与需求

执行：

```bash
vega init
vega requirement init <name> --workflow <lite|full>
```

`vega init` 是幂等操作，可以重复执行。

### 6. 落盘需求上下文

始终将本次需求输入保存为：

```text
.vega-harness/docs/prd-<name>.md
```

要求：

- 用户提供 PRD 或需求文档时，保存其内容，并在文档开头记录原始来源 URL 或本地路径；
- 用户只有简短描述时，创建“需求输入快照”，原样保存用户描述并明确标注“尚未经过 brainstorm 澄清”；
- 保留原始信息，不把初始化阶段的推测写成事实；
- 下载失败且文档是继续工作的必要输入时，不完成 `init`；
- 不强行把简短描述扩写成完整 PRD，后续由 brainstorm 澄清。

简短描述使用以下最小结构：

```markdown
# <需求标题>

> 类型：需求输入快照
> 来源：用户输入
> 状态：尚未经过 brainstorm 澄清

## 原始描述

<保留用户原意的需求描述>
```

写入后通过 CLI 关联到状态文件：

```bash
vega doc set prd .vega-harness/docs/prd-<name>.md
vega doc get prd --json
```

校验 `doc get` 返回的 `path` 与写入路径一致。不要直接修改需求 JSON。

### 7. 校验并推进阶段

先执行：

```bash
vega requirement status --json
vega next --json
```

只有同时满足以下条件才完成初始化：

- 活跃需求名称正确；
- `current_phase` 为 `init`；
- 当前阶段状态为 `in_progress`；
- `vega next --json` 返回的 Skill 为 `vega-requirement-init`。

然后执行：

```bash
vega complete
vega requirement status --json
vega next --json
```

确认当前阶段已推进到 `brainstorm`，下一 Skill 为 `vega-brainstorm`。

如果需求已处于 `brainstorm` 或更后阶段，不要再次执行 `vega complete`。如果阶段状态为 `failed`，停止并遵循 `vega next --json` 的恢复路由。

## 完成标准

全部满足后才报告完成：

- 需求名称和 workflow 已经用户确认；
- 活跃需求状态可由 CLI 正常读取；
- 需求上下文已落盘；
- `documents.prd` 已通过 `vega doc set prd` 关联；
- `init` 已完成并推进到 `brainstorm`；
- 未产生业务代码、测试、设计或提交。

最终只汇报：需求名、workflow、需求上下文路径、当前阶段、下一 Skill。不要在此 Skill 中开始 brainstorm。
