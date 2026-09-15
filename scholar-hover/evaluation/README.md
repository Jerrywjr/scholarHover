# 固定文献样本与人工评估

`corpus-100.json` 和同内容的 `corpus-100.csv` 是从 OpenAlex 公开 REST API 取得的 100 条真实元数据记录，来自四组主题检索：machine learning、cancer immunotherapy、climate change、social psychology，各 25 条，出版年份限制在 2015–2025。它们用于覆盖不同主题和年份的固定输入，并不是严格的学科分层或有代表性抽样。每条保存 DOI、标题、作者、年份、是否存在 OpenAlex 摘要、OpenAlex API 的 `sourceURL` 和采集时间。

这些记录**不是** Google Scholar 搜索观察，也没有任何人工核对。每条 `scholarSeed` 都由元数据派生，明确标记 `provenance: "synthetic_from_metadata"`、`observedScholar: false` 和 `humanReviewed: false`。因此，样本不能用于声称 Scholar DOM 识别、匹配准确率、卡片延迟或用户效果已经实测。

默认离线检查：

```sh
node scripts/collect-corpus.mjs
node scripts/evaluate-corpus.mjs
```

默认采集脚本只读取现有文件，绝不联网。日后如需有意重采集，运行：

```sh
node scripts/collect-corpus.mjs --refresh --seed scholar-hover-corpus-v1
```

它只访问不需 Key 的 OpenAlex API，以固定四个查询、固定 seed 的 DOI 哈希顺序选出每科 25 条，并覆写 JSON/CSV。外部索引会随时间变化，重采集不应被当作与当前固定语料完全相同；需要可比性时应保留当前文件并另传 `--output`。脚本不访问、不抓取 Scholar，也不会输出或接收 Key。

人工核对须由两名不同评审分别在实际 Scholar 结果页填写 `humanReview.reviewerA` 与 `reviewerB`：每人都必须有非空 `reviewerId` 和有效 `reviewedAt`，并记录实际显示标题、作者、年份、DOI 是否与种子匹配、证据链接或说明。`adjudicated` 必须为 `true`，或为 `{ "completed": true, "reviewedAt": "...", "reviewerId": "..." }`。只有 `observedScholar=true`、`humanReviewed=true`、双人审核和明确裁决都完成的 100 条，才算人工审核完整。

每条审核还须填写 `matchEvaluation`：初始值为 `{ "mode": null, "correct": null, "observedAbstractAvailable": null }`；插件自动接受时填 `mode: "auto_matched"` 及 `correct: true|false`，插件拒识时填 `mode: "auto_unresolved"` 及 `correct: null`。两种情况都记录在真实 Scholar 试验中插件是否成功取得该论文摘要，填入 `observedAbstractAvailable: true|false`；这不是 Scholar 页面自身是否显示摘要，也不是原始 OpenAlex 样本的摘要字段。评估器据此分别报告自动正确、自动错误、拒识与已观察摘要可用率。只有 100 条审核完整后，才会检查预先声明的门槛：至少 80 条自动正确且 0 条自动错误；未审核或不达标均输出 `NOT VALIDATED`，不会被报告为通过。

模型译文质量应由独立评审填写 `translationEvaluation`：标题忠实度、摘要忠实度、摘要是否有用、是否出现无依据断言、评审时间与说明。每条真实试验还应写入 `timing.resolveMs`、`generationMs`、`cardVisibleMs`，且标注浏览器、网络、缓存状态和扩展版本。合成种子不能填这些计时字段。

建议进行 8–12 名参与者的交叉试用，不能自动联系或招募任何人：采用被试内、平衡顺序的两条件设计（启用/关闭卡片），每位参与者从难度相近且不重复的任务集完成“定位论文、判断是否相关、理解摘要”任务。记录筛选用时、相对独立人工金标准的误选与漏选、配置成功率、任务完成率及上述日志计时；另记录主观负荷和失败原因。预先规定排除规则和主要指标；将插件自动匹配、用户确认和人工金标准分开报告。样本量适合可用性与失败模式发现，通常不足以支持精确的总体效果或学科差异结论。
