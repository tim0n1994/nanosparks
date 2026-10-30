# 2026-09-20 ChatGPT × NanoSparks MCP 首次真实调用

- 会话: https://chatgpt.com/g/g-p-6aaf70666d048191a7d8815cc2a6e164-nanosparks/c/6aafd07d-06d4-83ec-acd8-075667b13fdf
- 模型: 6 Pro（项目内默认）
- 连接器: NanoSparks（asdk_app_6aafcf4d8e008191a3a1d08417ab0332, auth NONE, URL-secret 代理终结）
- 工具调用证据: 思考 6m59s；NanoSparks 调用序列 overview → search(postgres) → search(redis) → fetch×2 → source_coverage，6 次全部返回
- 证据基线: snapshot_hash aa83e1f28bd7b74d0a48fb032c2ccb8c4a0495ce61b567c7b26fc8e27378f54d（与本会话 verify-chatgpt-proxy.mjs 所见快照一致）
- 补充检索: 网页搜索 24+7 次用于播客数据源官方文档核验

完整对话与研究报告见同目录 conversation-export.md（8125 字符 verbatim 回复）。
核心结论速览:

1. 链路验收: 生产快照→MCP→6 Pro 只读取证链路真实走通（6/6 调用成功，snapshot_hash 跨工具一致）。
2. 流水线诊断 (VERIFIED): project.failed=263、analyze.failed=237、transcribe.failed=148、normalize_turns/analyze waiting-children 54+51、active 全 0；与 DB completed 口径不一致（extractions 差额 17）。
3. 迭代方向排序: ①任务级诊断+时间窗指标(高/低-中) ②失败恢复与父子依赖终态(潜在很高/中) ③completed 与可交付终态对齐(高/中) ④快照契约+受控内容证据(高/中) ⑤已有转录优先 RSS 试点(潜在高/中)。
4. 播客采集: RSS/Podcasting 2.0 首选采集层，Podcast Index 首选发现层（API 需认证、条款限制衍生），Apple RSS transcript+VTT 路线成立；先小样本试点，验收四条不重复/有终态/可回溯。
5. 当前 MCP 限制: 只能研究运行汇总，不能研究节目内容；性能指标全部 UNKNOWN。

注: 本文件由 Codex 会话生成，作为 ChatProj 6 Pro 研究循环首轮的证据存档。
