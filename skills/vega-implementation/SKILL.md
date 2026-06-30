---
name: vega-implementation
description: 基于已生成并登记的 OpenSpec change 执行 Vega 需求实现，严格采用 TDD：先写失败测试，再写最小实现，通过验证后勾选 tasks 并完成 implementation 阶段。用于活跃需求处于 `implementation`、用户要求开始编码/实现 OpenSpec/change，或 `vega next --json` 返回 `vega-implementation` 时。
---

# Vega 实现

读取 `documents.openspec_dir` 指向的 OpenSpec change，按 `tasks.md` 逐项实现。当前 Vega CLI 尚无模块级状态命令，因此本 Skill 以一个活跃需求的主 change 为实施单元。

## 硬性边界

- 不在没有 OpenSpec change 和任务清单的情况下开始实现。
- 不执行 `git commit`。
- 不回滚用户已有改动；遇到相关脏改动时先理解并协同处理。
- 不绕过 TDD。生产代码必须有先失败过的测试支撑。
- 不在测试或关键验证失败时执行 `vega complete`。

## 输入与产出

输入：

- `vega requirement status --json`；
- `vega doc get openspec_dir --json`；
- OpenSpec apply instructions；
- change 中的 `proposal.md`、`design.md`、`tasks.md`、`specs/**/spec.md`；
- 项目 Makefile 与相关包测试命令。

产出：

- 已实现并通过验证的代码、测试和契约变更；
- `tasks.md` 中已完成任务被逐项勾选；
- `implementation` 阶段完成，状态推进到 `verification`。

## 执行流程

为以下步骤建立任务清单并逐步更新。实现过程中持续保持任务、测试、代码三者同步。

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
- `current_phase` 为 `implementation`；
- 当前阶段状态为 `in_progress`；
- 下一 Skill 为 `vega-implementation`。

异常处理：

- 尚未进入 `implementation`：停止并说明应先完成当前阶段；
- 当前阶段为 `failed`：遵循 `vega next --json` 的恢复路由；
- 没有活跃需求：停止并使用 `vega-requirement-init`；
- 有脏工作区：区分本次相关与无关改动，不要回滚无关改动。

### 2. 读取 OpenSpec change

执行：

```bash
vega doc get openspec_dir --json
```

如果 `path` 为空：

1. 检查 `openspec/changes/` 是否只有一个可用 change；
2. 若能唯一确定，询问用户是否登记该路径；
3. 否则停止并要求先运行 `vega-openspec`。

从 `openspec_dir` 推导 `<change-name>`，然后执行：

```bash
openspec status --change <change-name> --json
openspec instructions apply --change <change-name> --json
```

要求：

- `state` 不能是 `blocked`；
- 如果 `missingArtifacts` 包含 `tasks`、`specs`、`design` 或 `proposal`，停止并返回 `vega-openspec`；
- OpenSpec 命令可能打印 PostHog / 网络遥测错误。只要退出码为 0 且 JSON 主体有效，不把遥测失败当作流程失败。

读取 apply instructions 的 `contextFiles` 中所有文件；如果为空，至少读取：

- `<openspec_dir>/proposal.md`
- `<openspec_dir>/design.md`
- `<openspec_dir>/tasks.md`
- `<openspec_dir>/specs/**/spec.md`

### 3. 建立实施范围

从 `tasks.md` 找到未完成任务。每次只处理一个清晰任务组，优先按文件或能力边界推进。

开始前确认：

- 任务对应的 spec scenario；
- 预期改动文件；
- 应运行的测试命令；
- 是否涉及 OpenAPI 契约和代码生成。

如果任务不清楚，先问用户或回到 OpenSpec 产物修订；不要猜着实现。

### 4. TDD 循环

对每个未完成任务执行 Red-Green-Refactor：

1. **RED：先写测试**
   - 新功能、bugfix、行为变更都先写测试；
   - 测试应验证真实行为，不只验证 mock；
   - 优先放在对应包的测试体系中：CLI 用 Vitest，后端用 Go `testing`，前端用项目现有测试框架。

2. **验证 RED**
   - 运行最小相关测试命令；
   - 必须看到测试失败，且失败原因是功能尚未实现；
   - 如果测试直接通过，说明测试没有覆盖新行为，必须修正测试。

3. **GREEN：最小实现**
   - 只写让当前测试通过的最少生产代码；
   - 不顺手做无关重构；
   - 不扩展未在 spec 或任务中确认的功能。

4. **验证 GREEN**
   - 重新运行最小相关测试命令；
   - 通过后再运行受影响包的更广测试；
   - 失败时优先修实现，不随意削弱测试。

5. **REFACTOR**
   - 只在测试保持绿色后整理命名、去重和边界；
   - 重构后重新运行相关测试。

6. **勾选任务**
   - 只有代码和测试都通过后，才把 `tasks.md` 对应项从 `- [ ]` 改为 `- [x]`；
   - 不要批量勾选未验证任务。

例外：

- 纯文档、配置或生成物任务如果无法合理先写测试，必须在 `tasks.md` 或最终摘要中说明验证方式，并运行对应静态检查或生成校验。
- 如果用户明确批准跳过 TDD，也要记录这是用户授权的例外。

### 5. 契约和生成

如果任务涉及 API、数据模型或跨端契约：

1. 先修改 OpenSpec / OpenAPI 契约；
2. 运行：
   ```bash
   make spec-check
   make generate
   ```
3. 将生成物纳入后续测试；
4. 如果生成命令缺依赖或配置缺失，不要伪造生成结果，报告阻塞。

### 6. 完成前验证

当 apply instructions 显示任务已完成，或 `tasks.md` 已无未完成项时，执行：

```bash
openspec validate <change-name> --strict --json
openspec instructions apply --change <change-name> --json
```

然后运行验证命令：

- 总是优先运行任务或 design 中列出的精确命令；
- CLI 改动运行 `make test-cli`；
- 后端改动运行 `make test-server`；
- 前端改动运行 `make test-web` 和必要的 `make lint-web`；
- 跨栈改动运行 `make tdd-check`。

如果 `make tdd-check` 因项目测试脚本尚未配置而失败，不要静默通过；修复配置若属于本次范围，否则报告为阻塞并不要完成阶段。

### 7. 推进阶段

全部验证通过后执行：

```bash
vega complete
vega requirement status --json
vega next --json
```

验证当前阶段推进到 `verification`，下一 Skill 为 `vega-verification`。

## 失败与中断

- 用户中断、任务不清楚、测试无法可靠表达行为时，保持 `implementation` 为 `in_progress`。
- 已确认阻塞且无法继续时执行：
  ```bash
  vega fail --reason "<具体原因>"
  ```
- 不把“测试失败但还可修复”立即标成 failed；先修到合理上限。
- 不在验证失败时勾选任务或推进阶段。

## 完成标准

- 所有 OpenSpec tasks 均已逐项完成并勾选；
- 每个行为变更都有先失败后通过的测试，或有明确用户批准的例外；
- OpenSpec strict validation 通过；
- 相关 Makefile 验证命令通过；
- 未回滚用户无关改动，未自动提交；
- `vega complete` 已把阶段推进到 `verification`。
