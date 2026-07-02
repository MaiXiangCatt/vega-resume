---
name: vega-breakdown
description: 将 Vega Full workflow 中已批准的技术设计拆解为可并行实现的模块，生成 breakdown 文档，校验模块路径和职责边界，并通过 `vega module add` 登记模块、`vega doc set breakdown` 记录产物、完成 breakdown 阶段。用于活跃需求处于 `breakdown`、用户要求拆模块/任务拆解/并行开发规划，或 `vega next --json` 返回 `vega-breakdown` 时。此 Skill 不生成 OpenSpec、不写业务实现代码。
---

# Vega 模块拆解

`vega-breakdown` 只服务 Full workflow。它把已批准的技术设计拆成后续 OpenSpec 和实现阶段可逐个推进的模块，并把模块状态写入 Vega CLI。

## 硬性边界

- 只在 `workflow: "full"` 且当前阶段为 `breakdown` 时执行。
- 不编写业务实现代码，不新增测试，不生成 OpenSpec change。
- 不执行 `git commit`。
- 不直接编辑 `.vega-harness/requirements/*.json`；模块登记必须使用 `vega module add`。
- 不为了凑模块而拆分；每个模块必须有明确职责、路径边界和验收线索。
- 不在用户确认模块拆解前执行 `vega complete`。

## 输入与产出

输入：

- `vega requirement status --json`；
- `vega doc get prd --json`；
- `vega doc get brainstorm --json`；
- `vega doc get tech_design --json`；
- 已存在时读取 `vega doc get breakdown --json` 用于续写；
- 当前代码结构、契约目录和 Makefile 命令。

产出：

- `.vega-harness/docs/breakdown-<requirement-name>.md`；
- `documents.breakdown` 指向 breakdown 文档；
- `modules[]` 中登记一组 pending 模块；
- `breakdown` 阶段完成，状态推进到 `openspec`。

## 执行流程

为以下步骤建立任务清单并逐步更新。拆解质量比模块数量更重要。

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
- `workflow` 为 `full`；
- `current_phase` 为 `breakdown`；
- 当前阶段状态为 `in_progress`；
- 下一 Skill 为 `vega-breakdown`；
- `vega verify --json` 通过。

异常处理：

- Lite workflow：停止并说明 Lite 链路不需要模块拆解；
- 尚未进入 `breakdown`：停止并说明应先完成当前阶段；
- 当前阶段为 `failed`：遵循 `vega next --json` 的恢复路由；
- 已进入 `openspec` 或更后阶段：不要重复登记模块，除非用户明确要求修订拆解。

### 2. 读取上游产物

执行：

```bash
vega doc get prd --json
vega doc get brainstorm --json
vega doc get tech_design --json
vega doc get breakdown --json
vega module list --json
```

要求：

- `tech_design` 必须存在且可读；缺失时返回 `vega-tech-design`；
- `brainstorm` 是主要业务输入；缺失时先判断 TD 是否足够完整，否则返回 `vega-brainstorm`；
- 如果已有 breakdown 文档或模块列表，先判断是续写、修订还是复核，不要重复 `vega module add` 造成混乱；
- `vega module list --json` 只在 Full workflow 下调用。

同时检查相关目录：

- `apps/web/src/`
- `apps/server/`
- `contracts/openapi/`
- `packages/vega-cli/src/`
- `openspec/`
- `Makefile`

### 3. 识别候选模块

从 TD 的 `Breakdown 建议`、方案边界和真实代码结构中提取候选模块。优先按可并行交付边界拆分：

- 前端模块：页面/组件树、状态管理、表单/交互、生成客户端等；
- 后端模块：API endpoint 或紧密相关的 API 组、服务层、持久化、校验和错误语义；
- 契约模块：OpenAPI schema、生成配置、跨端类型同步；
- CLI / Harness 模块：命令、状态机、文档登记、验证逻辑；
- 共享基础模块：被多个模块依赖的类型、工具、基础配置，必须单独列出并排在前面。

每个模块都要定义：

- `name`：kebab-case，符合 CLI 约束：字母/数字开头，可包含字母、数字、点、下划线、短横线；
- `description`：覆盖什么，不覆盖什么；
- `affected_paths`：预计触达的目录或文件；
- `dependencies`：必须先完成的模块；
- `acceptance`：模块完成的可验证标准；
- `suggested_checks`：后续实现和验证应运行的命令；
- `size`：S / M / L。L 模块必须继续拆分，除非用户明确接受。

### 4. 校验零重叠和依赖顺序

最高优先级约束：模块之间不能竞争同一批主要代码路径。

执行校验：

- 任意两个模块不得声明同一个具体文件；
- 任意两个模块不得同时声明同一个窄目录，除非其中一个是只读上下文；
- 共享类型、工具或契约变更必须抽成独立共享模块；
- 依赖模块必须排在使用方之前；
- 每个模块都能独立写测试和验收，不能只是一串步骤。

允许的例外：

- 多个模块可以只读同一文档或 OpenSpec 产物；
- 多个模块可以依赖同一个共享模块；
- 顶层宽目录如 `apps/web/src/` 不能作为多个模块的唯一路径边界，必须细化到更窄路径。

发现重叠时，先调整边界；调整不了就合并模块或抽共享模块。不要把有冲突的拆解交给后续阶段。

### 5. 用户确认模块拆解

向用户展示模块表，至少包含：

```text
模块名 | 职责 | 预计路径 | 依赖 | Size | 验收线索
```

明确说明：

- 哪些模块可并行；
- 哪些模块必须串行；
- 哪些路径有潜在冲突以及如何规避；
- 是否有被压缩或延期的范围。

用户要求调整时，更新拆解并重新执行零重叠校验。只有用户明确批准后，才写入最终文档和登记模块。

### 6. 写入 breakdown 文档

写入：

```text
.vega-harness/docs/breakdown-<requirement-name>.md
```

结构：

```markdown
# <Requirement Name> 模块拆解

## 输入产物
## 拆解原则
## 模块总览
## 模块详情
### <module-name>
- Description:
- Scope:
- Non-goals:
- Affected paths:
- Dependencies:
- Acceptance:
- Suggested checks:
- Size:

## 并行计划
## 路径重叠校验
## 风险与开放项
```

要求：

- 模块名必须与后续 `vega module add` 使用的名称一致；
- 每个模块至少有一个明确路径或契约产物；
- 每个模块都能映射回 TD 的方案章节；
- `路径重叠校验` 要列出所有模块对之间的结论；
- 不写具体实现任务细节，TDD tasks 留给 `vega-openspec`。

### 7. 登记文档和模块

先登记文档：

```bash
vega doc set breakdown .vega-harness/docs/breakdown-<requirement-name>.md
vega doc get breakdown --json
```

然后按用户批准的顺序逐个登记模块：

```bash
vega module add <module-name>
vega module list --json
```

规则：

- `vega module add` 是幂等的；已有同名模块时不会重复创建，但仍要核对状态；
- 如果已有模块列表与新文档不一致，先停下来让用户确认是保留、追加还是重新规划。当前 CLI 没有删除或重命名模块命令，不能手改状态文件；
- 不登记临时模块、占位模块或未获批准的模块。

### 8. 推进阶段

满足以下条件后执行：

```bash
vega verify --json
vega complete
vega requirement status --json
vega next --json
```

验证：

- `documents.breakdown` 指向 breakdown 文档；
- `modules[]` 非空，且所有新模块状态为 `pending`；
- 当前阶段推进到 `openspec`；
- 下一 Skill 为 `vega-openspec`。

## 失败与中断

- 等待用户确认模块拆解时，保持 `breakdown` 为 `in_progress`。
- 模块路径无法做到低冲突、TD 输入不足、现有模块状态与新拆解冲突时，不推进阶段。
- 已确认阻塞且无法继续时执行：
  ```bash
  vega fail --reason "<具体原因>"
  ```

## 完成标准

- breakdown 文档已写入并登记；
- 模块职责、路径边界、依赖和验收线索清楚；
- 模块之间已完成路径重叠校验；
- 用户已批准拆解；
- 所有批准模块已通过 `vega module add` 登记；
- 未写实现代码、未生成 OpenSpec；
- `vega complete` 已把阶段推进到 `openspec`。
