#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
cron: 01 5 * * *
new Env('有道云笔记签到')
青龙脚本：有道云笔记签到
变量名：YOUDAO_COOKIE
支持多个账号，使用 & 或换行分隔
"""

import os
import sys
import requests


class YouDao:
    def __init__(self, cookie_str: str):
        self.cookie_str = cookie_str.strip()
        self.cookies = self.cookie_to_dict(self.cookie_str)
        self.uid = self.get_uid()

    @staticmethod
    def cookie_to_dict(cookie_str: str):
        cookie_dict = {}
        for kv in cookie_str.split(";"):
            kv = kv.strip()
            if not kv:
                continue
            key, _, value = kv.partition("=")
            cookie_dict[key.strip()] = value.strip()
        return cookie_dict

    def get_uid(self):
        try:
            ynote_pers = self.cookies.get("YNOTE_PERS", "")
            uid = ynote_pers.split("||")[-2]
            return uid if uid else "未获取到账号信息"
        except Exception as e:
            print(f"获取账号信息失败: {e}")
            return "未获取到账号信息"

    def sign(self):
        session = requests.Session()
        session.cookies.update(self.cookies)
        youdao_message = "签到失败"

        try:
            refresh_url = "http://note.youdao.com/login/acc/pe/getsess?product=YNOTE"
            res = session.get(refresh_url, timeout=10)
            session.cookies.update(res.cookies)

            sync_url = "https://note.youdao.com/yws/api/daupromotion?method=sync"
            sync_res = session.post(sync_url, timeout=10)
            if "error" in sync_res.text:
                return "Cookie 可能过期"

            checkin_url = "https://note.youdao.com/yws/mapi/user?method=checkin"
            checkin_res = session.post(checkin_url, timeout=10)

            ad_space = 0
            ad_url = "https://note.youdao.com/yws/mapi/user?method=adRandomPrompt"
            for _ in range(3):
                ad_res = session.post(ad_url, timeout=10)
                ad_space += ad_res.json().get("space", 0) // 1048576

            if "reward" in sync_res.text:
                sync_space = sync_res.json().get("rewardSpace", 0) // 1048576
                checkin_space = checkin_res.json().get("space", 0) // 1048576
                total_space = sync_space + checkin_space + ad_space
                youdao_message = f"+{total_space}M"
            else:
                youdao_message = "获取失败"
        except Exception as e:
            youdao_message = f"请求异常: {e}"
        finally:
            session.close()

        return youdao_message

    def run(self):
        result = self.sign()
        return f"帐号信息: {self.uid}\n获取空间: {result}"


def load_cookies():
    env_cookie = os.environ.get("YOUDAO_COOKIE")
    if not env_cookie:
        print("未检测到环境变量 YOUDAO_COOKIE")
        sys.exit(0)

    delimiter = "&" if "&" in env_cookie else "\n"
    cookie_list = [ck.strip() for ck in env_cookie.strip().split(delimiter) if ck.strip()]
    if not cookie_list:
        print("YOUDAO_COOKIE 变量内容为空")
        sys.exit(0)
    return cookie_list


def main():
    cookie_list = load_cookies()
    results = []
    for index, cookie_str in enumerate(cookie_list, start=1):
        print(f"\n====== 开始执行账号 {index} ======")
        youdao = YouDao(cookie_str)
        result = youdao.run()
        print(result)
        results.append(f"账号{index}：\n{result}")

    return "\n\n".join(results)


if __name__ == "__main__":
    final_message = main()