#!/bin/bash

##############################################
# cron "0 2 * * *"
# new Env('www目录备份')
# 青龙面板 www 目录备份脚本 (系统命令版)
# 使用 tar.gz 压缩，无需额外依赖
# 环境变量从青龙面板读取
##############################################

# ==================== 基础配置 ====================
WWW_PATH="${WWW_PATH:-/ql/backup/www}"
BACKUP_PATH="${BACKUP_PATH:-/ql/backup}"
KEEP_DAYS_LOCAL="${KEEP_DAYS_LOCAL:-5}"
KEEP_DAYS_S3="${KEEP_DAYS_S3:-$KEEP_DAYS_LOCAL}"
BACKUP_PREFIX="${BACKUP_PREFIX:-www_backup}"

# ==================== Synology S3 配置（从青龙面板环境变量读取）====================
# 需要在青龙面板中设置以下环境变量:
#   S3_BUCKET       - S3 存储桶名称
#   S3_REGION       - S3 区域
#   S3_ENDPOINT     - S3 端点
#   S3_ACCESS_KEY   - S3 访问密钥
#   S3_SECRET_KEY   - S3 密钥
#   S3_DIR          - S3 目录前缀（可选，默认 www-backups）
S3_DIR="${S3_DIR:-www-backups}"

# ==================== 脚本逻辑 ====================

LOG_FILE="${BACKUP_PATH}/backup_www.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

error_exit() {
    log "❌ 错误: $1"
    exit 1
}

# 校验必要的环境变量
check_env() {
    local missing=()
    [ -z "$S3_BUCKET" ]     && missing+=("S3_BUCKET")
    [ -z "$S3_REGION" ]     && missing+=("S3_REGION")
    [ -z "$S3_ENDPOINT" ]   && missing+=("S3_ENDPOINT")
    [ -z "$S3_ACCESS_KEY" ] && missing+=("S3_ACCESS_KEY")
    [ -z "$S3_SECRET_KEY" ] && missing+=("S3_SECRET_KEY")

    if [ ${#missing[@]} -gt 0 ]; then
        error_exit "以下环境变量未在青龙面板中设置: ${missing[*]}"
    fi
}

log "=========================================="
log "🚀 开始备份任务 (tar.gz压缩)"
log "=========================================="

# 1. 环境检查
check_env
log "✅ 环境变量校验通过"
[ ! -d "$WWW_PATH" ] && error_exit "目录不存在: $WWW_PATH"
mkdir -p "$BACKUP_PATH"

# 2. 生成时间戳和文件名
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="${BACKUP_PREFIX}_${TIMESTAMP}.tar.gz"
BACKUP_FILE="${BACKUP_PATH}/${BACKUP_NAME}"

# 3. 统计文件数量
FILE_COUNT=$(find "$WWW_PATH" -type f | wc -l)
log "📊 待备份文件数: $FILE_COUNT"

# 4. 使用 tar 打包压缩（全量备份）
log "📦 正在打包压缩 www 目录..."
log "📂 源目录: $WWW_PATH"
log "💾 目标文件: $BACKUP_FILE"

# 进入父目录，打包 www 文件夹
cd "$(dirname "$WWW_PATH")" || error_exit "无法进入目录"

tar -czf "$BACKUP_FILE" "$(basename "$WWW_PATH")" 2>&1 | tee -a "$LOG_FILE"

if [ $? -ne 0 ] || [ ! -f "$BACKUP_FILE" ]; then
    error_exit "打包失败"
fi

# 5. 验证打包结果
FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
ARCHIVED_FILES=$(tar -tzf "$BACKUP_FILE" | wc -l)

log "✅ 打包完成!"
log "📦 文件大小: $FILE_SIZE"
log "📊 已打包文件数: $ARCHIVED_FILES"

# 6. 验证文件数量是否匹配
if [ "$ARCHIVED_FILES" -lt "$FILE_COUNT" ]; then
    log "⚠️  警告: 打包文件数($ARCHIVED_FILES)少于源文件数($FILE_COUNT)"
else
    log "✅ 文件数量验证通过"
fi

# 7. 生成 Python S3 操作脚本（上传 + 清理过期）
PY_S3_SCRIPT="${BACKUP_PATH}/s3_ops_temp.py"

cat > "$PY_S3_SCRIPT" <<'PYEOF'
import os
import sys
import hmac
import hashlib
import datetime
import http.client
import xml.etree.ElementTree as ET

ACCESS_KEY = os.environ.get('S3_ACCESS_KEY')
SECRET_KEY = os.environ.get('S3_SECRET_KEY')
REGION = os.environ.get('S3_REGION')
ENDPOINT = os.environ.get('S3_ENDPOINT')
BUCKET = os.environ.get('S3_BUCKET')

def sign(key, msg):
    return hmac.new(key, msg.encode('utf-8'), hashlib.sha256).digest()

def get_signature_key(key, dateStamp, regionName, serviceName):
    kDate = sign(('AWS4' + key).encode('utf-8'), dateStamp)
    kRegion = sign(kDate, regionName)
    kService = sign(kRegion, serviceName)
    kSigning = sign(kService, 'aws4_request')
    return kSigning

def make_s3_request(method, uri, body=b'', extra_headers=None):
    """通用 S3 签名请求"""
    content_hash = hashlib.sha256(body).hexdigest()
    now = datetime.datetime.utcnow()
    amz_date = now.strftime('%Y%m%dT%H%M%SZ')
    date_stamp = now.strftime('%Y%m%d')

    host = ENDPOINT
    service = 's3'

    canonical_headers = 'host:' + host + '\n' + 'x-amz-content-sha256:' + content_hash + '\n' + 'x-amz-date:' + amz_date + '\n'
    signed_headers = 'host;x-amz-content-sha256;x-amz-date'

    # 拆分 URI 和 querystring
    if '?' in uri:
        canonical_uri, canonical_querystring = uri.split('?', 1)
    else:
        canonical_uri = uri
        canonical_querystring = ''

    canonical_request = method + '\n' + canonical_uri + '\n' + canonical_querystring + '\n' + canonical_headers + '\n' + signed_headers + '\n' + content_hash

    algorithm = 'AWS4-HMAC-SHA256'
    credential_scope = date_stamp + '/' + REGION + '/' + service + '/aws4_request'
    string_to_sign = algorithm + '\n' + amz_date + '\n' + credential_scope + '\n' + hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()

    signing_key = get_signature_key(SECRET_KEY, date_stamp, REGION, service)
    signature = hmac.new(signing_key, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()

    authorization_header = algorithm + ' Credential=' + ACCESS_KEY + '/' + credential_scope + ', SignedHeaders=' + signed_headers + ', Signature=' + signature

    headers = {
        'x-amz-date': amz_date,
        'x-amz-content-sha256': content_hash,
        'Authorization': authorization_header,
    }
    if extra_headers:
        headers.update(extra_headers)

    conn = http.client.HTTPSConnection(host)
    conn.request(method, uri, body, headers)
    response = conn.getresponse()
    return response

def upload_file():
    """上传备份文件到 S3"""
    file_path = os.environ.get('BACKUP_FILE')
    object_key = os.environ.get('OBJECT_KEY')

    if not os.path.exists(file_path):
        print("❌ 文件不存在")
        return False

    file_size = os.path.getsize(file_path)
    print(f"📦 文件大小: {file_size / (1024*1024):.2f} MB")

    print("⏳ 读取文件...")
    with open(file_path, 'rb') as f:
        file_content = f.read()

    uri = '/' + BUCKET + '/' + object_key
    print(f"☁️  上传到: https://{ENDPOINT}{uri}")

    response = make_s3_request('PUT', uri, file_content, {'Content-Type': 'application/gzip'})

    if response.status == 200:
        print("✅ 上传成功 (200 OK)")
        return True
    else:
        print(f"❌ 上传失败: {response.status} {response.reason}")
        body = response.read().decode('utf-8')
        if body:
            print(body)
        return False

def cleanup_expired():
    """清理 S3 上过期的备份文件"""
    s3_dir = os.environ.get('S3_DIR', 'www-backups')
    keep_days = int(os.environ.get('KEEP_DAYS_S3', '5'))
    backup_prefix = os.environ.get('BACKUP_PREFIX', 'www_backup')

    prefix = s3_dir + '/' + backup_prefix
    uri = '/' + BUCKET + '?prefix=' + prefix

    print(f"🔍 列出 S3 文件 (前缀: {prefix})...")
    response = make_s3_request('GET', uri)

    if response.status != 200:
        print(f"❌ 列出文件失败: {response.status} {response.reason}")
        body = response.read().decode('utf-8')
        if body:
            print(body)
        return False

    body = response.read().decode('utf-8')

    # 解析 XML 响应
    # S3 namespace
    ns = ''
    root = ET.fromstring(body)
    # 自动检测命名空间
    if root.tag.startswith('{'):
        ns = root.tag.split('}')[0] + '}'

    contents = root.findall(f'{ns}Contents')
    if not contents:
        print("📭 S3 上没有找到备份文件")
        return True

    now = datetime.datetime.utcnow()
    cutoff = now - datetime.timedelta(days=keep_days)
    deleted_count = 0
    kept_count = 0

    print(f"📋 找到 {len(contents)} 个文件，清理 {keep_days} 天前的备份...")

    for item in contents:
        key = item.find(f'{ns}Key').text
        last_modified_str = item.find(f'{ns}LastModified').text
        # 解析 ISO 8601 时间，例如 2024-01-15T10:30:00.000Z
        last_modified_str = last_modified_str.replace('Z', '+00:00')
        try:
            last_modified = datetime.datetime.fromisoformat(last_modified_str.replace('+00:00', ''))
        except (ValueError, AttributeError):
            print(f"⚠️  无法解析时间，跳过: {key}")
            continue

        if last_modified < cutoff:
            # 删除过期文件
            delete_uri = '/' + BUCKET + '/' + key
            print(f"🗑️  删除过期文件: {key} (修改时间: {last_modified_str})")
            del_response = make_s3_request('DELETE', delete_uri)
            if del_response.status in (200, 204):
                print(f"   ✅ 已删除")
                deleted_count += 1
            else:
                print(f"   ❌ 删除失败: {del_response.status}")
                del_response.read()
        else:
            kept_count += 1

    print(f"🧹 S3 清理完成: 删除 {deleted_count} 个，保留 {kept_count} 个")
    return True

if __name__ == '__main__':
    action = sys.argv[1] if len(sys.argv) > 1 else 'upload'

    if action == 'upload':
        success = upload_file()
        sys.exit(0 if success else 1)
    elif action == 'cleanup':
        success = cleanup_expired()
        sys.exit(0 if success else 1)
    else:
        print(f"未知操作: {action}")
        sys.exit(1)
PYEOF

# 8. 执行上传
log "⏳ 正在上传到 Synology C2..."

export S3_ACCESS_KEY="${S3_ACCESS_KEY}"
export S3_SECRET_KEY="${S3_SECRET_KEY}"
export S3_REGION="${S3_REGION}"
export S3_ENDPOINT="${S3_ENDPOINT}"
export S3_BUCKET="${S3_BUCKET}"
export BACKUP_FILE="${BACKUP_FILE}"
export OBJECT_KEY="${S3_DIR}/${BACKUP_NAME}"
export S3_DIR="${S3_DIR}"
export KEEP_DAYS_S3="${KEEP_DAYS_S3}"
export BACKUP_PREFIX="${BACKUP_PREFIX}"

python3 "$PY_S3_SCRIPT" upload 2>&1 | tee -a "$LOG_FILE"
UPLOAD_STATUS=$?

if [ $UPLOAD_STATUS -eq 0 ]; then
    log "✨ 上传成功！"
else
    log "❌ 上传失败，请检查日志"
fi

# 9. 清理 S3 过期备份
log "🧹 清理 S3 上 ${KEEP_DAYS_S3} 天前的过期备份..."
python3 "$PY_S3_SCRIPT" cleanup 2>&1 | tee -a "$LOG_FILE"
S3_CLEANUP_STATUS=$?

if [ $S3_CLEANUP_STATUS -eq 0 ]; then
    log "✅ S3 过期清理完成"
else
    log "⚠️  S3 过期清理失败，请检查日志"
fi

rm -f "$PY_S3_SCRIPT"

# 10. 清理本地旧备份
log "🧹 清理本地 ${KEEP_DAYS_LOCAL} 天前的旧备份..."
find "$BACKUP_PATH" -name "${BACKUP_PREFIX}_*.tar.gz" -type f -mtime +$KEEP_DAYS_LOCAL -delete
log "✅ 本地清理完成"

log "=========================================="
log "🎉 任务完成"
log "📁 本地文件: $BACKUP_FILE ($FILE_SIZE)"
log "📊 备份文件数: $ARCHIVED_FILES"
log "☁️  云端路径: ${S3_DIR}/${BACKUP_NAME}"
log "=========================================="