const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');
const mime = require('mime-types');
require('dotenv').config();

const DIFY_API_KEY  = process.env.DIFY_API_KEY;
const DIFY_BASE_URL = process.env.DIFY_BASE_URL || 'https://api.dify.ai/v1';

const TMP_DIR  = path.join(__dirname, 'tmp');
fs.ensureDirSync(TMP_DIR);

const LOG_WHATSAPP_MSGS = process.env.LOG_WHATSAPP_MSGS === 'true';
const LOG_DIR  = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'whatsapp.log');
fs.ensureDirSync(LOG_DIR);

const client = new Client({
  authStrategy: new LocalAuth()
});

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('请扫描二维码登录 WhatsApp');
});

client.on('ready', () => {
  console.log('WhatsApp 机器人已启动');
});

/**
 * 从 whatsapp+dify 的日志字符串中提取最终的 package_output
 * @param {string} logString — 包含多行 "data: {...}" 的原始日志
 * @returns {{ package_output: { Package: string, Reason: string, Language: string } }}
 * @throws 如果找不到 workflow_finished 或者 status !== 'succeeded'
 */
function extractPackageOutput(logString) {
  const events = logString
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('data: '))
    .map(line => {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        return null;
      }
    })
    .filter(evt => evt && evt.event === 'workflow_finished');

  if (events.length === 0) {
    throw new Error('未找到 workflow_finished 事件');
  }

  const last = events[events.length - 1].data;
  if (last.status !== 'succeeded') {
    throw new Error(`Workflow 执行失败，状态：${last.status}`);
  }

  const { Package, Reason, Language } = last.outputs.package_output;
  return { package_output: { Package, Reason, Language } };
}

client.on('message', async msg => {
  try {
    const user  = msg.from;
    let query   = '';
    let files   = [];

    // —— 处理不同类型的 WhatsApp 消息 —— 
    if (msg.type === 'chat') {
      query = msg.body;
    } else if (msg.type === 'image') {
      const media = await msg.downloadMedia();
      if (media) {
        const ext = mime.extension(media.mimetype) || 'jpg';
        const filename = `img_${Date.now()}.${ext}`;
        const filepath = path.join(TMP_DIR, filename);
        await fs.writeFile(filepath, media.data, 'base64');
        const file_id = await uploadFileToDify(filepath, user, 'image');
        files.push({
          type: 'image',
          transfer_method: 'local_file',
          upload_file_id: file_id
        });
        query = '[图片]';
        await fs.remove(filepath);
      }
    } else if (['ptt', 'audio'].includes(msg.type)) {
      const media = await msg.downloadMedia();
      if (media) {
        const ext = mime.extension(media.mimetype) || 'ogg';
        const filename = `audio_${Date.now()}.${ext}`;
        const filepath = path.join(TMP_DIR, filename);
        await fs.writeFile(filepath, media.data, 'base64');
        query = await audioToText(filepath, user);
        await fs.remove(filepath);
      }
    } else {
      query = '[暂不支持的消息类型]';
    }

    // —— 可选：记录收到的 WhatsApp 消息 —— 
    if (LOG_WHATSAPP_MSGS) {
      const logEntry = `[${new Date().toISOString()}] ${msg.from} (${msg.type}): ${msg.body || ''}\n`;
      await fs.appendFile(LOG_FILE, logEntry);
    }

    if (!query) {
      await msg.reply('未识别到有效内容。');
      return;
    }

    // —— 调用 Dify，拿到原始 SSE 日志文本 —— 
    const difyLogString = await sendToDify({ query, user, files });

    // —— 解析并回复 —— 
    let replyStr;
    try {
      const resultObj = extractPackageOutput(difyLogString);
      replyStr = JSON.stringify(resultObj);
      console.log('Final package output:', replyStr);
    } catch (err) {
      console.error('处理 Dify 回复失败：', err);
      replyStr = `处理失败：${err.message}`;
    }
    await msg.reply(replyStr);

  } catch (err) {
    console.error('处理消息出错:', err);
    await msg.reply('机器人处理消息时出错，请稍后再试。');
  }
});

client.initialize();


// — 上传图片/文件到 Dify — 
async function uploadFileToDify(filepath, user, type = 'image') {
  const form = new FormData();
  form.append('file', fs.createReadStream(filepath));
  form.append('user', user);
  const res = await axios.post(
    `${DIFY_BASE_URL}/files/upload`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${DIFY_API_KEY}`
      }
    }
  );
  return res.data.id;
}

// — 语音转文字 — 
async function audioToText(filepath, user) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filepath));
  form.append('user', user);
  const res = await axios.post(
    `${DIFY_BASE_URL}/audio-to-text`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${DIFY_API_KEY}`
      }
    }
  );
  return res.data.text || '[语音转文字失败]';
}

// — 发送消息到 Dify，返回原始 SSE 文本 — 
async function sendToDify({ query, user, files = [], conversation_id = '', response_mode = 'streaming', inputs = {} }) {
  const data = { query, user, files, conversation_id, response_mode, inputs };
  const res = await axios.post(
    `${DIFY_BASE_URL}/chat-messages`,
    data,
    {
      headers: {
        'Authorization': `Bearer ${DIFY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: 'text'  // <—— 关键：拿原始 "data: {...}" 文本
    }
  );
  return res.data;
}
