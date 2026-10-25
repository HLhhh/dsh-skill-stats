# dsh-skill-stats

[English](README.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933)](package.json)
[![GitHub stars](https://img.shields.io/github/stars/HLhhh/dsh-skill-stats?style=social)](https://github.com/HLhhh/dsh-skill-stats)

**哪些 skill 真在用，哪些装了就没动过。** 给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的左栏加一个面板：列出每个已安装 skill 的使用次数、出现在多少个会话里，以及它占全部 skill 使用的比例。

![Skill 使用统计面板，浅色主题](./docs/preview-light.jpg)

## 为什么需要它

Harness 能告诉你**有哪些 skill**，但不会告诉你**你在用哪些**。于是：

- 半年前装了、一次没碰的 skill，和天天在用的 skill 长得一模一样；
- 你最依赖的那个 skill，没有任何可以拿给别人看的证据。

这个面板用最小的诚实数据回答这两件事：只认 skill 真正被使用的那两个时刻。

## 什么算「一次使用」

只认会话日志里的两种信号：

1. agent 调用了 `skill` 工具（`tool/call` 且 `name: "skill"`，请求的技能名在 `arguments.name`）；
2. 你用 `/name` 直接调用（`user/message` 的 `source.kind` 为 `skill-invocation`）。

其它都不算：skill 只是出现在提示词列表里、agent 自己 `read` 了某个 `SKILL.md`、面板被打开过，都不计。

| 列 | 含义 |
| --- | --- |
| 调用 | 当前时间窗内上述两种信号的次数 |
| 会话 | 用过该 skill 的不同会话数 |
| 占比 | 该 skill 次数 ÷ 当前筛选下的总调用次数 |
| 最后使用 | 最近一次使用的时间 |
| 来源圆点 | 你装的 / 某个插件 / Harness 自带 / 项目内 / 已卸载 |

## 功能

- **每个已安装 skill 都在表里**，包括只能 `/name` 调用的（带「手动」标签）和插件提供的。
- **来源不糊弄。** 技能服务里的 `bundled` 只表示「来自某个 bundle 技能根」，不等于 Harness 自带；面板按 `SKILL.md` 的真实位置判定：插件包内 `skill/`、`skills/` 下的就标成 `插件:<包名>`。
- **不留陈旧快照。** 每次打开页面重新扫描，打开期间每 5 秒自动刷新；已结束的会话文件只在变化时重新解析，稳态下毫秒级。
- **时间窗与筛选**：全部 / 今日 / 近 7 天 / 近 30 天，按来源筛，搜索，「只看从未使用」，可选「含已卸载」。
- **fork 友好。** 延续会话会重放父会话事件；继承事件与重复 callId 会被丢弃，同一次调用不会重复计数。
- **只在本机。** 读你自己的会话日志，不发网络请求、没有遥测。

![Skill 使用统计面板，深色主题](./docs/preview-dark.jpg)

## 安装

纯 JavaScript，无需构建。

### 从 GitHub 安装（npm 版发布前的推荐方式）

```sh
dsh plugin --profile web add github:HLhhh/dsh-skill-stats
```

如果你的 profile 不叫 `web`，换成实际名字。

### 从本地目录或 tarball 安装

```sh
npm pack                                   # 生成 dsh-skill-stats-0.1.0.tgz
dsh plugin --profile web add ./dsh-skill-stats-0.1.0.tgz
```

### 在 agent 会话里安装

把插件管理器指向包目录：

```text
plugin_manager install_bundle target=/absolute/path/to/dsh-skill-stats
```

装好后刷新一次页面，左栏图标会出现在其它面板图标旁边。

### 更新 / 卸载

```sh
dsh plugin --profile web update github:HLhhh/dsh-skill-stats
dsh plugin --profile web remove dsh-skill-stats
```

## 使用方法

| 入口 | 作用 |
| --- | --- |
| 左栏柱状图图标 | 打开「Skill 使用统计」面板 |
| 面板头部 | 已装 / 用过 / 从未使用 / 总调用 / 涉及会话 |
| 筛选行 | 时间窗、来源、搜索、只看从未使用、含已卸载 |
| 表头 | 点任意列排序，再点一次反向 |

除此之外不注册任何东西：没有新工具、没有斜杠命令、不改动其它面板。

## 兼容性

| 项 | 状态 |
| --- | --- |
| DeepSeek Harness | `0.2.x`（在 `0.2.1-rc.3` 桌面版与网页版上构建和实测） |
| Node | `^22.19.0 \|\| >=24.0.0`（用到 `zlib.zstdDecompressSync`） |
| 平台 | 带 skills 功能的桌面版 / 网页版 profile |

## 已装清单是怎么拼出来的

`ctx.skills.list()` 只返回宿主插件自身作用域能看到的层，而桌面 profile 把 `~/.dsh/skills` 挂在 agent preset 的常驻组合里。只问它会把你自己装的 skill 全判成「已卸载」。所以面板合并三个来源、按名字去重：

1. `ctx.skills.list()` —— 全局作用域能看到的；
2. 磁盘技能目录 —— `$DSH_HOME/skills`、`~/.agents/skills`、`$DSH_BUNDLED_SKILL_DIR`，以及会话语料里出现过的各工作区的 `.dsh/skills`、`.agents/skills`；解析 `SKILL.md` frontmatter（兼容 CRLF / BOM，尊重 `disable-model-invocation`）；
3. 会话里的 skill 目录快照（`source.kind === "skill-catalog"`），用来补齐服务没有暴露的插件 / preset 技能。

## 已知限制

- 一个 skill 如果既不在磁盘、也从未出现在任何会话的目录快照里，就无法被发现 —— Harness 没有跨作用域的「列出全部已装 skill」API。
- 目录快照是历史累积：提供该技能的插件被卸载后，名字可能残留在清单里。
- 同名 skill 按生效的那一份去重，被覆盖的不单独展示。
- 失败标记只认 `tool/result` 带 `isError` 的形态，其它失败形态不归因。

## 开发

```sh
npm test          # 语法 + 行为冒烟测试，无第三方依赖
npm pack --dry-run
```

目录结构：

```
index.js            宿主半边：会话扫描、聚合、/dsh-skill-stats/api
client.js           浏览器半边：左栏图标 + 面板（纯 JS，无构建）
cordis.patch.yml    一行 Loader 条目
locale/             插件管理页标题/描述（en、zh）
icon.svg            插件与侧栏图标
docs/               截图
test/smoke.mjs      零依赖冒烟测试，CI 里同样运行
```

## 许可证

MIT，见 [LICENSE](./LICENSE)。
