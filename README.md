# BiliPilot（哔哩智能管家）

B 站个人数据管理工具，包含两套使用方式：

- `extension/`：Chrome 扩展，在 B 站页面内实时完成关注分组、收藏归类、数据看板和操作日志。
- `src/` + `scripts/`：Node.js CLI，用于批量拉取、分析、整理和导出数据。

## 功能概览

| 工作方式 | 模块 | 说明 |
|------|------|------|
| Chrome 扩展 | 关注分组 | 点关注后自动分析 UP 主并写入最合适的关注分组 |
| Chrome 扩展 | 收藏归类 | 在视频详情页收藏弹窗内前置推荐收藏夹，必要时自动新建并选中 |
| Chrome 扩展 | 弹窗看板 | 在 popup 内查看关注、收藏、稍后再看和历史概览 |
| Chrome 扩展 | 操作反馈 | 成功后显示系统通知、页内 toast 和扩展徽标提示 |
| Node.js CLI | 关注分组 | 批量拉取关注列表，LLM 分类并同步到 B 站 |
| Node.js CLI | 收藏夹整理 | 批量分析收藏夹视频并执行归类/移动 |
| Node.js CLI | 稍后再看 | 生成摘要和观看优先级建议 |
| Node.js CLI | 历史/互动/报告 | 统计画像、互动偏好、Markdown 报告和 JSON 导出 |

## Chrome 扩展

### 当前能力

- `popup` 内提供 `状态`、`看板`、`设置`、`日志` 四个标签页。
- `autoFollowGroup` 和 `autoFavOrganize` 是扩展侧唯一的自动化开关。
- 关注分组和收藏归类都会在当前会话里读取最新开关状态，关闭后会尽快停止后续自动动作。
- 收藏弹窗前置自动化当前只覆盖 B 站视频详情页。
- 成功路径会显示更明显的提示：系统通知 + 页内 toast + 扩展图标绿色徽标。

### 安装方式

1. 打开 `chrome://extensions`
2. 开启“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择仓库中的 [`extension/`](extension/) 目录

### 使用方式

1. 在浏览器中登录 B 站，并至少打开一个 B 站页面。
2. 打开扩展 popup，在“设置”里选择 LLM 服务商并填入 API Key。
3. 在“状态”页按需开启：
   - `总开关`
   - `关注自动分组`
   - `收藏自动归类`
4. 后续在 B 站内：
   - 点“关注”时，扩展会自动分析并分组。
   - 在视频详情页点“收藏”时，扩展会在弹窗里预选推荐收藏夹；没有合适收藏夹时会自动创建并重新打开弹窗后选中。

### 扩展配置存储

- 扩展侧配置保存在 `chrome.storage.local`
- 不依赖 `.env`
- 默认值定义在 [`extension/lib/storage.js`](extension/lib/storage.js)

主要字段：

| 字段 | 说明 |
|------|------|
| `enabled` | 扩展总开关 |
| `autoFollowGroup` | 是否接管关注分组 |
| `autoFavOrganize` | 是否接管收藏归类 |
| `llmProvider` | `zhipu` / `kimi` / `minimax` |
| `zhipuApiKey` / `kimiApiKey` / `minimaxApiKey` | 对应服务商 Key |

## Node.js CLI

### 快速开始

```bash
npm install
cp .env.template .env
# 修改 .env 中的 Cookie、UID、API Key 等

npm start
```

### 常用命令

| 模块 | npm 脚本 | 说明 |
|------|----------|------|
| 全部执行 | `npm start` | 顺序执行全部模块 |
| 关注分组 | `npm run follow` | 批量拉取关注并同步分组 |
| 收藏夹 | `npm run favorites` | 批量分析并整理收藏夹 |
| 稍后再看 | `npm run watchlater` | 摘要和优先级推荐 |
| 历史记录 | `npm run history` | 观看习惯统计和 AI 画像 |
| 互动统计 | `npm run interactions` | 投币/点赞偏好分析 |
| 综合报告 | `npm run report` | 生成 Markdown 报告 |
| 数据导出 | `npm run export` | 导出 JSON 备份 |

### 命令示例

```bash
npm run follow                 # 完整流程：拉取 -> 分类 -> 同步
npm run follow -- --dry-run    # 只分类不写入 B 站

npm run favorites                    # 完整流程：拉取 -> 分析 -> 整理
npm run favorites -- --fetch-only    # 只拉取数据
npm run favorites -- --analyze-only  # 拉取 + 分析，不整理
npm run favorites -- --dry-run       # 分析但不执行移动

npm run watchlater                  # 拉取稍后再看并做摘要
npm run history -- --max-pages 10   # 限制历史拉取页数
npm run report                      # 生成综合报告
npm run export                      # 导出本地数据
```

### CLI 环境变量

以下变量只影响 Node.js CLI，不影响 Chrome 扩展：

| 变量 | 说明 |
|------|------|
| `BILI_COOKIE` | B 站登录态 Cookie |
| `BILI_UID` | 你的 B 站 UID |
| `LLM_PROVIDER` | `zhipu` / `kimi` / `minimax` |
| `ZHIPU_API_KEY` | 使用智谱时必填 |
| `KIMI_API_KEY` | 使用 Kimi 时必填 |
| `MINIMAX_API_KEY` | 使用 MiniMax 时必填 |
| `DRY_RUN` | CLI 只读模式，默认 `true` |
| `MOVE_MODE` | 收藏整理时是否用“移动”替代“复制” |
| `FORCE_RECLASSIFY` | 是否忽略缓存强制重新分析 |
| `ALLOW_CUSTOM_CATEGORIES` | 是否允许自定义分类名 |

## 项目结构

```text
extension/
├── manifest.json              # Chrome 扩展入口
├── service-worker.js          # MV3 后台逻辑
├── content/
│   ├── bridge.js              # 隔离世界桥接 + 页内 toast
│   └── interceptor.js         # 页面请求拦截 + 收藏弹窗自动化
├── lib/
│   ├── bili-api.js            # 扩展侧 B 站 API 封装
│   ├── classifier.js          # 实时分类核心逻辑
│   ├── dashboard-view.js      # popup 看板渲染
│   ├── llm-client.js          # 扩展侧 LLM 请求
│   ├── page-actions.js        # 通过页面上下文代请求 B 站
│   ├── prompts.js             # 扩展提示词
│   ├── storage.js             # chrome.storage 封装
│   └── wbi.js                 # WBI 签名
└── popup/
    ├── popup.html
    ├── popup.css
    └── popup.js

src/
├── index.js                   # CLI 入口
├── config.js                  # 环境变量解析
├── core/                      # CLI 基础设施
├── llm/                       # CLI LLM 适配层
├── modules/                   # CLI 各模块实现
└── main.js                    # 旧入口，保留兼容

scripts/
├── export.js                  # 导出脚本
└── sync_tags.js               # 独立同步脚本
```

## 常见问题

### 扩展和 CLI 有什么区别？

- 扩展适合日常实时使用，直接在 B 站页面内自动分组/归类。
- CLI 适合批量处理、生成报告和数据导出。

### 扩展开关和 `DRY_RUN` 是一回事吗？

不是。

- `autoFollowGroup` / `autoFavOrganize` 是扩展侧开关，保存在浏览器本地存储里。
- `DRY_RUN` 是 CLI 环境变量，只影响 Node.js 脚本。

### 收藏弹窗自动化覆盖哪些场景？

当前只优先覆盖 B 站视频详情页的原生收藏弹窗。其他入口默认回退到原生行为或旧的兜底链路。

### 数据文件在哪？

- CLI 运行结果默认写入 `data/` 和 `reports/`
- 扩展运行日志和配置保存在浏览器 `chrome.storage.local`
