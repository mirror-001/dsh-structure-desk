# 更新记录

## 0.1.0 — 2026-11-09（Alpha）

首个独立发布：结构台（Structure Desk）DSH 插件包。

- **宿主半边**：`board.json`／`layout.json`／`journal.jsonl`／`history/` 落盘与回滚；HTTP API（`state`／`ops`／`scan`／`history`／`revert`／`export`／`brief`）；v1.16 完成判据 `criteria` 与说法层只读守卫；v1.17 增量接口（`/rev`、`/state?parts`、`/history?since|batch`、move-only 回包、读缓存、gzip）。
- **浏览器半边**：一整页画布（热力场物理、层板、计划视图、域内视图、时间轴、桌边消息、历史撤销），`__sdPerf()` 只读性能仪表。
- **智能体工具** `structure_desk`；57 项 `node:test` 单测；MIT 许可。
- **状态**：宿主侧已验证（单测 57/57、宿主 HTTP 验收 42/42）；浏览器验收 stage v26/v27 待跑，按 **Alpha** 对待。
