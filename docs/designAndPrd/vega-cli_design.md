# Vega CLI 命令设计

> `packages/vega-cli` — Node.js + commander.js

---

## 设计原则

- **只做状态读写和校验**，不包含业务逻辑。业务逻辑在 Skill 中。
- **`--json` 全面覆盖**：所有查询类命令均支持 `--json`，便于 Agent 解析。
- **幂等操作**，重复执行不产生副作用。
- **`complete` 自动推进**：标记当前阶段完成的同时，自动将 `current_phase` 推进到下一阶段并设为 `in_progress`。

---

## 命令清单

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
vega archive                                           # 归档当前需求（可能需配合仓库知识地图之类的 skill 使用）
```

---

## 关键命令语义说明

### `vega init`
初始化 `.vega-harness/` 目录结构（`requirements/`、`docs/`）。不下载或生成 Skill 文件 —— Skill 属于 Agent 配置，跟随 `.claude/skills/` 等目录管理，与 CLI 解耦。

### `vega complete`
标记当前阶段 `completed`，同时自动将 `current_phase` 推进到下一阶段并设为 `in_progress`。如果当前已是最后一个阶段（`archive`），则标记整个需求为完成。

### `vega retry`
仅当 `current_phase` 的 `status` 为 `failed` 时生效，将其重置为 `in_progress`，允许 Agent 重新执行该阶段对应的 Skill。

### `vega transition <phase>`
手动跳转到指定阶段。默认校验目标阶段是否为当前阶段的合法后继（按链路顺序），`--force` 可跳过校验用于异常恢复。

### `vega requirement switch <name>`
切换当前活跃需求。CLI 通过 `.vega-harness/.active` 文件记录活跃需求名称，所有不带 `<name>` 参数的命令默认操作活跃需求。
