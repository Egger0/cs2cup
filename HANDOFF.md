# 交接清单

本文档面向 CloudBase 环境所有者。以下步骤需要控制台权限,开发者不具备,均未执行。

## 0. 现网遗留项

提交 `ca7e8f6` 修复了 Toast 隐藏时底部露出蓝框并拦截点击的缺陷,已推送至 GitHub,但 CloudBase 静态托管的 Git 自动部署未生效——推送一小时后线上 `last-modified` 未变化。旧版静态站已随本次重构删除,该缺陷由新站取代,无需单独发布。

需确认:静态托管的 Git 自动部署为何未触发。若新站仍沿用该机制,同样的问题会重现。

## 1. 执行数据库迁移

在 CloudBase 控制台 → 数据库 → PostgreSQL → SQL 编辑器,按顺序执行:

| 顺序 | 文件 | 预期结果 |
|---|---|---|
| 1 | `migrations/001_schema.sql` | 建立 7 张表与索引 |
| 2 | `migrations/002_access.sql` | 建立 2 个脱敏视图、行级安全策略与授权 |
| 3 | `migrations/003_seed.sql` | 写入社团信息与 4 届赛事 |

全部脚本可重复执行。执行后校验:

```sql
select tablename from pg_tables where schemaname = 'public' order by 1;
select slug, edition, status from public.tournament order by edition;
```

应得到 7 张表,以及 `2022-spring-nlc` / `2022-autumn-nlc` / `2025-nlc` / `2026-nlc` 四届。

### 安全模型

`team` 表含联系方式,对 `anon` 与 `authenticated` 角色**完全不可读**。公开数据只经 `team_public` 与 `player_public` 两个视图暴露,视图中不含 `contact` 列,且只返回 `status = 'approved'` 的战队。

本地已验证四项:匿名直读 `team` 返回 401;读视图返回 200 且无 contact 列;待审核战队不出现在视图中;显式请求 contact 列返回 400。

## 2. 迁移往届照片

现网 10 张照片以 base64 存于 `gallery` 表,合计约 2.33 MB。迁移后改为对象存储 + CDN,实测同样 10 张以 AVIF 交付仅 183 KB,降幅 92.3%。

```bash
LEGACY_RDB_BASE_URL=https://<env>.api.tcloudbasegateway.com/v1/rdb/rest \
LEGACY_ANON_KEY=<publishable key> \
node --experimental-strip-types scripts/migrate-photos.ts
```

产物:

- `migration-output/photos/<赛事slug>/<id>.jpg` — 上传至对象存储,保持目录结构
- `migration-output/004_photos.sql` — 在 SQL 编辑器执行

上传完成后,将对象存储的公开访问基址配置为 `NEXT_PUBLIC_PHOTO_BASE_URL`。

脚本支持 `--dry-run`,可重复运行。

## 3. 配置管理员白名单

```sql
insert into public.admin_user (user_id, note)
values ('<CloudBase 用户 UID>', '姓名')
on conflict do nothing;
```

未在此表中的账号即使登录成功也无任何后台权限。后台鉴权在服务端完成:校验 JWT 签名(通过 CloudBase 的 OIDC JWKS)、校验 `iss` / `aud` / `exp`,再查白名单。伪造 Cookie 无法通过,本地已验证。

## 4. 创建云托管服务

- 服务类型:容器
- 端口:3000
- 构建方式:使用仓库根目录的 `Dockerfile`

环境变量:

| 变量 | 值 |
|---|---|
| `CLOUDBASE_ENV_ID` | 环境 ID |
| `CLOUDBASE_ANON_KEY` | Publishable Key |
| `CLOUDBASE_ADMIN_KEY` | 具备后台读写权限的凭据 |
| `CLOUDBASE_REGION` | `ap-shanghai` |
| `NEXT_PUBLIC_PHOTO_BASE_URL` | 对象存储公开基址 |

## 5. 配置 GitHub Actions

仓库 Settings → Secrets and variables → Actions。

Variables:

| 名称 | 值 |
|---|---|
| `CLOUDBASE_ENV_ID` | 环境 ID |
| `CLOUDRUN_SERVICE_NAME` | 云托管服务名 |
| `PHOTO_BASE_URL` | 对象存储公开基址 |

Secrets:

| 名称 | 值 |
|---|---|
| `CLOUDBASE_ANON_KEY` | Publishable Key |
| `TENCENTCLOUD_SECRETID` | 腾讯云 API 密钥 ID |
| `TENCENTCLOUD_SECRETKEY` | 腾讯云 API 密钥 |

## 未验证事项

以下内容在开发环境无法验证,首次执行时需要留意:

1. **`deploy.yml` 的部署命令**。`tcb cloudrun deploy` 的参数未经真实环境验证,可能需要按 CLI 实际版本调整。CI 中的 typecheck、lint、build 与镜像构建均已本地验证通过。
2. **`CLOUDBASE_ADMIN_KEY` 的获取方式与权限范围**。代码假设存在一个可读写 `team` / `match` / `photo` / `admin_user` 的凭据。若 CloudBase 的实际模型不同(例如需要以登录用户身份而非独立密钥访问),`lib/rdb.ts` 中 `keyFor` 的实现需要相应调整,其余代码不受影响。
3. **后台登录流程**。登录仍由浏览器端 CloudBase SDK 完成(与旧站一致,该路径现网已验证),随后将令牌交由服务端验签并换成 httpOnly Cookie。SDK 的 `signIn` 与 `getAccessToken` 调用未经真实账号验证。CloudBase 不支持 OAuth2 password 授权,故未采用纯服务端登录。
