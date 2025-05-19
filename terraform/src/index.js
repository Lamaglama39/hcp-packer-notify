const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const https = require('https');
const url = require('url');

const EVENT_ACTIONS = {
  create: { emoji: '🆕', color: '#36a64f' },
  complete: { emoji: '✅', color: '#36a64f' },
  revoke: { emoji: '🚫', color: '#ff0000' },
  restore: { emoji: '🔄', color: '#ffa500' },
  delete: { emoji: '🗑️', color: '#ff0000' },
  'schedule-revocation': { emoji: '⏰', color: '#ffa500' },
  'cancel-revocation': { emoji: '❌', color: '#ffa500' },
  assign: { emoji: '📌', color: '#36a64f' },
  default: { emoji: '📣', color: '#36a64f' }
};

const ssmClient = new SSMClient();

exports.handler = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));
  
  try {
    const body = JSON.parse(event.body || '{}');

    // HCP検証リクエストの処理
    if (body.event_source === 'hashicorp.webhook.verification') {
      console.log('Verification request received');
      return createResponse(200, { message: 'Verification successful' });
    }

    // パラメータストアからSlackの設定取得
    const [webhookUrlParam, slackChannelParam] = await Promise.all([
      getParameter(process.env.SLACK_WEBHOOK_PARAM_NAME),
      getParameter(process.env.SLACK_CHANNEL_PARAM_NAME)
    ]);

    const webhookUrl = webhookUrlParam.Parameter.Value;
    const slackChannel = slackChannelParam.Parameter.Value;

    // イベントの処理
    const eventToProcess = body.event?.type ? body.event : body;
    console.log(`Processing event:`, JSON.stringify(eventToProcess, null, 2));
    
    await handleEvent(eventToProcess, webhookUrl, slackChannel);
    
    return createResponse(200, { message: 'Event processed successfully' });
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    return createResponse(500, { error: 'Internal server error', details: error.message });
  }
};

// パラメータ取得 ヘルパー関数
async function getParameter(paramName) {
  return ssmClient.send(
    new GetParameterCommand({
      Name: paramName,
      WithDecryption: true
    })
  );
}

// レスポンス作成 ヘルパー関数
function createResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

// イベントを処理する共通関数
async function handleEvent(event, webhookUrl, slackChannel) {
  const eventInfo = extractEventInfo(event);
  const message = buildSlackMessage(eventInfo, slackChannel);  
  await sendSlackMessage(webhookUrl, message);
}

// イベント情報を抽出する関数
function extractEventInfo(event) {
  const { event_source, event_action, event_description, resource_id, resource_name, event_payload } = event;
  
  return {
    eventType: event_source || 'unknown',
    eventAction: event_action || 'unknown',
    eventDescription: event_description || 'unknown',
    resourceId: resource_id || 'Unknown',
    resourceName: resource_name || 'Unknown',
    payload: event_payload || {},
  };
}

// Slackメッセージを構築する関数
function buildSlackMessage(eventInfo, slackChannel) {
  const { eventType, eventAction, eventDescription, resourceId, resourceName, payload } = eventInfo;
  
  const { emoji, color } = EVENT_ACTIONS[eventAction] || EVENT_ACTIONS.default;
  
  const { 
    bucket = {}, 
    version = {}, 
    actor = {}, 
    organization_id: organizationId = 'Unknown', 
    project_id: projectId = 'Unknown',
    channel = {},
    previous_version: previousVersion = {},
    builds = []
  } = payload;
  
  // 基本メッセージ構造
  const message = {
    channel: slackChannel,
    username: 'HCP Packer',
    icon_emoji: ':hashicorp:',
    attachments: [{
      color,
      title: `${emoji} HCP ${eventDescription}`,
      fields: [
        { title: 'イベントタイプ', value: eventType, short: true },
        { title: 'アクション', value: eventAction, short: true },
        { title: 'リソース名', value: resourceName, short: true },
        { title: 'リソースID', value: resourceId, short: true }
      ],
      footer: 'HCP Packer',
      ts: Math.floor(Date.now() / 1000)
    }]
  };
  
  // 追加フィールドを条件付きで追加
  addConditionalFields(message.attachments[0], { bucket, version, channel, previousVersion, builds, organizationId, projectId, actor });
  
  // HCPポータルへのリンクを追加
  if (bucket.name) {
    message.attachments[0].title_link = `https://portal.cloud.hashicorp.com/services/packer/buckets/${bucket.name}`;
  }
  
  return message;
}

// 条件付きでフィールドを追加する関数
function addConditionalFields(attachment, { bucket, version, channel, previousVersion, builds, organizationId, projectId, actor }) {
  // バケット情報
  if (bucket.name) {
    attachment.fields.push({
      title: 'バケット',
      value: bucket.name,
      short: true
    });
  }
  
  // バージョン情報
  if (version.name) {
    attachment.fields.push(
      { title: 'バージョン', value: version.name, short: true },
      { title: 'ステータス', value: version.status || 'Unknown', short: true },
      { title: 'フィンガープリント', value: version.fingerprint || 'Unknown', short: true }
    );
  }
  
  // チャンネル情報
  if (channel?.name) {
    attachment.fields.push({
      title: 'チャンネル',
      value: `${channel.name}${channel.managed ? ' (managed)' : ''}`,
      short: true
    });
  }
  
  // 前のバージョン情報
  if (previousVersion.name) {
    attachment.fields.push({
      title: '前のバージョン',
      value: previousVersion.name,
      short: true
    });
  }
  
  // ビルド情報
  if (builds.length > 0) {
    const buildInfo = builds.map(build => {
      const artifacts = build.artifacts?.map(art => 
        `${art.region}: ${art.external_identifier}`
      ).join('\n') || 'N/A';
      return `${build.platform} (${build.component_type})\n${artifacts}`;
    }).join('\n\n');
    
    attachment.fields.push({
      title: 'ビルド情報',
      value: buildInfo,
      short: false
    });
  }
  
  // プロジェクト情報
  attachment.fields.push(
    { title: '組織ID', value: organizationId, short: true },
    { title: 'プロジェクトID', value: projectId, short: true }
  );
  
  // アクター情報
  if (actor.user) {
    attachment.fields.push({
      title: '実行ユーザー',
      value: `${actor.user.name} (${actor.user.email})`,
      short: false
    });
  }
}

// Slackに通知を送信する関数
function sendSlackMessage(webhookUrl, message) {
  return new Promise((resolve, reject) => {
    const parsedUrl = url.parse(webhookUrl);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Status Code: ${res.statusCode} ${responseBody}`));
        } else {
          resolve(responseBody);
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(JSON.stringify(message));
    req.end();
  });
}
