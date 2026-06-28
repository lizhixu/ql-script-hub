/*
Vortexa Free Hosting 领取脚本
cron: 1,11,21,31,41,51 * * * *
const $ = new Env('Vortexa Free Hosting');
*/

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

const env = process.env;

const API_BASE = trimTrailingSlash(env.VORTEXA_API_BASE || 'https://api.vortexa.cloud/api');
const ORIGIN = env.VORTEXA_ORIGIN || 'https://www.vortexa.cloud';
const REFERER = env.VORTEXA_REFERER || 'https://www.vortexa.cloud/free-hosting';
const TIMEOUT_MS = toInt(env.VORTEXA_TIMEOUT_MS, 30000);
const CONFIRM_DELAY_SECONDS = toInt(env.VORTEXA_CONFIRM_DELAY_SECONDS, 5);
const INTERVAL_MIN_SECONDS = toInt(env.VORTEXA_INTERVAL_MIN_SECONDS, toInt(env.VORTEXA_INTERVAL_SECONDS, 30));
const INTERVAL_MAX_SECONDS = toInt(env.VORTEXA_INTERVAL_MAX_SECONDS, Math.max(INTERVAL_MIN_SECONDS, 60));
const DRY_RUN = isTrue(env.VORTEXA_DRY_RUN);
const LIST_PRODUCTS = isTrue(env.VORTEXA_LIST_PRODUCTS);
const LOOP = env.VORTEXA_LOOP === undefined ? true : isTrue(env.VORTEXA_LOOP);
const LOGIN_PAIR = parseLoginPair(env.VORTEXA_LOGIN || env.VORTEXA_ACCOUNT_PASSWORD || '');
const ACCOUNT = LOGIN_PAIR.account || env.VORTEXA_ACCOUNT || env.VORTEXA_EMAIL || env.VORTEXA_USERNAME || '';
const PASSWORD = LOGIN_PAIR.password || env.VORTEXA_PASSWORD || '';
const LOGIN_FIELD = (env.VORTEXA_LOGIN_FIELD || '').trim();
const FINGERPRINT = env.VORTEXA_FINGERPRINT || randomHex(16);
const RAW_COOKIE = env.VORTEXA_COOKIE || '';
const USER_AGENT = env.VORTEXA_USER_AGENT || randomWindowsChromeUA();
const UA_MAJOR = parseChromeMajor(USER_AGENT) || 148;

let accessToken = env.VORTEXA_TOKEN || env.VORTEXA_ACCESS_TOKEN || '';
let refreshToken = env.VORTEXA_REFRESH || getCookieValue(RAW_COOKIE, 'openbot_refresh') || '';
let cookieHeader = RAW_COOKIE || (refreshToken ? `openbot_refresh=${refreshToken}` : '');

main().catch((error) => {
  console.error(`[失败] ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  console.log('[开始] Vortexa Free Hosting 自动检查/领取');

  do {
    const done = await runOnce();
    if (!LOOP || done) {
      break;
    }

    const seconds = randomInt(INTERVAL_MIN_SECONDS, INTERVAL_MAX_SECONDS);
    console.log(`[等待] ${seconds} 秒后继续扫描库存`);
    await sleep(seconds * 1000);
  } while (true);
}

async function runOnce() {
  if (LIST_PRODUCTS) {
    await printFreeProducts();
    return true;
  }

  if (!accessToken) {
    if (ACCOUNT && PASSWORD) {
      await loginWithPassword();
    } else if (cookieHeader) {
      await refreshAccessToken();
    } else {
      throw new Error('缺少登录信息：请设置 VORTEXA_LOGIN，格式为 账号@密码');
    }
  }

  const currentStatus = await apiJson('GET', '/hosting/free/status', { auth: true });

  if (hasFreeService(currentStatus)) {
    printOwnedService(currentStatus);
    return true;
  }

  const stock = await apiJson('GET', '/platform/free/stock-status', { auth: false });
  printStockSummary(stock);

  if (isStockFull(stock)) {
    console.log(LOOP ? '[库存] 暂无库存，继续等待' : '[库存] 暂无库存，脚本结束');
    return false;
  }

  if (currentStatus && currentStatus.can_get_free_server === false && !hasFreeService(currentStatus)) {
    console.log('[结果] 当前账号暂时不满足免费领取条件');
    return true;
  }

  const selection = await resolveProductSelection();
  console.log(`[产品] 已选择：${selection.product.name || selection.product.slug || selection.product.id}`);

  const body = {
    product_id: selection.product.id,
    plan_id: selection.plan.id,
  };

  if (DRY_RUN) {
    console.log(`[试运行] product_id=${body.product_id}, plan_id=${body.plan_id}`);
    return true;
  }

  console.log('[领取] 检测到库存，开始领取');
  const purchase = await apiJson('POST', '/hosting/free/purchase', {
    auth: true,
    body,
  });

  if (purchase && (purchase.error || purchase.message === 'Request failed')) {
    throw new Error(`领取失败：${purchase.error || purchase.message}`);
  }

  if (CONFIRM_DELAY_SECONDS > 0) {
    await sleep(CONFIRM_DELAY_SECONDS * 1000);
  }

  const confirmStatus = await apiJson('GET', '/hosting/free/status', { auth: true });

  if (hasFreeService(confirmStatus) || purchase) {
    console.log('[完成] 领取请求已提交');
    printOwnedService(confirmStatus);
  }

  return true;
}

async function resolveProductSelection() {
  if (env.VORTEXA_PRODUCT_ID && env.VORTEXA_PLAN_ID) {
    return {
      product: { id: env.VORTEXA_PRODUCT_ID, name: 'env product' },
      plan: { id: env.VORTEXA_PLAN_ID },
    };
  }

  console.log('[产品] 拉取免费产品列表');
  const productsPayload = await apiJson('GET', '/hosting/products/free', { auth: false });
  const products = normalizeArray(productsPayload)
    .filter((product) => product && typeof product === 'object')
    .filter((product) => product.slug?.startsWith('free-') || getFreePlan(product));

  if (!products.length) {
    throw new Error('没有从 /hosting/products/free 找到可用免费产品');
  }

  let product = null;

  if (env.VORTEXA_PRODUCT_ID) {
    product = products.find((item) => String(item.id) === String(env.VORTEXA_PRODUCT_ID));
  }

  if (!product && env.VORTEXA_PRODUCT_SLUG) {
    const slug = env.VORTEXA_PRODUCT_SLUG.toLowerCase();
    product = products.find((item) => String(item.slug || '').toLowerCase() === slug);
  }

  if (!product && env.VORTEXA_PRODUCT_NAME) {
    const keyword = env.VORTEXA_PRODUCT_NAME.toLowerCase();
    product = products.find((item) => String(item.name || '').toLowerCase().includes(keyword));
  }

  if (!product) {
    product = products[0];
  }

  const plan =
    (env.VORTEXA_PLAN_ID && (product.plans || []).find((item) => String(item.id) === String(env.VORTEXA_PLAN_ID))) ||
    getFreePlan(product);

  if (!plan) {
    throw new Error(`产品 ${product.name || product.id} 没有找到免费 plan_id`);
  }

  return { product, plan };
}

async function printFreeProducts() {
  console.log('[产品] 只列出免费产品，不提交领取');
  const productsPayload = await apiJson('GET', '/hosting/products/free', { auth: false });
  const products = normalizeArray(productsPayload)
    .filter((product) => product && typeof product === 'object')
    .filter((product) => product.slug?.startsWith('free-') || getFreePlan(product));

  if (!products.length) {
    console.log('[产品] 没有找到免费产品');
    printJson('产品接口原始返回', productsPayload);
    return;
  }

  for (const product of products) {
    console.log('----------------------------------------');
    console.log(`[产品] name=${product.name || ''}`);
    console.log(`[产品] slug=${product.slug || ''}`);
    console.log(`[产品] product_id=${product.id}`);

    const plans = Array.isArray(product.plans) ? product.plans : [];
    const freePlans = plans.filter((plan) => plan.type === 'free' || Number(plan.price) === 0);
    if (!freePlans.length) {
      console.log('[套餐] 没有免费 plan');
      continue;
    }

    for (const plan of freePlans) {
      console.log(`[套餐] plan_id=${plan.id}, name=${plan.name || ''}, type=${plan.type || ''}, price=${plan.price ?? ''}`);
    }
  }

  console.log('----------------------------------------');
  console.log('[提示] 想领 Node.js 可直接设置 VORTEXA_PRODUCT_NAME=node，不一定要手填 product_id。');
}

async function apiJson(method, pathOrUrl, options = {}) {
  const result = await apiRequest(method, pathOrUrl, options);

  if ((result.status === 401 || result.status === 403) && options.auth && !options._retried) {
    console.log('[登录] 登录状态失效，重新登录');
    await ensureFreshAccessToken();
    return apiJson(method, pathOrUrl, { ...options, _retried: true });
  }

  if (isCloudflarePage(result)) {
    throw new Error(
      `请求被 Cloudflare 拦截：HTTP ${result.status}。请先在浏览器正常通过验证，再重新复制 token/cookie/fingerprint。`
    );
  }

  const text = String(result.text || '').trim();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error(`${pathOrUrl} 返回的不是 JSON：HTTP ${result.status} ${shortText(text, 500)}`);
    }
  }

  if (result.status >= 400) {
    const message = data?.error || data?.message || shortText(text, 300);
    console.error(`[调试] 请求详情: ${method} ${pathOrUrl}`);
    console.error(`[调试] 状态码: ${result.status}`);
    console.error(`[调试] 响应头:`, JSON.stringify(result.headers, null, 2));
    console.error(`[调试] 响应体: ${shortText(text, 500)}`);
    throw new Error(`${pathOrUrl} HTTP ${result.status}：${message}`);
  }

  return data;
}

async function ensureFreshAccessToken() {
  accessToken = '';

  if (ACCOUNT && PASSWORD) {
    await loginWithPassword();
    return;
  }

  if (cookieHeader) {
    await refreshAccessToken();
    return;
  }

  throw new Error('登录已失效，且没有账号密码或 openbot_refresh 可用于重新登录');
}

async function apiRequest(method, pathOrUrl, options = {}) {
  const url = pathOrUrl.startsWith('http') ? new URL(pathOrUrl) : new URL(`${API_BASE}${pathOrUrl}`);
  const headers = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en,zh-CN;q=0.9,zh;q=0.8',
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    origin: ORIGIN,
    pragma: 'no-cache',
    referer: REFERER,
    'user-agent': USER_AGENT,
    'x-fingerprint': FINGERPRINT,
    'sec-ch-ua': `"Chromium";v="${UA_MAJOR}", "Google Chrome";v="${UA_MAJOR}", "Not/A)Brand";v="99"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };

  if (cookieHeader && (options.auth || options.cookie !== false)) {
    headers.cookie = cookieHeader;
  }

  if (options.auth) {
    if (!accessToken) {
      throw new Error('缺少 VORTEXA_TOKEN，且 refresh 没有拿到新的 access token');
    }
    headers.authorization = `Bearer ${accessToken}`;
  }

  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  const body = options.body === undefined ? null : JSON.stringify(options.body);
  if (body) {
    headers['content-length'] = Buffer.byteLength(body);
  }

  return request(method, url, headers, body);
}

async function loginWithPassword() {
  if (!ACCOUNT || !PASSWORD) {
    throw new Error('账号密码登录需要 VORTEXA_LOGIN，格式为 账号@密码');
  }

  const body = buildLoginBody();
  const result = await apiRequest('POST', '/auth/login', {
    auth: false,
    body,
    cookie: true,
  });

  if (isCloudflarePage(result)) {
    throw new Error('账号密码登录被 Cloudflare 拦截，请先在浏览器确认该接口不需要人机验证');
  }

  let data = null;
  try {
    data = JSON.parse(String(result.text || '{}'));
  } catch (_) {
    throw new Error(`登录返回异常：${shortText(result.text, 300)}`);
  }

  if (result.status >= 400 || !data.accessToken) {
    const message = data.error || data.message || shortText(result.text, 300);
    throw new Error(`登录失败：HTTP ${result.status} ${message}`);
  }

  accessToken = data.accessToken;
  mergeSetCookie(result.headers['set-cookie']);
  console.log(`[登录] 登录成功：${data.user?.email || ACCOUNT}`);
}

async function refreshAccessToken() {
  if (!cookieHeader) {
    throw new Error('无法刷新 token：缺少 openbot_refresh Cookie');
  }

  const result = await apiRequest('POST', '/auth/refresh', {
    auth: false,
    headers: {
      'x-requested-with': 'XMLHttpRequest',
    },
  });

  if (isCloudflarePage(result)) {
    throw new Error('刷新 token 被 Cloudflare 拦截，请先在浏览器通过验证后重新复制 Cookie');
  }

  let data = null;
  try {
    data = JSON.parse(String(result.text || '{}'));
  } catch (_) {
    throw new Error(`刷新 token 返回异常：${shortText(result.text, 300)}`);
  }

  if (result.status >= 400 || !data.accessToken) {
    throw new Error(`刷新 token 失败：HTTP ${result.status} ${data.error || data.message || shortText(result.text, 300)}`);
  }

  accessToken = data.accessToken;
  mergeSetCookie(result.headers['set-cookie']);
  console.log('[登录] 登录成功');
}

function request(method, url, headers, body) {
  const transport = url.protocol === 'http:' ? http : https;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        method,
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            text: decodeBody(buffer, res.headers['content-encoding']),
          });
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error(`请求超时：${url.toString()}`)));
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function printOwnedService(data) {
  if (data?.service) {
    const service = data.service;
    console.log(`[结果] 已有免费服务：${service.name || service.id || '已开通'}`);
    return;
  }

  console.log('[结果] 账号已经有免费服务');
}

function printStockSummary(data) {
  const stock = data?.free_stock || data;
  if (!stock || typeof stock !== 'object') {
    console.log('[库存] 未获取到库存信息');
    return;
  }

  const available = stock.available ?? stock.remain ?? stock.left;
  const used = stock.used;
  const limit = stock.global_limit ?? stock.limit;

  console.log(`[库存] 已使用 ${used ?? '未知'} 台 / 限制 ${limit ?? '未知'} 台 / 剩余 ${available ?? '未知'} 台`);
}

function printJson(label, data) {
  console.log(`[${label}] ${JSON.stringify(data)}`);
}

function normalizeArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.products)) {
    return payload.products;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  return [];
}

function buildLoginBody() {
  const field = getLoginField();
  const body = {
    password: PASSWORD,
  };

  body[field] = ACCOUNT;

  if (field !== 'email' && looksLikeEmail(ACCOUNT)) {
    body.email = ACCOUNT;
  }

  return body;
}

function parseLoginPair(value) {
  const text = String(value || '').trim();
  if (!text) {
    return { account: '', password: '' };
  }

  const index = text.lastIndexOf('@');
  if (index <= 0 || index === text.length - 1) {
    return { account: '', password: '' };
  }

  return {
    account: text.slice(0, index),
    password: text.slice(index + 1),
  };
}

function getLoginField() {
  if (LOGIN_FIELD) {
    return LOGIN_FIELD;
  }
  return looksLikeEmail(ACCOUNT) ? 'email' : 'username';
}

function mergeSetCookie(setCookie) {
  if (!setCookie) {
    return;
  }

  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  const jar = parseCookieHeader(cookieHeader);

  for (const item of values) {
    const first = String(item).split(';')[0];
    const index = first.indexOf('=');
    if (index <= 0) {
      continue;
    }
    jar.set(first.slice(0, index), first.slice(index + 1));
  }

  cookieHeader = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  refreshToken = getCookieValue(cookieHeader, 'openbot_refresh') || refreshToken;
}

function parseCookieHeader(cookie) {
  const jar = new Map();
  String(cookie || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const index = item.indexOf('=');
      if (index > 0) {
        jar.set(item.slice(0, index), item.slice(index + 1));
      }
    });
  return jar;
}

function getFreePlan(product) {
  return (product.plans || []).find((plan) => plan.type === 'free' || Number(plan.price) === 0);
}

function hasFreeService(data) {
  return Boolean(data?.has_free_server || data?.service);
}

function isStockFull(data) {
  const stock = data?.free_stock || data;
  if (!stock || typeof stock !== 'object') {
    return false;
  }

  if (stock.is_full === true) {
    return true;
  }

  const available = Number(stock.available);
  if (Number.isFinite(available) && available <= 0) {
    return true;
  }

  const used = Number(stock.used);
  const limit = Number(stock.global_limit ?? stock.limit);
  return Number.isFinite(used) && Number.isFinite(limit) && limit > 0 && used >= limit;
}

function isCloudflarePage(result) {
  const server = String(result.headers?.server || '').toLowerCase();
  const text = String(result.text || '').toLowerCase();
  return (
    server.includes('cloudflare') &&
    (text.includes('cf-ray') ||
      text.includes('cloudflare') ||
      text.includes('attention required') ||
      text.includes('just a moment'))
  );
}

function decodeBody(buffer, encoding) {
  try {
    if (encoding === 'gzip') {
      return zlib.gunzipSync(buffer).toString('utf8');
    }
    if (encoding === 'deflate') {
      return zlib.inflateSync(buffer).toString('utf8');
    }
    if (encoding === 'br' && zlib.brotliDecompressSync) {
      return zlib.brotliDecompressSync(buffer).toString('utf8');
    }
  } catch (_) {
    return buffer.toString('utf8');
  }
  return buffer.toString('utf8');
}

function getCookieValue(cookie, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match ? match[1] : '';
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function shortText(text, limit = 300) {
  return String(text || '').replace(/\s+/g, ' ').slice(0, limit);
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isTrue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function randomWindowsChromeUA() {
  const versions = [
    '148.0.0.0',
    '149.0.0.0',
  ];
  const version = versions[randomInt(0, versions.length - 1)];
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

function parseChromeMajor(userAgent) {
  const match = String(userAgent || '').match(/Chrome\/(\d+)/i);
  return match ? Number(match[1]) : null;
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomInt(min, max) {
  const low = Math.ceil(Math.min(Number(min) || 0, Number(max) || 0));
  const high = Math.floor(Math.max(Number(min) || 0, Number(max) || 0));
  if (high <= low) {
    return low;
  }
  return low + Math.floor(Math.random() * (high - low + 1));
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}