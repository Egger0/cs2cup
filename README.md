# cs2cup — Cloudflare preview

此分支（`cloudflare`）是独立的新站后端：

- 应用：Cloudflare Workers + OpenNext
- 数据库：Cloudflare D1
- 图片：Cloudflare R2
- 后台访问：Cloudflare Access

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
| `CF_ACCESS_ALLOWED_EMAILS` | 可访问 `/admin` 的邮箱白名单，逗号分隔；Cloudflare Worker Secret |

## 初始化全新预览数据库

```powershell
$env:CLOUDFLARE_API_TOKEN = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN', 'User')
npx wrangler d1 migrations apply cs2cup-preview-db --remote
npx wrangler deploy
```

随后在 Cloudflare Access 创建保护 `/admin*` 的应用，并把可用管理员邮箱写入 `CF_ACCESS_ALLOWED_EMAILS`。这套新站从空 D1 开始；不会导入历史赛事、相册或后台内容。

## 验证

```powershell
npm run typecheck
npm run lint
npm run test:cloudflare-d1
npm run cf:build
```
