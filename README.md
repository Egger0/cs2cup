# CS2 校园杯 · 赛事网站

宁波理工学院电竞社 CS2（Counter-Strike 2）校园杯的官方网站，含公开报名页、往届赛事相册、后台管理平台。数据通过腾讯云 CloudBase（PostgreSQL）全网共享。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 公开主页：报名、战队名单、赛程对阵表 |
| `past.html` | 公开页：往届赛事相册（照片墙） |
| `admin.html` | 后台管理：改赛事信息、看/导出报名、传往届照片 |
| `lc.js` | 数据层（连接 CloudBase） |
| `config.js` | 配置：环境 ID + Publishable 公钥 + 地域 |

## 部署（Git 自动部署）

本仓库连接到腾讯云 CloudBase「静态托管 · Git 仓库部署」。
**以后改网页只需 `git push`，CloudBase 会自动拉取并重新发布，不用手动删服务重传。**

- 构建框架：其他 / 静态
- 安装命令、构建命令：留空
- 输出目录：`dist`（网站文件都在 `dist/` 目录里）
- 部署路径：`/nbtcscup`
- 部署命令：`tcb hosting deploy ./dist /nbtcscup -e <环境ID>`

## 安全说明

- `config.js` 里只放环境的 **Publishable Key（客户端公钥）**，官方允许其暴露在前端。
- **绝不**把腾讯云账号的 SecretId / SecretKey（账号级私钥）放进本仓库任何文件。
- 后台写权限由数据库行级安全（RLS）保护：只有登录管理员（authenticated 角色）能改数据。
