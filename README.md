# CS2 校园杯 · 赛事网站

宁波理工学院电竞社 CS2（Counter-Strike 2）校园杯的官方网站，含公开报名页、往届赛事相册、后台管理平台。数据通过腾讯云 CloudBase（PostgreSQL）全网共享。

## 快速开始（3 步）

1. **配置云端**：编辑 `dist/config.js`，填入 环境ID + Publishable Key + 地域（详细图文教程见 [`SETUP-教程.md`](SETUP-教程.md)）。
2. **初始化数据库**：CloudBase 控制台 → 数据库 → PostgreSQL → 「SQL 编辑器」，运行 [`数据库初始化.sql`](数据库初始化.sql)（自动建表 + 配权限，可重复运行）。
3. **部署上线**：`git push` 到 main，CloudBase 静态托管自动拉取并重新发布。

> 没配置云端之前网页也能正常打开，处于「演示模式」（报名只存在本地浏览器）。

## 文件

| 文件 | 作用 |
|---|---|
| `dist/index.html` | 公开主页：报名、战队名单、赛程对阵表 |
| `dist/past.html` | 公开页：往届赛事相册（照片墙） |
| `dist/admin.html` | 后台管理：改赛事信息、看/导出报名、传往届照片 |
| `dist/lc.js` | 数据层（连接 CloudBase） |
| `dist/config.js` | 配置：环境 ID + Publishable 公钥 + 地域 |
| `数据库初始化.sql` | 建表 + RLS 权限脚本（在 CloudBase SQL 编辑器里运行） |
| `SETUP-教程.md` | 从零上线的完整教程：注册、配置、建表、登录、部署、排错 |

## 数据表（PostgreSQL）

三张表，业务字段统一放在 `data(jsonb)` 里，程序自己读写，不用手动加列：

| 表 | 用途 | 访客(anon) | 管理员(authenticated) |
|---|---|---|---|
| `event` | 赛事信息（取最新一条） | 读 | 读写 |
| `team` | 报名战队 | 读 + 报名(insert) | 读写删 |
| `gallery` | 往届照片（每张一行） | 读 | 读写删 |

权限由数据库行级安全（RLS）自动判定：公开页只带 Publishable Key 以 anon 身份访问，只有登录后台后才获得写权限，无需手动配置任何 UID。

## 部署（Git 自动部署）

本仓库连接到腾讯云 CloudBase「静态托管 · Git 仓库部署」。
**改网页只需 `git push`，CloudBase 会自动拉取并重新发布，不用手动删服务重传。**

- 构建框架：其他 / 静态
- 安装命令、构建命令：留空
- 输出目录：`dist`（网站文件都在 `dist/` 目录里）
- 部署路径：`/nbtcscup`
- 部署命令：`tcb hosting deploy ./dist /nbtcscup -e <环境ID>`

> 仓库根目录的文档（`README.md`、`数据库初始化.sql`、`SETUP-教程.md`）不会被部署上线，仅作源码与文档用途。

## 分享预览(QQ/微信链接卡片)

QQ/微信发链接时的预览卡片,由 `index.html` / `past.html` 的 `<head>` 里**静态写死**的 OG 标签决定——爬虫不执行 JS,所以不能用 JS 动态改。要改预览标题/描述/封面图,直接改对应页面的 `og:title` / `og:description` / `og:image`,重新 `git push` 即可。

- 封面图:`dist/og-image.png`(1200×630,站点主题风格),可替换为自己的图(建议 1200×630、<300KB、jpg/png 直链)。
- ⚠️ 分享过旧链接后,QQ/微信会缓存预览(约 7 天)。改完要立刻验证:给链接加参数 `?v=2`(如 `.../nbtcscup/?v=2`)或用**没点过该链接的设备/小号**打开。

## 安全说明

- `config.js` 里只放环境的 **Publishable Key（客户端公钥）**，官方允许其暴露在前端。
- **绝不**把腾讯云账号的 SecretId / SecretKey（账号级私钥）放进本仓库任何文件。
- 后台写权限由数据库行级安全（RLS）保护：只有登录管理员（authenticated 角色）能改数据。

## 本地开发

- 预览：`npx http-server . -p 4599 -c-1`（本仓库 `.claude/launch.json` 已内置该配置）。
- 改完 `dist/` 下的文件，`git push` 即自动上线。