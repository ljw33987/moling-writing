# 墨灵写作 · 官方宣传落地页（1.0 上市版）

一个**零依赖**的静态单页，用于放到任何网站、论坛、社群、公众号文章里介绍产品。

页面叙事顺序：**是什么 → 有多大 → 首发权益 → 为什么 → 功能 → 去 AI 味 → 横向对比 → 界面 → 手机版 → 三步上手 → 定价 → FAQ → CTA**。

## 目录结构

```
landing/
├── index.html        页面本体（HTML + 内联 CSS + 内联 JS）
├── assets/           界面截图素材
│   ├── shot-editor.png      编辑器（浅色）— Hero 主视觉
│   ├── shot-dark.png        编辑器（深色）
│   ├── shot-workspace.png   工作台
│   ├── shot-settings.png    设定库
│   ├── shot-plaza.png       作品广场
│   ├── shot-toolbox.png     AI 工具箱
│   ├── m-workspace.png      手机版工作台
│   ├── m-editor.png         手机版编辑器
│   ├── m-ai.png             手机版 AI 助手抽屉
│   └── m-settings.png       手机版设定库
├── cdp.mjs           开发用：最小 Chrome DevTools Protocol 客户端
├── preview.mjs       开发用：分段截图校验视觉效果
├── test-responsive.mjs  开发用：响应式 + 交互自动化实测
└── _preview/         预览输出（部署时不需要）
```

> `cdp.mjs` 的存在原因：Chrome 在 Windows 上会把无头窗口宽度硬钳到 ~500px 下限，
> `--window-size=390` 实际渲染在 491px 布局视口上，截图却按 390px 裁切，
> 导致「移动端导航溢出」这类**假象**。CDP 通过 `Emulation.setDeviceMetricsOverride`
> 可精确模拟任意设备视口，本仓库所有响应式结论均基于它。

## 部署

**方式一：直接上传文件夹**
把 `index.html` 和 `assets/` 一起传到任意静态托管（Vercel / Netlify / GitHub Pages / 对象存储 / 自己的 Nginx）即可。

**方式二：整包上传**
`../moling-landing.zip` 已打包好（随页面改动同步更新），解压后就是完整的站点目录。

**方式三：嵌入别的网站**
```html
<iframe src="你的域名/index.html" style="width:100%;height:1200px;border:0" loading="lazy"></iframe>
```
或直接把 `index.html` 内容内联进已有页面（注意 `assets/` 路径要同步调整）。

## 特性

- **零外部依赖** —— 不引 CDN、不引字体、不引框架，国内访问无障碍
- **深浅色双主题** —— 右上角切换，跟随系统偏好，localStorage 记忆
- **完全响应式** —— 640px / 900px / 1024px 三个断点；实测 1600→320px 共 17 档零横向溢出
- **对比表自适应** —— ≥820px 为完整表格，≤820px 自动转成卡片（每行一张卡），**不做横向滚动**
- **原生 JS 交互** —— 滚动淡入、界面预览 Tab 切换、FAQ 手风琴、移动端菜单
- **移动端菜单完整态** —— 汉堡展开 / 遮罩点击关闭 / Esc 关闭 / 点菜单项关闭 / 展开时锁定页面滚动 / `aria-expanded` 同步
- **SEO 基础** —— title / description / keywords / og 标签已配好
- **无障碍** —— 语义化标签、按钮 aria-label、图片 alt 文本

## 页面里「有据可查」的两块内容

这两块是刻意做进宣传页的**真实能力证据**，不是营销话术，改版时不要删：

| 板块 | 内容来源 |
|---|---|
| `#humanize` 去 AI 味 | 平台实测 A/B：同一句提示词、同一款模型，修复前输出「心中五味杂陈 / 空气仿佛凝固 / 命运的齿轮 / 嘴角微微上扬」，修复后输出「林川抬起头。天很高，云一动不动。他扯了扯嘴角，笑出声来。」 |
| `#compare` 横向对比 | 依据 2026 年主流 AI 写作工具的公开功能与定价整理（讯飞绘文、笔灵AI、写作猫、番茄/起点作家助手、Sudowrite、Novelcrafter、Campfire 等） |

## 需要改的地方

| 位置 | 说明 |
|---|---|
| 「登录」「免费开始」「免费注册」等按钮 | 目前指向页内锚点，**上线前要换成你的真实注册链接** |
| `moling.app`（截图地址栏） | 换成你的真实域名 |
| 页脚「平台文档 / 写作教程 / 联系我们」 | 换成真实链接或删掉 |
| 社交图标（微博 / 邮箱） | 换成你的真实账号 |
| 数据条数字（12,846 / 38,209 …） | 按真实数据改，或删掉整块 |
| **首发权益条**（注册送 Token / 30 天月卡 / 年卡 ¥199 / 广场推荐位） | **占位权益**，按真实首发政策逐条核对或删掉 |
| **定价首发价**（年卡 ¥199，原价 ¥299） | 占位价，按实际首发价改 |
| **横向对比表**的三列能力描述 | 按产品实际能力核对；「通用大模型」「单机提示词工具」两列是品类概括，**不要点名具体竞品** |
| **去 AI 味对比卡**里的两段样例文字 | 若与平台真实输出不符，请替换为实测文本 |
| `og:image` | 指向 `assets/shot-editor.png`，需要绝对 URL 时改成完整地址 |

## 重新生成截图

截图来自 `design/` 目录的 UI 设计稿。**当前素材是 AXIOM 玄序（商务范）版本**：

```powershell
cd design
$env:THEME='business'; $env:OUTDIR='_landing'; $env:SCALE='1'
node build.mjs 03-editor.body.html 02-workspace.body.html 04-settings.body.html 05-plaza.body.html 06-toolbox.body.html 09-dark-editor.body.html
$env:SCALE='2'
node build.mjs m-02-workspace.body.html m-03-editor.body.html m-04-ai-sheet.body.html m-05-settings.body.html
$env:SCALE=$null; $env:OUTDIR=$null; $env:THEME=$null
```

产物在 `design/_landing/business/`，按上表命名复制到 `landing/assets/`。

要换回 Studio Zero 版本，把 `$env:THEME` 设为 `'zero'` 并去掉 `OUTDIR` 重跑即可。

> ⚠️ `SCALE` 环境变量会覆盖输出分辨率；`OUTDIR` 用于把产物导到临时目录，
> **不要**用它跑 `design/out/` 的正式 2x / 3x 稿，否则会降级正式稿。

## 校验视觉效果

```bash
cd landing && node preview.mjs 0 1150 2400 3600 4800 6400
# 深色模式
DARK=1 node preview.mjs 0 2100
```

输出在 `landing/_preview/`，文件名 `p<滚动偏移>.png`（深色加 `d` 后缀）。
`_preview/` 只是校验快照，**部署时不需要**。

> 页面里的产品截图是 `loading="lazy"`，未进入视口前高度为 0，
> 所以**首次滚动到位后再量偏移**才准；用 `scrollIntoView()` 定位比写死像素更稳。

## 自动化实测

```bash
cd landing && node test-responsive.mjs
```

覆盖：17 档视口宽度（1600→320）的横向溢出检测、主题切换与持久化、
界面预览 Tab 切换、FAQ 手风琴互斥、导航滚动态、移动端菜单的
展开/关闭/遮罩/Esc/滚动锁定/aria 同步、全绿才会以退出码 0 结束。

当前基线：**40 项断言全绿，退出码 0**（2026-11，1.0 上市版）。
