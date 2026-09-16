# 文献悬停助手实现记录

0.4.0 增加 IndexedDB 预览/译文归档、旧生成缓存迁移，以及“先收藏、后台补全”队列。界面与输出分别支持 zh-CN/en/fr/de；旧设置默认中文。0.2.0 多语言改造的历史记录见 `docs/multilingual-plan.md` 和 `docs/test-report-multilingual.md`，不能代替当前版本验收；公开 GitHub 仍等待用户试用后的明确确认。

已批准：桌面 Chrome / Scholar 搜索结果 / 中文 / 纯插件 / BYOK / JIF 后续获授权后接入。

## 模块与交接
|模块|负责|共享接口|
|---|---|---|
|页面|Scholar DOM 识别、Shadow DOM 卡片、悬停竞争、查看/收藏状态|PaperSeed → GET_PREVIEW_STATES / GET_PREVIEW / RESOLVE / CONFIRM / GENERATE / SAVE_PAPER|
|数据|OpenAlex、Crossref、保守匹配|resolvePaper(seed, openAlexKey?) → Resolution|
|模型与归档|Key、配置、IndexedDB 归档、旧缓存迁移、文本生成|Settings / Paper / Generated / ArchiveBackend|
|收藏与补全|独立收藏、后台顺序队列、匹配确认、显式重试|SavedPaper / PaperCompletion / RETRY_SAVED / CONFIRM_SAVED|
|集成|后台消息授权、打包、浏览器测试、交付文档|src/shared/types.ts 为统一契约|

## 决定与限制
- 空仓库无初始提交，使用 codex/scholar-hover 分支，在 scholar-hover 目录实现。
- 各模块编辑范围分离，可并行实现；主代理负责统一接口和最终集成检查。
- 人工复核和真实用户研究不能以自动生成结果冒充；提供固定样本与评估流程，并标记尚待人工完成的门槛。
- 不发送招募消息，不自动公开发布，不使用未授权模型 Key。

## 实现与维护约束
- 页面 → 受校验的 runtime 消息 → worker；网络访问与密钥始终留在受信任的扩展上下文。
- 所有生产配置修改、清除密钥、模型配置与密钥快照必须经过 router 的 withConfiguration 队列。不得另设绕过该队列的设置写入口，否则可能重新引入“旧域名配新密钥”竞态。
- 论文注册表按标签页和输入隔离。GENERATE 不接受网页提交的摘要；CONFIRM 仅接受当前注册候选。候选含真实摘要，但确认前不会以已匹配论文展示或生成。
- 来源属于程序数据，不由模型填充。Crossref 补充摘要时保留 OpenAlex 主记录来源，并追加 Crossref 摘要来源。
- 预览与译文归档使用 IndexedDB，不设置 TTL、条数或 4 MiB 自动淘汰规则；浏览器存储配额仍然适用。预览键保留来源地址、作者、年份等身份信息，不能只按标题合并；生成指纹区分论文内容、接口、模型、输出语言与提示版本。清空归档使旧请求失去归档回写资格，独立收藏不随之清空。
- 首次归档操作迁移旧 `generated:` 本机缓存：整个 IndexedDB 事务提交后才能删除旧副本，迁移失败保留旧数据；无法识别的旧记录另存原始副本，不冒充可复用译文。归档读取失败先尝试匹配的内存或收藏副本；没有可靠结果时报告读取失败，不能把错误当成 cache miss 再次付费。
- `SAVE_PAPER` 接受已校验的页面 seed，先完成本机收藏写入，再启动补全，不等待元数据或模型服务。收藏仍限制 200 篇 / 4 MiB，超限失败不淘汰旧条目。按 sourceKey 优先去重，保留首次收藏顺序、时间及稳定的收藏 ID；后台解析可更新 paper.id，发现 canonical ID 相同的独立条目时不静默合并出版版本。
- 主动收藏要求补全该篇，即使 `autoGenerate=false`；模型调用仍受已有 consent、域名权限、服务配置和 Key 约束。补全依次处理 queued、resolving、generating、ready；候选不确定时进入 needs-confirmation，配置不全进入 needs-configuration，失败进入 failed，均由明确确认或重试继续。重复保存不重启失败任务。
- 后台队列不依赖 Scholar 标签页存活。worker / 浏览器重启后，queued 与 resolving 可恢复；generating 先尝试已有匹配结果，没有结果则记为 interrupted，人工重试并提示上次请求可能已计费。失败不自动重发模型请求；会话 Key 在浏览器重启后仍需重新填写。
- 收藏更新在串行存储操作中核对 id、savedAt 与预期源内容，阻止删除重存、候选变更后的旧成功或失败结果误写；配置改变时，旧译文不能覆盖当前输出。收藏首次时间对同一毫秒的删除重存也能区分。
- 未完成的收藏允许导出，管理页显示未完成提示，Markdown 保留缺失字段说明。导出使用固定快照；之后的补全、删除和排序不改写已生成文件。
- 预印本标记是三态：明确预印本、明确正式发表、未知；不能将未知强制转换成正式发表。
- 卡片采用请求代次隔离；异步重绘必须保留卡片内焦点及摘要展开状态，且不抢夺卡片外焦点。
- OpenAlex/Crossref 计时在 Resolution.timings，最近模型请求耗时及成功状态在 chrome.storage.session.lastModelTiming；诊断不保存密钥、模型地址或论文正文，也不上传。

## 审查记录
历史独立审查涉及配置/密钥并发配对、明确预印本误匹配、Crossref 摘要来源遗漏以及异步重绘焦点丢失。0.4.0 针对立即收藏、归档失败回退、重启恢复、重复付费防护和异步更新归属增加了回归测试；验证范围见 `docs/test-report-0.4.0.md`。真实用户试用及人工语料复核不能由自动化检查代替。
