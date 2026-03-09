/*
V2EX 论坛自动签到
cron: 8 5 * * *
const $ = new Env('V2EX论坛签到');
*/

const axios = require('axios');
const { sendNotify } = require('./sendNotify');

// 环境变量配置
const V2EX_COOKIE = process.env.V2EX_COOKIE || '';
const V2EX_PROXY = process.env.V2EX_PROXY || '';

class V2exCheckIn {
    constructor(cookie, proxy = '') {
        this.cookie = cookie;
        this.proxy = proxy;
        this.name = 'V2EX论坛';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Cookie': cookie
        };
        
        // 配置 axios 实例
        this.axiosConfig = {
            headers: this.headers,
            timeout: 30000,
            validateStatus: () => true
        };
        
        if (proxy) {
            this.axiosConfig.proxy = false;
            this.axiosConfig.httpsAgent = new (require('https').Agent)({
                rejectUnauthorized: false
            });
        }
    }

    async sign() {
        try {
            // 访问签到页面
            const dailyResponse = await axios.get('https://www.v2ex.com/mission/daily', this.axiosConfig);
            
            if (dailyResponse.status !== 200) {
                return { success: false, message: 'Cookie 可能已过期，请重新获取' };
            }

            // 提取签到链接
            const pattern = /<input type="button" class="super normal button" value=".*?" onclick="location\.href = '(.*?)';"/;
            const match = dailyResponse.data.match(pattern);
            
            if (!match) {
                // 可能已经签到
                return await this.getBalance();
            }

            const signUrl = match[1];
            
            if (signUrl === '/balance') {
                // 已经签到过了
                return await this.getBalance();
            }

            // 执行签到
            const once = signUrl.split('=').pop();
            await axios.get(`https://www.v2ex.com${signUrl}`, {
                ...this.axiosConfig,
                headers: {
                    ...this.headers,
                    'Referer': 'https://www.v2ex.com/mission/daily'
                },
                params: { once }
            });

            // 获取签到结果
            return await this.getBalance();

        } catch (error) {
            console.log('签到出错:', error.message);
            return { success: false, message: `签到失败: ${error.message}` };
        }
    }

    async getBalance() {
        try {
            // 获取余额页面
            const balanceResponse = await axios.get('https://www.v2ex.com/balance', this.axiosConfig);
            const html = balanceResponse.data;

            // 提取用户名
            const usernameMatch = html.match(/<a href="\/member\/.*?" class="top">(.*?)<\/a>/);
            const username = usernameMatch ? usernameMatch[1] : '未知用户';

            // 提取总余额
            const totalMatch = html.match(/<td class="d" style="text-align: right;">(\d+\.\d+)<\/td>/);
            const total = totalMatch ? totalMatch[1] : '0';

            // 提取今日签到信息
            const todayMatch = html.match(/<td class="d"><span class="gray">(.*?)<\/span><\/td>/);
            const today = todayMatch ? todayMatch[1] : '未签到';

            // 获取连续签到天数
            const dailyResponse = await axios.get('https://www.v2ex.com/mission/daily', this.axiosConfig);
            const daysMatch = dailyResponse.data.match(/<div class="cell">(.*?)天<\/div>/);
            const days = daysMatch ? `${daysMatch[1]}天` : '未知';

            return {
                success: true,
                username,
                today,
                total,
                days
            };

        } catch (error) {
            console.log('获取余额出错:', error.message);
            return { success: false, message: `获取信息失败: ${error.message}` };
        }
    }

    async main() {
        console.log(`\n开始执行 ${this.name} 签到任务`);
        const result = await this.sign();
        
        if (result.success) {
            const message = [
                `账号信息: ${result.username}`,
                `今日签到: ${result.today}`,
                `账号余额: ${result.total}`,
                `签到天数: ${result.days}`
            ].join('\n');
            
            console.log(message);
            return { success: true, message };
        } else {
            console.log(result.message);
            return result;
        }
    }
}

async function main() {
    if (!V2EX_COOKIE) {
        console.log('❌ 请配置 V2EX_COOKIE 环境变量');
        return;
    }

    // 支持多账号，用 & 或 \n 分隔
    const cookies = V2EX_COOKIE.split(/[&\n]/).filter(item => item.trim());
    console.log(`共找到 ${cookies.length} 个账号\n`);

    const results = [];
    
    for (let i = 0; i < cookies.length; i++) {
        console.log(`\n========== 账号 ${i + 1} ==========`);
        const checker = new V2exCheckIn(cookies[i].trim(), V2EX_PROXY);
        const result = await checker.main();
        results.push(`账号${i + 1}:\n${result.message}`);
        
        // 延迟避免请求过快
        if (i < cookies.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    // 发送通知
    const notifyMessage = results.join('\n\n');
    await sendNotify('V2EX论坛签到', notifyMessage);
}

main().catch(console.error);