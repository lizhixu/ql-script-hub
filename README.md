# QL Script Hub - 青龙面板脚本集合

## 环境变量配置说明

以下为各脚本所需的环境变量，请在青龙面板「环境变量」页面中添加。

---

### 🎬 爱奇艺全功能签到 (`iqiyi.js`)

> cron: `0 1 * * *`

| 变量名 | 必填 | 说明 | 示例 |
|--------|:----:|------|------|
| `IQIYI_COOKIE` | ✅ | 爱奇艺 Cookie，多账号用 `&` 或换行分隔 | `P00001=xxx;P00002=xxx;...` |
| `IQIYI_NOTIFY` | ❌ | 是否推送通知，默认 `true`，设为 `false` 关闭 | `false` |

---

### 💬 V2EX 论坛签到 (`v2ex.js`)

> cron: `8 5 * * *`

| 变量名 | 必填 | 说明 | 示例 |
|--------|:----:|------|------|
| `V2EX_COOKIE` | ✅ | V2EX Cookie，多账号用 `&` 或换行分隔 | `_ga=xxx;A2=xxx;...` |
| `V2EX_PROXY` | ❌ | 代理地址（如需翻墙） | `http://127.0.0.1:7890` |

---

### 🛒 什么值得买签到 (`SMZDM_checkin.py`)

> cron: `39 7 * * *`

| 变量名 | 必填 | 说明 | 示例 |
|--------|:----:|------|------|
| `SMZDM_COOKIE` | ✅ | 什么值得买 Cookie，多账号用 `&` 分隔 | `smzdm_id=xxx;sess=xxx;...` |
| `MAX_RANDOM_DELAY` | ❌ | 最大随机延迟秒数，默认 `3600` | `1800` |
| `RANDOM_SIGNIN` | ❌ | 是否启用随机延迟，默认 `true` | `false` |

---

### ☁️ 阿里云盘签到 (`aliyunpan_checkin.py`)

> cron: `3 8 * * *`

| 变量名 | 必填 | 说明 | 示例 |
|--------|:----:|------|------|
| `ALIYUN_REFRESH_TOKEN` | ✅ | 阿里云盘 refresh_token，多账号用 `&` 分隔 | `abcdef1234...` |
| `AUTO_UPDATE_TOKEN` | ❌ | 自动更新 token，默认 `true` | `false` |
| `PRIVACY_MODE` | ❌ | 隐私保护模式（脱敏显示），默认 `true` | `false` |
| `SHOW_TOKEN_IN_NOTIFICATION` | ❌ | 通知中是否显示 token，默认 `false` | `true` |
| `MAX_RANDOM_DELAY` | ❌ | 最大随机延迟秒数，默认 `3600` | `1800` |
| `RANDOM_SIGNIN` | ❌ | 是否启用随机延迟，默认 `true` | `false` |

---

### 📁 百度网盘签到 (`baiduwangpan_checkin.py`)

> cron: `0 9 * * *`

| 变量名 | 必填 | 说明 | 示例 |
|--------|:----:|------|------|
| `BAIDU_COOKIE` | ✅ | 百度网盘 Cookie，多账号用换行分隔 | `BDUSS=xxx;STOKEN=xxx;...` |
| `PRIVACY_MODE` | ❌ | 隐私保护模式，默认 `true` | `false` |
| `MAX_RANDOM_DELAY` | ❌ | 最大随机延迟秒数，默认 `3600` | `1800` |
| `RANDOM_SIGNIN` | ❌ | 是否启用随机延迟，默认 `true` | `false` |

---

### 🌐 ikuuu 签到 (`ikuuu_checkin.py`)

> cron: `0 5 * * *`

| 变量名 | 必填 | 说明 | 示例 |
|--------|:----:|------|------|
| `IKUUU_EMAIL` | ✅ | 邮箱地址，多账号用英文逗号 `,` 分隔 | `user1@mail.com,user2@mail.com` |
| `IKUUU_PASSWD` | ✅ | 对应密码，多账号用英文逗号 `,` 分隔（与邮箱一一对应） | `pass1,pass2` |
| `PRIVACY_MODE` | ❌ | 隐私保护模式，默认 `true` | `false` |
| `MAX_RANDOM_DELAY` | ❌ | 最大随机延迟秒数，默认 `3600` | `1800` |
| `RANDOM_SIGNIN` | ❌ | 是否启用随机延迟，默认 `true` | `false` |

---

### 🔍 NodeSeek 签到 (`nodeseek_checkin.py`)

> cron: `23 4 * * *`

| 变量名 | 必填 | 说明 | 示例 |
|--------|:----:|------|------|
| `NODESEEK_COOKIE` | ✅ | NodeSeek Cookie，多账号用 `&` 分隔 | `session=xxx;...` |
| `NS_RANDOM` | ❌ | 签到随机模式，默认 `true` | `false` |
| `MAX_RANDOM_DELAY` | ❌ | 最大随机延迟秒数，默认 `3600` | `1800` |
| `RANDOM_SIGNIN` | ❌ | 是否启用随机延迟，默认 `true` | `false` |

---

### 📦 夸克网盘签到 (`quark_signin.py`)

> cron: `13 3 * * *`

| 变量名 | 必填 | 说明 | 示例 |
|--------|:----:|------|------|
| `QUARK_COOKIE` | ✅ | 夸克网盘 Cookie，多账号用换行 `\n` 或 `&&` 分隔 | `__pus=xxx;__kp=xxx;...` |
| `MAX_RANDOM_DELAY` | ❌ | 最大随机延迟秒数，默认 `3600` | `1800` |
| `RANDOM_SIGNIN` | ❌ | 是否启用随机延迟，默认 `true` | `false` |

---

### ☁️ 天翼云盘签到 (`ty_netdisk_checkin.py`)

> cron: `1 2 * * *`

| 变量名 | 必填 | 说明 | 示例 |
|--------|:----:|------|------|
| `TY_USERNAME` | ✅ | 天翼云盘手机号/用户名，多账号用 `&` 分隔 | `13800138000` |
| `TY_PASSWORD` | ✅ | 对应密码，多账号用 `&` 分隔（与用户名一一对应） | `mypassword` |
| `MAX_RANDOM_DELAY` | ❌ | 最大随机延迟秒数，默认 `3600` | `1800` |
| `RANDOM_SIGNIN` | ❌ | 是否启用随机延迟，默认 `true` | `false` |

---

### 📝 有道云笔记签到 (`youdao.py`)

> cron: `01 5 * * *`

| 变量名 | 必填 | 说明 | 示例 |
|--------|:----:|------|------|
| `YOUDAO_COOKIE` | ✅ | 有道云笔记 Cookie，多账号用 `&` 或换行分隔 | `YNOTE_PERS=xxx;...` |

---

### 💾 www 目录备份 (`backup.sh`)

> cron: `0 2 * * *`

| 变量名 | 必填 | 说明 | 示例 |
|--------|:----:|------|------|
| `S3_BUCKET` | ✅ | S3 存储桶名称 | `kite` |
| `S3_REGION` | ✅ | S3 区域 | `us-003` |
| `S3_ENDPOINT` | ✅ | S3 端点地址 | `us-003.s3.synologyc2.net` |
| `S3_ACCESS_KEY` | ✅ | S3 访问密钥 | `ushSyCwS...` |
| `S3_SECRET_KEY` | ✅ | S3 密钥 | `xZ2ue6Wx...` |
| `S3_DIR` | ❌ | S3 目录前缀，默认 `www-backups` | `my-backups` |
| `WWW_PATH` | ❌ | 备份源目录，默认 `/ql/backup/www` | `/data/www` |
| `BACKUP_PATH` | ❌ | 本地备份目录，默认 `/ql/backup` | `/data/backup` |
| `KEEP_DAYS_LOCAL` | ❌ | 本地保留天数，默认 `5` | `7` |
| `KEEP_DAYS_S3` | ❌ | S3 保留天数，默认等于 `KEEP_DAYS_LOCAL` | `30` |
| `BACKUP_PREFIX` | ❌ | 备份文件名前缀，默认 `www_backup` | `site_backup` |

---

## 通用环境变量

以下变量对大部分 Python 脚本通用：

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `MAX_RANDOM_DELAY` | 最大随机延迟秒数 | `3600`（1小时） |
| `RANDOM_SIGNIN` | 是否启用随机延迟执行 | `true` |
| `PRIVACY_MODE` | 是否启用隐私保护模式（脱敏显示敏感信息） | `true` |
