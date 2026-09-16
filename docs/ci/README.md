# Optional GitHub Actions setup

The first public release includes the verification workflow as an **inactive example** in `extension-checks.yml`.

The publishing Git credential and the connected integration cannot create files under `.github/workflows/`. GitHub rejected that operation, so no workflow was enabled and no hosted CI result is claimed. The source, installable extension and local test results are available independently of Actions.

A maintainer with the required workflow-writing permission can copy this example to `.github/workflows/ci.yml` in the repository root and commit it. It checks the `scholar-hover/` project with Node.js 22, unit/DOM tests, corpus checks, a build and isolated browser tests. It uses read-only repository permissions and has no publication or deployment step.

To run the same checks locally, follow [CONTRIBUTING.md](../../CONTRIBUTING.md).

## 中文

首次公开版将自动测试流程保留为未启用的示例。当前发布凭据和连接器都不能创建 `.github/workflows/` 文件，GitHub 已拒绝该操作，因此本仓库不声称云端 CI 已通过。

源码、安装包和本地测试结果照常发布。有工作流写入权限的维护者可将 `extension-checks.yml` 复制到仓库根目录的 `.github/workflows/ci.yml` 后提交。该流程仅测试和构建，没有自动发布步骤。
