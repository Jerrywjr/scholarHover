# 0.2.0 多语言测试报告

日期：2026-09-15。交付范围是本地可安装测试版。GitHub 公开发布等待用户试用后的明确确认；未创建或推送远程仓库。

## 实现与验证范围

界面与生成语言各支持简体中文、英文、法语和德语，分别选择。例如，法语设置页及卡片可显示德语译文。设置、占位符、授权说明、错误、匹配警告、Chrome 扩展名称及隐私文档均覆盖四种语言。

旧设置缺少语言字段时继续使用中文，语言变更保留已有密钥。生成语言参与缓存指纹；只改界面语言复用已有译文。切换输出语言时，旧请求和旧缓存响应不能覆盖新卡片。旧版生成缓存因为结构和提示版本变更失效，首次重新生成可能产生模型费用。

## 最终自动检查

|检查|结果|证据与限制|
|---|---|---|
|单元及集成测试|145/145 通过，9 个测试文件|test-results/unit.json|
|评估器回归测试|通过|空/重复/未审核语料不能冒充验收通过|
|TypeScript、生产构建、ZIP 打包|通过|npm run package|
|打包后的浏览器检查|30 项通过|test-results/e2e.json；页面、接口与权限边界使用夹具|
|缓存卡片可见延迟|20 次样本，P95 4.3 ms|扣除 500 ms 悬停等待，仅限本机离线缓存条件|
|四组 manifest 元数据、包内隐私链接、SHA-256|通过|使用最终 dist 与 ZIP 核对|

浏览器记录时间：2026-09-15T14:24:37.212Z。两个独立审查问题已修复并通过限定复核。原始输出保存于 test-results/unit.json 和 test-results/e2e.json。

最终安装包：release/scholar-hover-0.2.0.zip。SHA-256：

```text
df08486a6043caba8314235f9c4b9d318e73de5d0eacfa920970e8346c5f087c
```

浏览器测试加载真正构建的 MV3 扩展，但文献页面、元数据 API、模型 API 和权限边界使用受控夹具。覆盖四种语言、法语界面配德语输出、英文界面配法语输出、切换回中文复用缓存、固定、候选确认、密钥不进入网页、请求范围及本地耗时诊断。没有使用用户 Key、调用付费模型或抓取真实 Scholar。Chrome 的原生授权对话框仍需实际试用。

视觉证据包含 `test-results/options-fr.png`、`options-de.png` 和 `hover-card-fr-de.png`。截图中的论文与译文为明确标记的测试夹具，不代表实际翻译质量。

## 审查与边界

独立审查定位了两个具体问题并加入回归用例：保存或授权等待期间继续编辑配置，可能使新密钥和旧地址配对或把未保存修改显示为已保存；德语 `z. B.` 等缩写可能被分句器误判为多句，导致合法译文被拒绝。最终修复验证以本页上方记录为准。分句检查只是格式启发式，不能证明语言、事实或翻译正确性。

原有 100 条有来源的 OpenAlex 元数据样本保持不变，人工 Scholar 复核、模型译文人工检查和真实用户计时均未完成。评估器继续报告 `NOT VALIDATED`。80 条正确自动匹配、零错误自动匹配及筛选时间收益仍是待检验目标；法语和德语尤其需要合格读者检查数字、否定和结论强度。

## 复现与发布准备

从 `scholar-hover` 目录执行：

```sh
npm ci
npm test -- --reporter=json --outputFile=test-results/unit.json
npm run test:corpus
npm run package
npx playwright install chromium
npm run test:e2e
node scripts/evaluate-corpus.mjs
```

环境为 macOS、Node.js 22.23.1、Vite 7.3.6、Playwright 1.62.1。安装依赖和 Chromium 需要联网，测试本身使用离线页面与接口夹具。仓库已准备 MIT 许可证、中英文 README、贡献说明以及 GitHub Actions 配置；远程 CI 尚未运行，也没有进行 GitHub 或 Chrome 商店发布。
