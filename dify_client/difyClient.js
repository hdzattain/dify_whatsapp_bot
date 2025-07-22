const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

// Dify API 配置 - 请替换为你的实际配置
const DIFY_API_KEY = 'app-s2bwyQ0UQ9DJ5pUZXuUeDPyS'; // 替换为你的 Dify API Key
const DIFY_WORKFLOW_ID = '7d956ded-e3d8-4ebc-94ac-d6e915f7c42f'; // 替换为你的 Workflow ID
const DIFY_BASE_URL = 'https://api.dify.ai/v1'; // Dify API 基础URL

// Dify 客户端
const difyClient = {
    async runWorkflow(query, userId) {
        try {
            const response = await fetch(`${DIFY_BASE_URL}/workflows/${DIFY_WORKFLOW_ID}/runs`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${DIFY_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    inputs: {
                        query: query
                    },
                    user: userId
                })
            });

            if (!response.ok) {
                throw new Error(`Dify API 请求失败: ${response.status}`);
            }

            const data = await response.json();
            return data.answer || '抱歉，AI 处理失败，请稍后重试。';
        } catch (error) {
            console.error('调用 Dify API 出错:', error);
            return '抱歉，AI 服务暂时不可用，请稍后重试。';
        }
    }
};

const LOG_FILE = '../log/msglog.json';

// 简单日志函数，所有群消息都存本地文件
function logMsg(msgObj) {
    let logs = [];
    if (fs.existsSync(LOG_FILE)) {
        try { 
            logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); 
        } catch { 
            logs = []; 
        }
    }
    logs.push(msgObj);
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
    console.log('日志已写入！');
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true } // 如需浏览器界面可设置为 false
});

// 可选：设置你的机器人昵称（和群里的昵称一致，支持 @机器人触发）
const BOT_NICKNAME = '@Bot'; // 如群里昵称是 Bot，就填 '@Bot'

client.on('qr', (qr) => {
    qrcode.generate(qr, {small: true});
    console.log('请用手机 WhatsApp 扫码登录');
});

client.on('ready', () => {
    console.log('🤖 机器人已上线！正在监听所有群聊消息...');
});

client.on('message', async (message) => {
    console.log('收到消息:', message);
    // 只处理群聊
    if (message.from.endsWith('@g.us')) {
        // 判断是否为图片消息
        if (message.type === 'image') {
            const media = await message.downloadMedia();
            if (media) {
                // media.data 是 base64 编码的图片内容
                // media.mimetype 是图片类型，如 image/jpeg
                // media.filename 可能为 undefined
                const ext = media.mimetype.split('/')[1] || 'jpg';
                const filename = `image_${Date.now()}.${ext}`;
                fs.writeFileSync(filename, media.data, {encoding: 'base64'});
                console.log(`图片已保存为 ${filename}`);
            }
        }

        // 记录所有消息（包括图片消息）
        const msgObj = {
            id: message.id._serialized,
            from: message.from,
            author: message.author,
            body: message.body,
            type: message.type,
            timestamp: message.timestamp
        };
        logMsg(msgObj);

        let trigger = false;
        let query = '';

        // 触发条件1：/ai 指令
        if (message.body && message.body.startsWith('/ai')) {
            trigger = true;
            query = message.body.replace('/ai', '').trim();
        }

        // 触发条件2：@机器人昵称
        if (message.body && message.body.includes(BOT_NICKNAME)) {
            trigger = true;
            query = message.body.replace(BOT_NICKNAME, '').trim();
        }

        if (trigger && query) {
            // 先反馈"处理中"
            await message.reply('�� 已收到请求，正在调用AI处理，请稍候...');
            // 调用 Dify
            const result = await difyClient.runWorkflow(query, message.author);
            // 回复 AI 结果
            await message.reply(result);
        }
    }
});

client.initialize();