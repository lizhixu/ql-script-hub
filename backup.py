#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cron: 0 2 * * *
new Env('www目录备份')

青龙面板 www 目录备份脚本 (Python 版)
使用 tar.gz 压缩 + S3 上传 + 过期清理
环境变量从青龙面板读取
"""

import os
import sys
import hmac
import hashlib
import tarfile
import datetime
import http.client
import xml.etree.ElementTree as ET
from pathlib import Path

# ---------------- 统一通知模块加载 ----------------
hadsend = False
send = None
try:
    from notify import send
    hadsend = True
except ImportError:
    pass

# ==================== 配置 ====================
WWW_PATH = os.getenv("WWW_PATH", "/ql/backup/www")
BACKUP_PATH = os.getenv("BACKUP_PATH", "/ql/backup")
KEEP_DAYS_LOCAL = int(os.getenv("KEEP_DAYS_LOCAL", "5"))
KEEP_DAYS_S3 = int(os.getenv("KEEP_DAYS_S3", str(KEEP_DAYS_LOCAL)))
BACKUP_PREFIX = os.getenv("BACKUP_PREFIX", "www_backup")

S3_BUCKET = os.getenv("S3_BUCKET", "")
S3_REGION = os.getenv("S3_REGION", "")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "")
S3_DIR = os.getenv("S3_DIR", "www-backups")


# ==================== 日志 ====================
LOG_FILE = None


def log(msg):
    """带时间戳的日志输出"""
    line = f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line)
    if LOG_FILE:
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass


def error_exit(msg):
    log(f"❌ 错误: {msg}")
    sys.exit(1)


def notify_user(title, content):
    """统一通知函数"""
    if hadsend:
        try:
            send(title, content)
        except Exception:
            pass


# ==================== S3 签名 ====================
def _sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _get_signature_key(key, date_stamp, region, service):
    k_date = _sign(("AWS4" + key).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    k_signing = _sign(k_service, "aws4_request")
    return k_signing


def s3_request(method, uri, body=b"", extra_headers=None):
    """通用 S3 签名请求 (AWS Signature V4)"""
    content_hash = hashlib.sha256(body).hexdigest()
    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    host = S3_ENDPOINT
    service = "s3"

    canonical_headers = (
        f"host:{host}\n"
        f"x-amz-content-sha256:{content_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"

    if "?" in uri:
        canonical_uri, canonical_qs = uri.split("?", 1)
    else:
        canonical_uri, canonical_qs = uri, ""

    canonical_request = "\n".join([
        method, canonical_uri, canonical_qs,
        canonical_headers, signed_headers, content_hash
    ])

    algorithm = "AWS4-HMAC-SHA256"
    credential_scope = f"{date_stamp}/{S3_REGION}/{service}/aws4_request"
    string_to_sign = "\n".join([
        algorithm, amz_date, credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    ])

    signing_key = _get_signature_key(S3_SECRET_KEY, date_stamp, S3_REGION, service)
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    auth = (
        f"{algorithm} Credential={S3_ACCESS_KEY}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    headers = {
        "x-amz-date": amz_date,
        "x-amz-content-sha256": content_hash,
        "Authorization": auth,
    }
    if extra_headers:
        headers.update(extra_headers)

    conn = http.client.HTTPSConnection(host)
    conn.request(method, uri, body, headers)
    return conn.getresponse()


# ==================== 核心功能 ====================
def count_files(directory):
    """递归统计目录下的文件数量"""
    return sum(1 for _ in Path(directory).rglob("*") if _.is_file())


def create_backup(www_path, backup_file):
    """使用 tarfile 打包压缩目录"""
    parent = os.path.dirname(www_path)
    base = os.path.basename(www_path)

    with tarfile.open(backup_file, "w:gz") as tar:
        tar.add(www_path, arcname=base)

    return True


def get_archive_count(backup_file):
    """获取压缩包中的文件数量"""
    with tarfile.open(backup_file, "r:gz") as tar:
        return len(tar.getmembers())


def format_size(size_bytes):
    """格式化文件大小"""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f}{unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f}TB"


def upload_to_s3(backup_file, object_key):
    """上传备份文件到 S3"""
    if not os.path.exists(backup_file):
        log("❌ 文件不存在")
        return False

    file_size = os.path.getsize(backup_file)
    log(f"📦 文件大小: {format_size(file_size)}")

    log("⏳ 读取文件...")
    with open(backup_file, "rb") as f:
        file_content = f.read()

    uri = f"/{S3_BUCKET}/{object_key}"
    log(f"☁️  上传到: https://{S3_ENDPOINT}{uri}")

    response = s3_request("PUT", uri, file_content, {"Content-Type": "application/gzip"})

    if response.status == 200:
        log("✅ 上传成功 (200 OK)")
        return True
    else:
        log(f"❌ 上传失败: {response.status} {response.reason}")
        body = response.read().decode("utf-8")
        if body:
            log(body)
        return False


def cleanup_s3():
    """清理 S3 上过期的备份文件"""
    prefix = f"{S3_DIR}/{BACKUP_PREFIX}"
    uri = f"/{S3_BUCKET}?prefix={prefix}"

    log(f"🔍 列出 S3 文件 (前缀: {prefix})...")
    response = s3_request("GET", uri)

    if response.status != 200:
        log(f"❌ 列出文件失败: {response.status} {response.reason}")
        body = response.read().decode("utf-8")
        if body:
            log(body)
        return False

    body = response.read().decode("utf-8")

    # 解析 XML
    root = ET.fromstring(body)
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"

    contents = root.findall(f"{ns}Contents")
    if not contents:
        log("📭 S3 上没有找到备份文件")
        return True

    now = datetime.datetime.utcnow()
    cutoff = now - datetime.timedelta(days=KEEP_DAYS_S3)
    deleted_count = 0
    kept_count = 0

    log(f"📋 找到 {len(contents)} 个文件，清理 {KEEP_DAYS_S3} 天前的备份...")

    for item in contents:
        key = item.find(f"{ns}Key").text
        last_modified_str = item.find(f"{ns}LastModified").text
        last_modified_str = last_modified_str.replace("Z", "+00:00")
        try:
            last_modified = datetime.datetime.fromisoformat(
                last_modified_str.replace("+00:00", "")
            )
        except (ValueError, AttributeError):
            log(f"⚠️  无法解析时间，跳过: {key}")
            continue

        if last_modified < cutoff:
            delete_uri = f"/{S3_BUCKET}/{key}"
            log(f"🗑️  删除过期文件: {key}")
            del_resp = s3_request("DELETE", delete_uri)
            if del_resp.status in (200, 204):
                log("   ✅ 已删除")
                deleted_count += 1
            else:
                log(f"   ❌ 删除失败: {del_resp.status}")
                del_resp.read()
        else:
            kept_count += 1

    log(f"🧹 S3 清理完成: 删除 {deleted_count} 个，保留 {kept_count} 个")
    return True


def cleanup_local():
    """清理本地过期的备份文件"""
    log(f"🧹 清理本地 {KEEP_DAYS_LOCAL} 天前的旧备份...")
    now = datetime.datetime.now().timestamp()
    cutoff = now - KEEP_DAYS_LOCAL * 86400
    deleted = 0

    backup_dir = Path(BACKUP_PATH)
    for f in backup_dir.glob(f"{BACKUP_PREFIX}_*.tar.gz"):
        if f.is_file() and f.stat().st_mtime < cutoff:
            try:
                f.unlink()
                log(f"   🗑️  已删除: {f.name}")
                deleted += 1
            except Exception as e:
                log(f"   ⚠️  删除失败: {f.name} - {e}")

    log(f"✅ 本地清理完成，删除 {deleted} 个文件")


# ==================== 环境校验 ====================
def check_env():
    """校验必要的环境变量"""
    required = {
        "S3_BUCKET": S3_BUCKET,
        "S3_REGION": S3_REGION,
        "S3_ENDPOINT": S3_ENDPOINT,
        "S3_ACCESS_KEY": S3_ACCESS_KEY,
        "S3_SECRET_KEY": S3_SECRET_KEY,
    }
    missing = [k for k, v in required.items() if not v]
    if missing:
        error_exit(f"以下环境变量未在青龙面板中设置: {', '.join(missing)}")


# ==================== 主流程 ====================
def main():
    global LOG_FILE

    os.makedirs(BACKUP_PATH, exist_ok=True)
    LOG_FILE = os.path.join(BACKUP_PATH, "backup_www.log")

    log("=" * 42)
    log("🚀 开始备份任务 (tar.gz压缩)")
    log("=" * 42)

    # 1. 环境检查
    check_env()
    log("✅ 环境变量校验通过")

    if not os.path.isdir(WWW_PATH):
        error_exit(f"目录不存在: {WWW_PATH}")

    # 2. 生成时间戳和文件名
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_name = f"{BACKUP_PREFIX}_{timestamp}.tar.gz"
    backup_file = os.path.join(BACKUP_PATH, backup_name)

    # 3. 统计文件数量
    file_count = count_files(WWW_PATH)
    log(f"📊 待备份文件数: {file_count}")

    # 4. 打包压缩
    log("📦 正在打包压缩 www 目录...")
    log(f"📂 源目录: {WWW_PATH}")
    log(f"💾 目标文件: {backup_file}")

    try:
        create_backup(WWW_PATH, backup_file)
    except Exception as e:
        error_exit(f"打包失败: {e}")

    if not os.path.exists(backup_file):
        error_exit("打包失败: 文件未生成")

    # 5. 验证打包结果
    file_size = format_size(os.path.getsize(backup_file))
    archived_files = get_archive_count(backup_file)

    log("✅ 打包完成!")
    log(f"📦 文件大小: {file_size}")
    log(f"📊 已打包文件数: {archived_files}")

    # 6. 验证文件数量
    if archived_files < file_count:
        log(f"⚠️  警告: 打包文件数({archived_files})少于源文件数({file_count})")
    else:
        log("✅ 文件数量验证通过")

    # 7. 上传到 S3
    log("⏳ 正在上传到 Synology C2...")
    object_key = f"{S3_DIR}/{backup_name}"
    upload_ok = upload_to_s3(backup_file, object_key)

    if upload_ok:
        log("✨ 上传成功！")
    else:
        log("❌ 上传失败，请检查日志")

    # 8. 清理 S3 过期备份
    log(f"🧹 清理 S3 上 {KEEP_DAYS_S3} 天前的过期备份...")
    if cleanup_s3():
        log("✅ S3 过期清理完成")
    else:
        log("⚠️  S3 过期清理失败，请检查日志")

    # 9. 清理本地旧备份
    cleanup_local()

    # 10. 完成
    log("=" * 42)
    log("🎉 任务完成")
    log(f"📁 本地文件: {backup_file} ({file_size})")
    log(f"📊 备份文件数: {archived_files}")
    log(f"☁️  云端路径: {object_key}")
    log("=" * 42)

    # 发送通知
    notify_msg = (
        f"📁 本地文件: {backup_name} ({file_size})\n"
        f"📊 备份文件数: {archived_files}\n"
        f"☁️  云端路径: {object_key}\n"
        f"{'✅ 上传成功' if upload_ok else '❌ 上传失败'}"
    )
    notify_user("www目录备份", notify_msg)


if __name__ == "__main__":
    main()
