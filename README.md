# bili-follow-ai-repack

用 Node.js 直接调用 B 站接口，拉取关注列表并结合 LLM (支持 智谱 GLM / 月之暗面 Kimi) 进行分类，按 B 站常见大分区给每个 UP 主分配一个“主分组”。

## 特点

- 只走接口，不操作 DOM
- 默认是更保守的低风险参数
- 支持 `DRY_RUN` 先只读不写
- 支持缓存、断点续跑、日志记录
- 支持 WBI 签名接口获取空间信息与最近视频

## 快速开始

```bash
npm install
cp .env.template .env
# 修改 .env
npm start
```

## 推荐运行顺序

1. 先保持 `DRY_RUN=true`，只看分类结果。
2. 抽查分类没问题后，把 `DRY_RUN=false`。
3. 继续保持 `MOVE_MODE=false`，先“复制到分组”，不要一开始就移动。

## 主要环境变量

- `BILI_COOKIE`
- `BILI_UID`
- `LLM_PROVIDER` (可选 `zhipu` 或 `kimi`，默认 `zhipu`)
- `ZHIPU_API_KEY` (使用 GLM 时必填)
- `KIMI_API_KEY` (使用 Kimi 时必填)
- `DRY_RUN`
- `MOVE_MODE`
- `FORCE_RECLASSIFY`

## 输出文件

- `data/cache.json`：mid 到分类结果的缓存
- `data/tags.json`：分组名到分组 id 的映射
- `logs/run.log`：运行日志

## 常见问题

### 1. 请求突然失败变多
先暂停一段时间再继续。对老号来说，慢一点通常比快一点更稳。

### 2. 出现验证码或返回拦截
说明频率过高或登录态异常。先检查 Cookie 是否有效，再拉长延迟。

### 3. 已有分组会不会被覆盖
不会。默认是新增或复用分组，并把 UP 加进去。只有 `MOVE_MODE=true` 时才会更激进。
