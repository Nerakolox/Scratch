# ADR-0002：tldraw 许可状态

- 状态：阻塞生产发布
- 日期：2026-11-10

## 事实

- 本项目使用 `tldraw@5.6.0` 作为画布引擎，自定义 `block-card` Shape。
- tldraw SDK 的默认许可仅允许开发使用；**生产部署需要有效的 trial / hobby / commercial license**，并通过 `licenseKey` 注入。
- 官方当前（2026-11）提供：
  - **免费 100 天 trial license**，每个商业主体限一次；trial 结束后 key 失效；生产 trial 期间会向 tldraw 上报 license key 的哈希用于统计，不上报画布内容或个人信息。
  - **Hobby license**：适情批准的非商用许可，必须在画布上保留 “made with tldraw” 水印。
  - **Commercial license**：按销售沟通定价，无公开价格。
- 没有适用于商业生产的通用免费许可。Duskbit 品牌归属不能自动证明符合 hobby 条款。
- 当前仓库没有购买/申请任何许可证，`VITE_TLDRAW_LICENSE_KEY` 为空。

## 决策

- 开发、测试、演示保留 tldraw 集成；未配置 license 时接受其水印。
- **不**绕过、修改、伪造许可或水印校验。
- 在 README、部署文档与交付报告中明确标注：未取得许可前，本构建不能作为已授权的生产方案。
- 如最终无法满足许可条件，备选路径（未实现）：
  1. 购买 commercial license；
  2. 替换为自研画布（SVG/Canvas + 自建选择/变换/连线），需要重写 `features/canvas` 适配层；
  3. 使用其他许可兼容的无限画布库，并重新评估功能覆盖。

## 后果

- Canvas 功能在技术上完整可用，但发布被法律/商务事项阻塞。
- 用户必须亲自完成许可证采购或提供 license key；Agent 不会代为购买，也不会移除许可保护。
- 自定义 Shape 与持久化通过 `canvas-adapter` 隔离，替换引擎时需要重写适配层，但 Block 数据模型与备份协议不受影响。
