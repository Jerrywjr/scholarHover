# 0.5.0：跨网站链接悬停与工具栏开关

验证日期：2026-09-26。当时验证对象为本地试用包。2026-09-29 以 GitHub 预发布版发布，尚未上架 Chrome Web Store；发布检查与当前安装包见[更新说明](release-notes-0.5.0.md)。

## 问题、改动与使用方式

原实现的注入范围和消息发送者检查均限制在 Google Scholar，论文识别还假定输入是 Scholar 提供的标题、作者和年份。仅扩大网站列表无法处理 Nature 参考文献中的“PDF”或被截短的链接文字，也不能确保同一篇论文换网站后复用已有译文。

0.5.0 增加工具栏 ON/OFF 开关。首次安装或首次从 0.4.x 升级时默认 OFF；之后保存用户的开关状态。用户点击 ON 并授予所有 HTTPS 网站的可选访问权限后，扩展动态注入支持的网页，包括已打开的页面。悬停或键盘聚焦链接 500 毫秒后读取该链接，先显示本地信息，再读取其目标公开页面。不会批量向外部服务发送页面上所有链接。

普通链接的显示文字不再被当作已核验的论文标题：先从目标页读取论文引用元数据、明确的学术文章结构及真实摘要，随后才按已有设置翻译。arXiv 的摘要、PDF 和 HTML 链接归一到摘要页，保留明确的版本号；Nature 文章 PDF 链接归一到文章 HTML，提取明确标为 Abstract 的区域。普通网页未识别出论文信息时可以立即保存、手动翻译标题，不自动消耗模型额度，不用网页简介冒充摘要。

同一规范化目标 URL 的不同链接文字复用预览和译文；Scholar 的严格匹配仍保留，反向复用还需核对论文身份。跨网站收藏按相同目标去重。点“缓存本文”立即保存已有信息，后台继续补全，不要求等待翻译。关闭开关停止新预览，但用户已明确保存的后台任务可以继续完成，已有缓存不被删除。

升级时将安装包解压到原来加载的扩展目录，在 `chrome://extensions` 重新加载，打开工具栏开关并授权；旧网页如仍显示旧面板，刷新一次。请保留原目录和扩展实例，以保留本机配置与数据。

## 重要函数和证据位置

| 文件 | 主要函数 | 职责与检查重点 |
|---|---|---|
| [popup/index.ts](../src/popup/index.ts) | `startPopup` | 读取真实开关状态；直接点击中申请权限；更新失败后重新读取状态，避免界面与后台不一致。四语文本位于 `popup/messages.ts`。 |
| [hover-control.ts](../src/background/hover-control.ts) | `createHoverControl`、`get`、`set`、`sync` | 串行切换、校验权限、持久化、注册或注销脚本、通知已打开页面；撤销权限后恢复关闭状态。 |
| [background/index.ts](../src/background/index.ts) | `hover` 的 Chrome 适配方法、消息监听器 | 对 HTTPS 顶层页面动态注册及注入，广播状态、更新图标 ON/OFF；保持原有模型和收藏后台入口。 |
| [content/links.ts](../src/content/links.ts) | `parseLink`、`linkFor` | 只解析触发的链接，排除下载控件、可编辑区域、自身片段、非公开或不支持的 URL；标记为待核验的链接输入。 |
| [content/index.ts](../src/content/index.ts) | `targetFor`、`seedFor`、`startContentScript`、`onRuntimeMessage` | 同时支持 Scholar 条目与普通链接；开启时重新读模型设置；关闭使旧响应失效，移除卡片；重复注入不增加监听器。 |
| [source-page.ts](../src/shared/source-page.ts) | `normalizeSourceUrl`、`extractSourcePaper`、`natureAbstract` | 保持链接与来源身份一致；提取有明确依据的标题和摘要；拒绝 DOI、年份、作者、预印本版本冲突。 |
| [metadata.ts](../src/background/metadata.ts) | `resolvePaper` | 先读目标页；普通链接缺少论文身份时不把链接文字送到 OpenAlex 搜索。 |
| [identity.ts](../src/shared/identity.ts)、[cache.ts](../src/background/cache.ts) | `linkPreviewKey`、`previewKey`、`createCache` 中的 `getPreview` / `putPreview` | 精确 URL 归档、兼容 Scholar 到链接的复用、保守的反向复用；不清除已有付费生成结果。 |
| [router.ts](../src/background/router.ts) | `assertPreviewStillEnabled`、`resolve`、`generate`、`findSaved` | 不只在消息入口检查开关，还在异步读缓存后、启动外部请求前复查；已明确保存任务继续；两个方向的跨页面收藏去重。 |
| [browser-fixture.mjs](../scripts/browser-fixture.mjs) | `prepareBrowserFixture`、`enableHoverFixture` | 将构建复制到临时目录，仅为测试预授予 HTTPS 权限；通过真实受信任弹窗消息开启功能。不会修改交付包。 |
| [universal-e2e.mjs](../scripts/universal-e2e.mjs) | `installSourceFixture`、`openFixture`、`hover`、`popupFor`、`waitUntil` | 用公开网页与模型的受控响应检查真实扩展、动态注入、解析、缓存、关闭和重启；`finally` 清理临时浏览器、证书与服务器。 |

新增和修改的测试位于 `tests/hover-control.test.ts`、`popup.test.ts`、`content-links.test.ts`、`router.test.ts`、`cache.test.ts`、`identity.test.ts`、`metadata.test.ts` 与 `source-page.test.ts`。对开关关闭期间启动请求、普通链接到 Scholar 重复收藏、首次开启后未加载模型设置等问题，观察到失败后修复并通过回归检查。

## 验证结果

从 `scholar-hover/` 运行：

```sh
npm test -- --maxWorkers=2
npm run test:corpus
npm run package
npm run test:e2e
npm run test:source-e2e
npm run test:universal-e2e
```

- 单元与页面测试：**23 个文件、468 项通过**。`npm run package` 内的 TypeScript 检查与生产构建通过；固定样本评估器的子进程测试通过，`git diff --check` 无错误。
- 原有 Scholar 浏览器流程：**87 项检查通过**，覆盖侧栏、四语设置、超时与重试、立即保存、导出、真实浏览器重启和 IndexedDB 迁移。
- 来源读取浏览器流程：**29 项检查通过**，覆盖直接读取 arXiv、版本边界、旧错误缓存恢复和受控权限拒绝。
- 新增跨网站浏览器流程：**23 项检查通过**，覆盖默认 OFF、已打开的 Nature 页面开启后无需刷新、arXiv 和 Nature 链接、不同文字的同一链接复用、跨网站再次预览、关闭页面后收藏补全、关闭开关时的迟到响应、重新开启、动态插入链接、键盘聚焦和浏览器重启。

新增跨网站测试共读取 5 个受控来源页面，调用本地模型替身 4 次，没有索引查询或页面错误。延迟来源请求尚未返回时，收藏确认耗时 31 毫秒；重启后再次预览已生成但未收藏的论文，无新增来源或模型调用。这些数字仅描述本机与受控响应，不代表真实网站和模型的延迟。

浏览器检查合计 **139 项**。测试使用临时独立 Chromium 配置，不读取个人浏览器配置，不使用真实模型 Key 或产生付费模型调用。截图和原有端到端诊断保存在本地 `test-results/`，包括 `universal-popup.png`、`e2e.json`、`background-save-complete.png`、`restarted-unsaved-preview.png`。

## 授权、来源和验证边界

浏览器夹具只在临时扩展副本的 manifest 中预授予 `https://*/*`，因为无界面浏览器无法完成原生 Chrome 权限对话框。扩展代码、实际脚本注册与注入、后台和 offscreen、解析、存储、模型 worker 均使用生产构建。弹窗申请权限的时序、拒绝与异常有单元测试；**真实 Chrome 授权对话框仍需首次试用时手工检查**。交付 ZIP 已单独检查，所有 HTTPS 网站权限仍为可选项，没有被夹具改为安装时必需权限。实现依据：[Chrome Permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)、[Chrome Scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)。

本次核对了 Nature 官方文章的 Abstract 与 PDF 链接形态，例如 [AlphaFold 文章](https://www.nature.com/articles/s41586-021-03819-2) 和 [另一篇 Nature 文章](https://www.nature.com/articles/nature14539)。网络环境未能取得其完整原始 HTML，故 Nature 的具体 DOM 提取通过合成结构验证，**不能据此声称已完成真实 Nature 页面的端到端提取**。此前真实 arXiv 页面的提取证据见 [0.4.1 报告](test-report-0.4.1.md)，不能代替所有网站的覆盖验证。

功能面向支持的 HTTPS 页面中的普通链接，不保证任意链接都能取得摘要。浏览器内置页面、Chrome 应用商店、原生 PDF 阅读器及限制扩展访问的页面不支持。登录或验证页面、需要脚本生成的摘要、任意 PDF 正文、重定向请求仍不解析。来源请求不发送 Cookie、模型 Key 或登录凭据，不运行来源脚本；仅标题、已取得的摘要及指令在已有同意后发送给模型。开关关闭不能撤回已开始的模型计费。

测试不证明翻译准确率、真实 Scholar 匹配准确率或筛选效率。100 条人工核对样本、四种语言的人工审阅及用户对照试用仍待完成。

## 安装包检查

2026-09-26 本地文件：`release/scholar-hover-0.5.0.zip`，128,384 字节。以下校验值属于当时本地 ZIP；2026-09-29 重新构建发布包的校验值见[更新说明](release-notes-0.5.0.md)，重新打包的时间戳会影响 ZIP 校验值。Manifest 版本为 `0.5.0`，包含 `popup.html` 与 `popup.js`，没有静态 Scholar 专用注入项；必需网站权限仍仅为 arXiv、OpenAlex 和 Crossref，`https://*/*` 位于可选权限列表。包内无 `node_modules`、source map 或 `.env` 文件。

SHA-256：`d0d2e3b1c4a9655951192e0bea36613214e202231239d04bc03ba5d40a4d3de3`。
