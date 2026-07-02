---
name: vega-tech-design
description: 为 Vega Full workflow 需求生成技术设计文档：基于 PRD、brainstorm、代码结构和仓库约束完成技术方案、接口/数据/组件边界、风险和验证策略，并通过 `vega doc set tech_design` 登记产物、完成 tech_design 阶段。用于活跃需求处于 `tech_design`、用户要求写技术设计/TD/技术方案/API 或前后端设计，或 `vega next --json` 返回 `vega-tech-design` 时。此 Skill 不写实现代码、不拆模块。
---

# Vega 技术设计

`vega-tech-design` 只服务 Full workflow。它把已批准的 brainstorm 设计转成可执行的技术方案，为后续 `vega-breakdown` 和 `vega-openspec` 提供稳定输入。

## 硬性边界

- 只在 `workflow: "full"` 且当前阶段为 `tech_design` 时执行。
- 不编写业务实现代码，不新增测试，不修改 OpenSpec change。
- 不执行 `git commit`。
- 不直接编辑 `.vega-harness/requirements/*.json`；产物登记必须使用 `vega doc set/get`。
- 不把未经确认的接口、数据结构、架构取舍写成事实；关键技术歧义先问用户。
- 不在技术设计未自检、未获用户批准前执行 `vega complete`。

## 输入与产出

输入：

- `vega requirement status --json` 的活跃需求状态；
- `vega doc get prd --json`；
- `vega doc get brainstorm --json`；
- 已存在时读取 `vega doc get tech_design --json` 用于续写；
- 相关代码结构、`contracts/openapi/`、`apps/web/`、`apps/server/`、`packages/vega-cli/`、`Makefile` 和项目文档。

产出：

- `.vega-harness/docs/tech-design-<requirement-name>.md`；
- `documents.tech_design` 指向该技术设计文档；
- `tech_design` 阶段完成，状态推进到 `breakdown`。

## 执行流程

为以下步骤建立任务清单并逐步更新。等待用户确认时不要推进阶段。

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
- `current_phase` 为 `tech_design`；
- 当前阶段状态为 `in_progress`；
- 下一 Skill 为 `vega-tech-design`；
- `vega verify --json` 通过。

异常处理：

- Lite workflow：停止并说明 Lite 链路会从 brainstorm 直接进入 OpenSpec；
- 尚未进入 `tech_design`：停止并说明应先完成当前阶段；
- 当前阶段为 `failed`：遵循 `vega next --json` 的恢复路由；
- 已进入 `breakdown` 或更后阶段：不要重复生成或倒退，除非用户明确要求修订 TD。

### 2. 读取上游产物和代码边界

执行：

```bash
vega doc get prd --json
vega doc get brainstorm --json
vega doc get tech_design --json
```

读取非空且存在的本地路径。缺少 `brainstorm` 时停止并返回 `vega-brainstorm`；缺少 `prd` 时可以基于 brainstorm 继续，但必须在 TD 中说明 PRD 来源缺失。

同时检查：

- `apps/web/src/`：前端入口、组件边界、状态管理和已有页面；
- `apps/server/`：Go API 入口、路由、服务层和独立 Go module 约束；
- `contracts/openapi/`：跨端契约是否需要变更；
- `packages/vega-cli/src/`：如果需求涉及 harness/CLI；
- `Makefile`：后续应使用的 lint/test/build/generate/spec-check 命令；
- `openspec/config.yaml`：确认后续 OpenSpec 产物的 schema 背景。

如果已有 TD 文档，先读取并判断是续写、修订还是重新生成。不要无条件覆盖已批准内容。

### 3. 判定技术设计类型和深度

根据需求影响面选择设计深度：

- 前端为主：重点写组件结构、状态流、交互边界、可访问性、前端测试和构建影响；
- 后端为主：重点写 API、数据模型、错误语义、并发/幂等、安全和 Go 服务边界；
- 跨栈：必须写契约优先策略，说明 OpenAPI 变更、生成物、前后端集成路径；
- CLI / Harness：必须写状态机、命令语义、JSON 输出、错误处理和兼容性。

不要套用与需求无关的模板章节。每个保留章节都要有具体结论或明确开放项。

### 4. 分析方案并确认关键取舍

基于上游设计和代码事实，形成 2-3 个技术方案，至少比较：

- 与现有架构的契合度；
- 改动范围和回滚成本；
- 契约、数据和状态迁移风险；
- 测试和验证成本；
- 是否利于后续模块拆解和并行实施。

先给推荐方案和理由。若方案选择会显著影响接口、数据结构、模块边界或长期维护成本，先向用户确认再写入最终 TD。

### 5. 写入技术设计文档

写入：

```text
.vega-harness/docs/tech-design-<requirement-name>.md
```

建议结构：

```markdown
# <Requirement Name> 技术设计

## 背景与输入
## 现有架构与约束
## 技术目标与非目标
## 方案比较与最终选择
## 总体架构
## 前端设计
## 后端设计
## CLI / Harness 影响
## API、数据与契约
## 状态、错误和边界情况
## 安全、性能与兼容性
## 测试与验证策略
## Breakdown 建议
## 风险、依赖与开放项
## 决策记录
```

写作要求：

- 只保留相关章节，不相关章节写“无影响”或删除；
- 引用真实文件路径、命令和类型名，不写泛泛描述；
- API 变更必须指向 `contracts/openapi/` 或说明无需契约变更；
- `Breakdown 建议` 要给出候选模块、依赖顺序和路径边界，但不调用 `vega module add`；
- 测试策略要列出后续阶段应运行的精确 Makefile 目标；
- 开放项必须说明阻塞程度和解决阶段。

### 6. 质量门禁

写完后自检并修复：

- 无 `TODO`、`TBD`、占位符和互相矛盾的章节；
- 每个关键技术决策都有备选方案或取舍理由；
- 涉及代码的描述能对应到真实路径；
- 契约、数据、状态和错误语义有明确结论；
- 后续 `vega-breakdown` 能从 `Breakdown 建议` 拆出可并行模块；
- 后续 `vega-openspec` 能据此生成 proposal/spec/design/tasks。

如果发现需求仍然停留在业务澄清层面，停止并返回 `vega-brainstorm`，不要用 TD 弥补未确认需求。

### 7. 用户审查关卡

向用户报告 TD 路径和关键技术取舍，请用户审查。用户要求修改时，修订文档后重新执行质量门禁。

只有用户明确批准技术设计后，才进入阶段完成。

### 8. 登记产物并推进阶段

执行：

```bash
vega doc set tech_design .vega-harness/docs/tech-design-<requirement-name>.md
vega doc get tech_design --json
vega complete
vega requirement status --json
vega next --json
```

验证：

- `documents.tech_design` 指向刚写入的 TD；
- 当前阶段推进到 `breakdown`；
- 下一 Skill 为 `vega-breakdown`。

## 失败与中断

- 等待用户技术取舍或审查时，保持 `tech_design` 为 `in_progress`。
- 状态损坏、上游 brainstorm 缺失、关键技术输入无法获得时，不推进阶段。
- 已确认阻塞且无法继续时执行：
  ```bash
  vega fail --reason "<具体原因>"
  ```

## 完成标准

- TD 文档已基于真实 PRD、brainstorm 和代码结构生成；
- 关键技术取舍、契约影响、测试策略和拆解建议清楚；
- 用户已批准 TD；
- `documents.tech_design` 已登记；
- 未写业务实现代码、未创建 OpenSpec change、未登记模块；
- `vega complete` 已把阶段推进到 `breakdown`。
