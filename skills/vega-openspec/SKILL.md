---
name: vega-openspec
description: 将已经确认的 Vega 需求设计转成 OpenSpec spec-driven change，生成 proposal、specs、design、tasks 等实现前规约产物，并通过 `vega doc set openspec_dir` 记录产物目录、完成 openspec 阶段。用于活跃需求处于 `openspec`、用户要求生成 OpenSpec/规约/任务/契约变更，或 `vega next --json` 返回 `vega-openspec` 时。此 Skill 不写业务实现代码。
---

# Vega OpenSpec 生成

把 brainstorm / tech design 中已经确认的需求，转成可实施的 OpenSpec change。当前 Vega CLI 尚无模块级状态命令，因此本 Skill 按“一个活跃需求对应一个主 OpenSpec change”执行；后续如果补齐 `vega module` 能力，再扩展为多模块逐个生成。

## 硬性边界

- 不编写业务实现代码，不新增生产逻辑，不修改测试来适配未来实现。
- 不执行 `git commit`。
- 不直接编辑 `.vega-harness/requirements/*.json`；所有文档关联通过 `vega doc set/get`。
- 不在 OpenSpec 规约未验证、未获用户批准前执行 `vega complete`。
- 不把缺失的需求、接口、验收规则猜成事实；关键歧义先问用户。

## 输入与产出

输入：

- `vega requirement status --json` 的活跃需求状态；
- `vega doc get prd --json`；
- `vega doc get brainstorm --json`；
- Full workflow 还应读取 `vega doc get tech_design --json`，如果已存在；
- 相关代码结构、OpenAPI 契约目录和项目约束。

产出：

- `openspec/changes/<change-name>/`；
- 至少包含 `proposal.md`、`design.md`、`tasks.md`、`specs/<capability>/spec.md`；
- `documents.openspec_dir` 指向该 change 目录；
- `openspec` 阶段完成，状态推进到 `implementation`。

## 执行流程

为以下步骤建立任务清单并逐步更新状态。不要把等待用户确认的关卡标记为完成。

### 1. 恢复 Vega 上下文

执行：

```bash
vega requirement status --json
vega next --json
git log -n 5 --oneline
```

只有同时满足以下条件才继续：

- 需求 `status` 为 `in_progress`；
- `current_phase` 为 `openspec`；
- 当前阶段状态为 `in_progress`；
- 下一 Skill 为 `vega-openspec`。

异常处理：

- 没有活跃需求：停止并使用 `vega-requirement-init`；
- 尚未进入 `openspec`：停止并说明应先完成当前阶段；
- 当前阶段为 `failed`：遵循 `vega next --json` 的恢复路由；
- 已进入 `implementation` 或更后阶段：不要重复生成或倒退，除非用户明确要求重新生成 change。

### 2. 检查 OpenSpec 和项目约束

执行：

```bash
openspec --version
openspec status --help
cat openspec/config.yaml
```

要求：

- `openspec` CLI 可用；不可用时停止并让用户安装或配置；
- `openspec/config.yaml` 存在，且当前项目使用 `schema: spec-driven`；
- OpenSpec 命令可能打印 PostHog / 网络遥测错误。只要命令退出码为 0 且 JSON 主体有效，不把遥测失败当作流程失败。

### 3. 读取上游产物

执行并解析：

```bash
vega doc get prd --json
vega doc get brainstorm --json
vega doc get tech_design --json
```

读取所有非空路径。`tech_design` 在 Lite workflow 中可以为空；Full workflow 中如果为空，先检查是否有等价文档或询问用户是否允许仅基于 brainstorm 继续。

读取时还要检查：

- `contracts/openapi/`：当前 API 契约状态；
- `apps/web/src/`：前端入口和现有目录边界；
- `apps/server/`：Go 服务入口和后端边界；
- `Makefile`：后续生成、测试和验证命令。

如果缺失 brainstorm 或等价设计文档，停止并要求回到前置阶段。

### 4. 确定 change 名称

默认使用活跃需求名作为 change 名称，必要时加短后缀避免冲突：

```text
<requirement-name>
<requirement-name>-v2
<requirement-name>-api
```

规则：

- 使用 kebab-case；
- 表达需求目标，不使用 `misc-change`、`update-stuff`；
- 如果 `openspec/changes/<change-name>/` 已存在，先读取现有状态并询问用户是继续、覆盖式修订，还是创建新名称；
- 禁止删除已有 change 目录来“重新开始”。

### 5. 创建或恢复 OpenSpec change

新建时执行：

```bash
openspec new change <change-name> --description "<一句话需求摘要>" --schema spec-driven
openspec status --change <change-name> --json
```

恢复已有 change 时直接执行 status。解析：

- `schemaName`；
- `applyRequires`；
- `artifacts[].id`；
- `artifacts[].status`；
- `artifacts[].outputPath`；
- `artifacts[].missingDeps`。

以 `status --json` 为依赖顺序事实源。

### 6. 按依赖顺序生成 artifacts

循环执行直到 `applyRequires` 中的 artifact 全部完成：

```bash
openspec status --change <change-name> --json
openspec instructions <artifact-id> --change <change-name> --json
```

对每个 `status: "ready"` 的 artifact：

1. 读取 `instructions` 输出中的 `template`、`instruction`、`outputPath`、`dependencies`。
2. 读取已完成依赖文件，结合 PRD、brainstorm、tech design 和代码结构生成内容。
3. 写入 `openspec/changes/<change-name>/` 下对应文件。
4. 写完后重新执行 `openspec status --change <change-name> --json`。

生成顺序通常为：

1. `proposal`：说明 Why、What、Capabilities、Impact；
2. `specs`：根据 proposal 的 New/Modified Capabilities，为每个 capability 创建 `specs/<capability>/spec.md`；
3. `design`：说明实现方案、涉及文件、数据流、接口/契约影响、质量检查；
4. `tasks`：把 design 拆成 TDD 任务。

注意：

- `specs` 不是可选项；没有 specs 不允许生成 tasks；
- 不把 `context`、`rules` 等 OpenSpec 指令块原样复制进文件；
- 如果 artifact instructions 缺少必须上下文，先问用户，不要猜。

### 7. Artifact 质量门禁

完成后读取 `openspec/changes/<change-name>/` 下所有生成文件，包括嵌套 `specs/**/spec.md`。逐项检查：

- `proposal.md`：有动机、变更列表、Capabilities、影响范围；
- `specs/**/spec.md`：每个 capability 至少一个 `### Requirement:`，每个 Requirement 至少一个 `#### Scenario:`，场景使用 WHEN/THEN 表达；
- `design.md`：列出受影响文件、职责边界、数据流、接口/契约影响、精确命令；
- `tasks.md`：每个实现任务遵循测试先行，包含 Tests / Implementation / Verification 三类步骤；
- API 变更明确指向 `contracts/openapi/`，并说明是否需要 `make generate`。

然后执行：

```bash
openspec validate <change-name> --strict --json
openspec status --change <change-name> --json
```

如果校验失败，修复 OpenSpec 产物后重跑。不要在校验失败时推进 Vega 阶段。

### 8. 用户审查关卡

向用户报告 change 目录和关键文件，请用户审查。用户要求修改时，修改后重新执行质量门禁。

只有用户明确批准 OpenSpec 产物后，才进入阶段完成。

### 9. 关联产物并推进阶段

执行：

```bash
vega doc set openspec_dir openspec/changes/<change-name>
vega doc get openspec_dir --json
vega complete
vega requirement status --json
vega next --json
```

验证：

- `documents.openspec_dir` 指向 `openspec/changes/<change-name>`；
- 当前阶段推进到 `implementation`；
- 下一 Skill 为 `vega-implementation`。

## 失败与中断

- 等待用户审查或关键澄清时，保持 `openspec` 为 `in_progress`。
- OpenSpec CLI 不可用、schema 不匹配、artifact 校验失败且无法自动修复时，执行：
  ```bash
  vega fail --reason "<具体原因>"
  ```
- 不把 OpenSpec 的遥测网络错误当作失败，除非命令本身非 0 或 JSON 不可解析。

## 完成标准

- 所有必要 OpenSpec artifacts 已生成；
- `openspec validate <change-name> --strict --json` 通过；
- 用户已批准书面产物；
- `documents.openspec_dir` 已登记；
- 未产生业务实现代码；
- `vega complete` 已把阶段推进到 `implementation`。
