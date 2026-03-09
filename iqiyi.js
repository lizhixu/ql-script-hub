/*
爱奇艺全功能签到脚本 - 完整版
功能：签到、摇一摇、抽奖、白金抽奖、V7升级星钻
cron: 0 1 * * *
const $ = new Env('爱奇艺全功能签到');
*/

const axios = require('axios');
const crypto = require('crypto');
const notify = require('./sendNotify');

const IQIYI_COOKIES = process.env.IQIYI_COOKIE || '';
const NOTIFY_ENABLED = process.env.IQIYI_NOTIFY !== 'false';

class IqiyiCheckIn {
    constructor(cookie, index) {
        this.cookie = cookie;
        this.index = index;
        this.nickname = `账号${index}`;
        this.username = '';
        this.message = [];
        this.p00001 = '';
        this.p00002 = '';
        this.p00003 = '';
        this.dfp = '';
        this.qyid = '';
        
        this.parseCookie();
    }

    parseCookie() {
        const p00001Match = this.cookie.match(/P00001=([^;]+)/);
        const p00002Match = this.cookie.match(/P00002=([^;]+)/);
        const p00003Match = this.cookie.match(/P00003=([^;]+)/);
        const dfpMatch = this.cookie.match(/(?:__dfp|dfp)=([^;@]+)/);
        const qyidMatch = this.cookie.match(/QC005=([^;]+)/);

        this.p00001 = p00001Match ? p00001Match[1] : '';
        this.p00002 = p00002Match ? p00002Match[1] : '';
        this.p00003 = p00003Match ? p00003Match[1] : '';
        this.dfp = dfpMatch ? dfpMatch[1].split('@')[0] : '';
        this.qyid = qyidMatch ? qyidMatch[1] : '';
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 获取用户信息
    async getUserInfo() {
        try {
            if (this.p00002) {
                const userInfo = JSON.parse(decodeURIComponent(this.p00002));
                this.nickname = userInfo.nickname || `账号${this.index}`;
                this.username = userInfo.user_name || '';
                if (this.username) {
                    this.username = this.username.replace(this.username.substring(3, 7), '****');
                }
                console.log(`✅ [${this.nickname}] 获取用户信息成功`);
            }
        } catch (e) {
            console.log(`⚠️ [账号${this.index}] 解析用户信息失败: ${e.message}`);
            this.nickname = `账号${this.index}`;
            this.username = '未获取到';
        }
    }

    // 查询VIP信息
    async queryVipInfo() {
        try {
            await this.sleep(3000);
            const url = 'http://serv.vip.iqiyi.com/vipgrowth/query.action';
            const response = await axios.get(url, {
                params: { P00001: this.p00001 },
                timeout: 10000
            });

            if (response.data?.code === 'A00000') {
                const data = response.data.data || {};
                return {
                    level: data.level || 0,
                    growthvalue: data.growthvalue || 0,
                    distance: data.distance || 0,
                    deadline: data.deadline || '非 VIP 用户',
                    todayGrowthValue: data.todayGrowthValue || 0
                };
            }
            return null;
        } catch (error) {
            console.log(`⚠️ [${this.nickname}] 查询VIP信息失败: ${error.message}`);
            return null;
        }
    }

    // 摇一摇抽奖（递归）
    async lottery(awardList = []) {
        try {
            const url = 'https://act.vip.iqiyi.com/shake-api/lottery';
            const params = {
                P00001: this.p00001,
                deviceID: this.generateUUID(),
                version: '15.3.0',
                platform: this.generateUUID().substring(0, 16),
                lotteryType: '0',
                actCode: '0k9GkUcjqqj4tne8',
                extendParams: JSON.stringify({
                    appIds: 'iqiyi_pt_vip_iphone_video_autorenew_12m_348yuan_v2',
                    supportSk2Identity: true,
                    testMode: '0',
                    iosSystemVersion: '17.4',
                    bundleId: 'com.qiyi.iphone'
                })
            };

            const response = await axios.get(url, { params, timeout: 10000 });
            
            if (response.data?.code === 'A00000') {
                const awardInfo = response.data.data?.title || '未知奖励';
                awardList.push(awardInfo);
                console.log(`🎉 [${this.nickname}] 摇一摇获得: ${awardInfo}`);
                await this.sleep(3000);
                return await this.lottery(awardList);
            } else if (response.data?.msg === '抽奖次数用完') {
                return awardList.length > 0 ? awardList.join('、') : '抽奖次数用完';
            } else {
                return response.data?.msg || '摇一摇失败';
            }
        } catch (error) {
            console.log(`⚠️ [${this.nickname}] 摇一摇异常: ${error.message}`);
            return awardList.length > 0 ? awardList.join('、') : '摇一摇失败';
        }
    }

    // 查询抽奖次数或抽奖
    async draw(drawType) {
        try {
            const url = 'https://iface2.iqiyi.com/aggregate/3.0/lottery_activity';
            const params = {
                app_k: 'b398b8ccbaeacca840073a7ee9b7e7e6',
                app_v: '11.6.5',
                platform_id: 10,
                dev_os: '8.0.0',
                dev_ua: 'FRD-AL10',
                net_sts: 1,
                qyid: '2655b332a116d2247fac3dd66a5285011102',
                psp_uid: this.p00003,
                psp_cki: this.p00001,
                psp_status: 3,
                secure_v: 1,
                secure_p: 'GPhone',
                req_sn: Date.now()
            };

            if (drawType === 0) {
                params.lottery_chance = 1;
            }

            const response = await axios.get(url, { params, timeout: 10000 });
            
            if (!response.data?.code) {
                const chance = parseInt(response.data.daysurpluschance || 0);
                const msg = response.data.awardName || '';
                return { status: true, msg, chance };
            } else {
                const msg = response.data.kv?.msg || response.data.errorReason || '抽奖失败';
                return { status: false, msg, chance: 0 };
            }
        } catch (error) {
            console.log(`⚠️ [${this.nickname}] 抽奖异常: ${error.message}`);
            return { status: false, msg: error.message, chance: 0 };
        }
    }

    // V7免费升级星钻
    async levelRight() {
        try {
            const url = 'https://act.vip.iqiyi.com/level-right/receive';
            const data = {
                code: 'k8sj74234c683f',
                P00001: this.p00001
            };

            const response = await axios.post(url, data, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 10000
            });

            return response.data?.msg || '升级失败';
        } catch (error) {
            console.log(`⚠️ [${this.nickname}] V7升级异常: ${error.message}`);
            return error.message;
        }
    }

    // 增加抽奖次数
    async giveTimes() {
        try {
            const url = 'https://pcell.iqiyi.com/lotto/giveTimes';
            const timesCodeList = ['browseWeb', 'browseWeb', 'bookingMovie'];
            
            for (const timesCode of timesCodeList) {
                const params = {
                    actCode: 'bcf9d354bc9f677c',
                    timesCode: timesCode,
                    P00001: this.p00001
                };
                await axios.get(url, { params, timeout: 5000 }).catch(() => {});
                await this.sleep(500);
            }
        } catch (error) {
            console.log(`⚠️ [${this.nickname}] 增加抽奖次数失败: ${error.message}`);
        }
    }

    // 白金抽奖
    async lottoLottery() {
        try {
            await this.giveTimes();
            const giftList = [];
            const url = 'https://pcell.iqiyi.com/lotto/lottery';
            
            for (let i = 0; i < 5; i++) {
                const params = {
                    actCode: 'bcf9d354bc9f677c',
                    P00001: this.p00001
                };
                
                try {
                    const response = await axios.get(url, { params, timeout: 10000 });
                    const giftName = response.data?.data?.giftName || '';
                    if (giftName && !giftName.includes('未中奖')) {
                        giftList.push(giftName);
                    }
                    await this.sleep(1000);
                } catch (e) {
                    console.log(`⚠️ [${this.nickname}] 白金抽奖第${i+1}次失败`);
                }
            }

            return giftList.length > 0 ? giftList.join('、') : '未中奖';
        } catch (error) {
            console.log(`⚠️ [${this.nickname}] 白金抽奖异常: ${error.message}`);
            return '白金抽奖失败';
        }
    }

    async main() {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`开始处理 [账号${this.index}]`);
        console.log(`${'='.repeat(50)}\n`);

        if (!this.p00001) {
            console.log(`❌ [账号${this.index}] Cookie无效，缺少P00001字段`);
            return `【账号${this.index}】\nCookie无效，请重新获取`;
        }

        // 1. 获取用户信息
        await this.getUserInfo();
        this.message.push(`👤 用户账号: ${this.username}`);
        this.message.push(`📝 用户昵称: ${this.nickname}`);

        // 2. 查询初始VIP信息
        console.log(`📊 [${this.nickname}] 查询VIP信息...`);
        const vipInfo = await this.queryVipInfo();
        if (vipInfo) {
            this.message.push(`🏆 VIP等级: LV${vipInfo.level}`);
            this.message.push(`💎 当前成长值: ${vipInfo.growthvalue}`);
            this.message.push(`📈 今日成长值: ${vipInfo.todayGrowthValue}`);
            this.message.push(`⬆️ 升级还需: ${vipInfo.distance}`);
            this.message.push(`⏰ VIP到期: ${vipInfo.deadline}`);
        }

        // 3. 白金抽奖
        console.log(`🎰 [${this.nickname}] 开始白金抽奖...`);
        const lottoResult = await this.lottoLottery();
        this.message.push(`🎰 白金抽奖: ${lottoResult}`);

        // 4. V7免费升级星钻
        if (vipInfo && vipInfo.deadline !== '非 VIP 用户') {
            console.log(`💎 [${this.nickname}] V7免费升级星钻...`);
            const levelRightResult = await this.levelRight();
            this.message.push(`💎 V7升级星钻: ${levelRightResult}`);
        } else {
            this.message.push(`💎 V7升级星钻: 非VIP用户`);
        }

        // 5. 查询抽奖次数
        console.log(`🎲 [${this.nickname}] 查询抽奖次数...`);
        const chanceResult = await this.draw(0);
        const chance = chanceResult.chance;

        // 6. 执行抽奖
        if (chance > 0) {
            console.log(`🎲 [${this.nickname}] 开始抽奖，剩余${chance}次...`);
            const drawMsgs = [];
            for (let i = 0; i < chance; i++) {
                const result = await this.draw(1);
                if (result.status && result.msg) {
                    drawMsgs.push(result.msg);
                }
                await this.sleep(1000);
            }
            this.message.push(`🎁 抽奖奖励: ${drawMsgs.length > 0 ? drawMsgs.join('、') : '无'}`);
        } else {
            this.message.push(`🎁 抽奖奖励: 抽奖机会不足`);
        }

        // 7. 摇一摇
        console.log(`🎲 [${this.nickname}] 开始摇一摇...`);
        const lotteryResult = await this.lottery();
        this.message.push(`🎉 每天摇一摇: ${lotteryResult}`);

        // 8. 查询最终VIP信息
        console.log(`📊 [${this.nickname}] 查询最终VIP信息...`);
        const finalVipInfo = await this.queryVipInfo();
        if (finalVipInfo) {
            this.message.push(`\n📊 最终状态:`);
            this.message.push(`🏆 VIP等级: LV${finalVipInfo.level}`);
            this.message.push(`💎 当前成长值: ${finalVipInfo.growthvalue}`);
            this.message.push(`⏰ VIP到期: ${finalVipInfo.deadline}`);
        }

        return `【${this.nickname}】\n${this.message.join('\n')}`;
    }
}

async function main() {
    console.log('\n🚀 爱奇艺全功能签到脚本开始运行...\n');
    console.log(`⏰ 运行时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`);

    if (!IQIYI_COOKIES) {
        console.log('❌ 未配置 IQIYI_COOKIE 环境变量！');
        return;
    }

    const cookies = IQIYI_COOKIES.split(/[&\n]+/).map(c => c.trim()).filter(c => c);
    console.log(`📝 共找到 ${cookies.length} 个账号\n`);

    const results = [];
    for (let i = 0; i < cookies.length; i++) {
        const iqiyi = new IqiyiCheckIn(cookies[i], i + 1);
        const result = await iqiyi.main();
        results.push(result);
        if (i < cookies.length - 1) {
            console.log('\n⏳ 等待3秒后处理下一个账号...\n');
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    if (NOTIFY_ENABLED && results.length > 0) {
        await notify.sendNotify('🎬 爱奇艺全功能签到', results.join('\n\n' + '='.repeat(30) + '\n\n'));
    }

    console.log('\n✨ 所有账号处理完成！\n');
}

main().catch(error => {
    console.error('❌ 脚本执行出错:', error);
    process.exit(1);
});