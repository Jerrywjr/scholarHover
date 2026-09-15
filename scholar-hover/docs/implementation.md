# 文献悬停助手实现记录

0.2.0 多语言改造见 `docs/multilingual-plan.md` 和 `docs/test-report-multilingual.md`。界面与输出分别支持 zh-CN/en/fr/de；旧设置默认中文，旧生成缓存因字段与提示版本变更失效。以下模块与安全约束继续适用；公开 GitHub 等待用户试用后的明确确认。

已批准：桌面 Chrome / Scholar 搜索结果 / 中文 / 纯插件 / BYOK / JIF 后续获授权后接入。

## 模块与交接
|模块|负责|共享接口|
|页面|Scholar DOM 识别、Shadow DOM 卡片、悬停竞争|PaperSeed → RESOLVE / CONFIRM / GENERATE / GET_CACHED|
|数据|OpenAlex、Crossref、保守匹配|resolvePaper(seed, openAlexKey?) → Resolution|
|模型与持久化|Key、配置、缓存、文本生成|Settings / Paper / Generated|
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
- 缓存采用内容/配置指纹、200 条、7 天与 4 MiB 限额；清空缓存使旧请求失去回写资格。
- 预印本标记是三态：明确预印本、明确正式发表、未知；不能将未知强制转换成正式发表。
- 卡片采用请求代次隔离；异步重绘必须保留卡片内焦点及摘要展开状态，且不抢夺卡片外焦点。
- OpenAlex/Crossref 计时在 Resolution.timings，最近模型请求耗时及成功状态在 chrome.storage.session.lastModelTiming；诊断不保存密钥、模型地址或论文正文，也不上传。

## 审查记录
独立审查发现并修复了配置/密钥并发配对、明确预印本误匹配、Crossref 摘要来源遗漏以及异步重绘焦点丢失。各修复有回归测试。实际验收状态以 docs/test-report.md 为准；真实用户试用及人工语料复核尚未执行。
