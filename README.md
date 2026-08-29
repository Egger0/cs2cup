# cs2cup — Cloudflare preview

此分支（`cloudflare`）是独立的新站后端：

- 应用：Cloudflare Workers + OpenNext
- 数据库：Cloudflare D1
- 图片：Cloudflare R2
- 后台访问：Worker 密钥 + 签名会话

它不读取、不写入、也不需要任何 CloudBase 环境变量、密钥或 SDK。CloudBase 旧站和数据保持原样，既不是本分支的依赖，也不会被本分支修改。

## 本地开发

```powershell
npm ci
npm run cf:build
npm run cf:preview
```

`wrangler.jsonc` 绑定 Cloudflare 的 D1、R2 和静态资源。部署前请在 Cloudflare 中创建同名资源并更新 D1 的 `database_id`。

## 所需环境变量

| 变量 | 用途 |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | 站点的绝对 HTTP(S) 地址；本地默认可用 `http://localhost:3000` |
| `REGISTRATION_FINGERPRINT_SECRET` | 报名限流所需的至少 32 字节随机密钥；Cloudflare Worker Secret |
| `REGISTRATION_CLIENT_IP_SOURCE` | 生产环境填 `cf-connecting-ip` |
| `ADMIN_USERNAME` | 后台管理员账号；Cloudflare Worker Variable 或 Secret |
| `ADMIN_PASSWORD` | 后台管理员密码；Cloudflare Worker Secret |
| `ADMIN_SESSION_SECRET` | 至少 32 字节随机会话签名密钥；Cloudflare Worker Secret |

## 初始化全新预览数据库

```powershell
$env:CLOUDFLARE_API_TOKEN = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN', 'User')
npx wrangler d1 migrations apply cs2cup-preview-db --remote
npx wrangler deploy
```

随后在 Worker 的运行时变量中配置 `ADMIN_USERNAME`，并把 `ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET` 作为 Secret 写入。访问 `/admin` 会跳转到账号密码登录页。这套新站从空 D1 开始；不会导入历史赛事、相册或后台内容。

## 验证

```powershell
npm run typecheck
npm run lint
npm run test:cloudflare-d1
npm run cf:build
```
