# v0.5.0 — Preview paper links across websites

Experimental prerelease · 2026-09-29 · [Repository](https://github.com/Jerrywjr/scholarHover) · [Download](https://github.com/Jerrywjr/scholarHover/releases/tag/v0.5.0)

## English

This release moves paper previews beyond Google Scholar results. An OFF-by-default toolbar switch enables hovering or keyboard focus on links across supported HTTPS websites. The extension checks the local archive, reads the linked public article page, and translates the retrieved title and abstract using your configured model. arXiv revisions remain separate; supported Nature PDF links resolve to their article pages.

- Reuse compatible translations when revisiting the same destination, including links with different labels or on different websites.
- Save immediately and complete paper information in the background, even after closing the originating tab.
- Turn previews off without deleting saved content. Explicitly saved jobs may finish; closing the switch cannot reverse model charges already incurred.
- Keep English, Simplified Chinese, French and German interfaces, independent output-language selection, a resizable sidebar and ordered Markdown/PDF exports.

**Known unresolved failures:** some readable articles still produce “The source page did not provide verifiable paper information.” That message does not distinguish a challenge/login page from missing metadata or a failed identity check. The current reader fetches static HTML without cookies, follows no redirects and does not read an already-open authenticated or script-rendered page. A subsequent OpenAlex HTTP 429 is a separate rate/quota failure. These reported live-use failures are **not fixed by this publication**. Missing abstracts remain missing; the extension must not invent summaries from titles.

Install `scholar-hover-0.5.0.zip`, not GitHub’s automatically generated source archive. Extract into a permanent folder and load it using Chrome’s **Load unpacked**. For an upgrade, replace files in the **same directory**, reload the extension, and turn ON in its toolbar popup. First activation requests optional access to all HTTPS websites. Existing model configuration, consent and local records remain; a session-only key may need re-entry after a browser restart. Browser-internal pages and native PDF viewers are unsupported.

Release verification on 2026-09-29: **468 unit/DOM tests**, TypeScript checking, production packaging and corpus-evaluator subprocess checks passed. ZIP contents and checksum were checked. The **139 controlled browser checks** recorded on 2026-09-26 were not rerun for this documentation-only publication update. Native Chrome permission prompts, broad live-publisher coverage, translation quality and screening effectiveness are not established by those fixtures. Hosted GitHub Actions remains inactive. See the [verification report](https://github.com/Jerrywjr/scholarHover/blob/v0.5.0/scholar-hover/docs/test-report-0.5.0.md).

## 简体中文

本版将悬停预览从 Scholar 搜索结果扩展到支持的 HTTPS 网页链接。工具栏开关首次默认 OFF，开启并授权后，鼠标悬停或键盘聚焦可先查本机归档，再读取链接指向的公开论文页面，使用已有模型配置翻译标题和真实取得的摘要。保留明确的 arXiv 修订版本，支持将 Nature 论文 PDF 链接转为文章页面。

- 同一目标链接在不同网站、使用不同文字时，复用已有且配置一致的译文。
- 点击“缓存本文”立即保存，关闭原标签页后继续后台补全。
- 关闭开关不删除已有资料；明确保存的任务可以继续完成，已发生的模型计费无法撤回。
- 保留中英法德四语、独立的译文语言、可调整高度的侧栏，以及按序导出 Markdown 和 PDF。

**已知问题尚未修复：** 正常可读的论文仍可能提示“原文页面未提供可核验的论文信息”。这条提示没有区分登录或验证码、元数据缺失和身份校验不一致。当前后台仅获取静态 HTML，不携带 Cookie、不跟随跳转，不能直接读取用户已打开且完成登录或脚本加载后的页面。后续 OpenAlex HTTP 429 是独立的限流或额度问题。本次先发布已有版本，**不宣称已解决这些实际使用失败**；没有摘要时不编造概述。

下载 `scholar-hover-0.5.0.zip` 扩展安装包，解压后通过 Chrome“加载已解压的扩展程序”安装。升级时覆盖**原来加载的目录**并重新加载，再点击插件图标开启 ON、确认所有 HTTPS 网站的可选权限。保留原有模型设置和本机数据；若密钥只保存到会话，重启浏览器后需要重新输入。浏览器内置页和原生 PDF 阅读器不支持。

2026-09-29 重新通过 **468 项单元／页面测试**、类型检查、生产构建与打包、评估器子进程检查，并核对 ZIP 内容与校验值。**139 项受控浏览器检查**完成于 2026-09-26，本次仅修改发布说明，未重复运行；这些检查不能证明真实网站普遍可用或翻译正确。真实权限弹窗、人工语言审核和筛选效果评估仍待完成。GitHub Actions 尚未启用，不能把本机验证说成远端持续集成通过。

## Artifact / 安装包

`scholar-hover-0.5.0.zip` · 128,384 bytes · SHA-256:

```text
5fc2d2918eeca1a707c1d405e1bfd4e6b1f27df8396b03186ae853b5451b3bb8
```
