# 宁波理工电竞社官网

浙大宁波理工学院电竞社官方网站。赛事报名、参赛战队、对阵赛程、往届相册与后台管理。

## 技术栈

Next.js App Router · React · TypeScript · CloudBase PostgreSQL · CloudBase 云托管

## 本地开发

```bash
npm install
npm run stack:up
cp .env.example .env.local
npm run dev
```

`stack:up` 会启动本地 PostgreSQL 与 PostgREST，并自动执行 `migrations/` 下的全部脚本。

导入往届照片（需要现网只读公钥）：

```bash
LEGACY_RDB_BASE_URL=https://<env>.api.tcloudbasegateway.com/v1/rdb/rest \
LEGACY_ANON_KEY=<publishable key> \
npm run photos:import
```

停止本地环境：`npm run stack:down`

## 环境变量

| 变量 | 用途 |
|---|---|
| `CLOUDBASE_ENV_ID` | CloudBase 环境 ID |
| `CLOUDBASE_ANON_KEY` | 匿名 Publishable Key,用于公开数据读取 |
| `CLOUDBASE_ADMIN_KEY` | 管理凭据,用于后台读写 |
| `CLOUDBASE_REGION` | 地域,默认 `ap-shanghai` |
| `RDB_BASE_URL` | 覆盖数据接口基址,仅本地开发使用 |
| `NEXT_PUBLIC_PHOTO_BASE_URL` | 相册图片的对象存储基址 |

## 目录

| 路径 | 内容 |
|---|---|
| `app/(public)/` | 公开页面 |
| `app/(public)/tournaments/[slug]/` | 赛事区域:总览、战队、对阵、战报、规则、报名 |
| `app/admin/` | 后台管理 |
| `components/ui/` | 无领域知识的基础组件 |
| `components/domain/` | 赛事领域组件 |
| `components/layout/` | 页面骨架 |
| `lib/` | 数据访问、鉴权、赛制推演 |
| `migrations/` | 数据库迁移脚本 |
| `scripts/` | 一次性迁移工具 |

`components/ui/` 不得引入 `lib/types.ts`。

## 部署

推送到 `main` 触发 `.github/workflows/deploy.yml`,构建镜像并发布至 CloudBase 云托管。

数据库迁移按 `migrations/` 下的编号顺序执行,全部脚本可重复运行。
