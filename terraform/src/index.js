const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const https = require('https');
const url = require('url');

const ssmClient = new SSMClient();

exports.handler = async (event) => {
    console.log('Event received:', JSON.stringify(event, null, 2));
    
    try {
        const body = JSON.parse(event.body || '{}');

        // HCP検証リクエストの処理
        if (body.event_source === 'hashicorp.webhook.verification') {
            console.log('Verification request received');
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message: 'Verification successful' })
            };
        }

        // パラメータストアからSlackのWebhook URLとチャンネルを取得
        const webhookUrlParam = await ssmClient.send(
            new GetParameterCommand({
                Name: process.env.SLACK_WEBHOOK_PARAM_NAME,
                WithDecryption: true
            })
        );
        const slackChannelParam = await ssmClient.send(
            new GetParameterCommand({
                Name: process.env.SLACK_CHANNEL_PARAM_NAME,
                WithDecryption: true
            })
        );

        const webhookUrl = webhookUrlParam.Parameter.Value;
        const slackChannel = slackChannelParam.Parameter.Value;

        // イベントの処理
        if (body.event && body.event.type) {
            console.log(`Processing event type: ${body.event.type}`);
            await handleEvent(body.event, webhookUrl, slackChannel);
        } else {
            console.log('No event type found in the payload');
            await handleEvent(body, webhookUrl, slackChannel);
        }
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: 'Event processed successfully' })
        };
        
    } catch (error) {
        console.error('Error processing webhook:', error);
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'Internal server error', details: error.message })
        };
    }
};

// イベントを処理する共通関数
async function handleEvent(event, webhookUrl, slackChannel) {
    console.log('Processing event:', JSON.stringify(event, null, 2));
    
    const eventType = event.event_source || 'unknown';
    const eventAction = event.event_action || 'unknown';
    const eventDescription = event.event_description || 'unknown';
    
    const resourceId = event.resource_id || 'Unknown';
    const resourceName = event.resource_name || 'Unknown';
    
    const payload = event.event_payload || {};
    const bucket = payload.bucket || {};
    const version = payload.version || {};
    const actor = payload.actor || {};
    const organizationId = payload.organization_id || 'Unknown';
    const projectId = payload.project_id || 'Unknown';
    const channel = payload.channel || {};
    const previousVersion = payload.previous_version || {};
    const builds = payload.builds || [];
    
    // イベントアクションに応じた絵文字と色を設定
    let emoji = '📣';
    let color = '#36a64f'; // デフォルトは緑
    
    switch (eventAction) {
        case 'create':
            emoji = '🆕';
            color = '#36a64f'; // 緑
            break;
        case 'complete':
            emoji = '✅';
            color = '#36a64f'; // 緑
            break;
        case 'revoke':
            emoji = '🚫';
            color = '#ff0000'; // 赤
            break;
        case 'restore':
            emoji = '🔄';
            color = '#ffa500'; // オレンジ
            break;
        case 'delete':
            emoji = '🗑️';
            color = '#ff0000'; // 赤
            break;
        case 'schedule-revocation':
            emoji = '⏰';
            color = '#ffa500'; // オレンジ
            break;
        case 'cancel-revocation':
            emoji = '❌';
            color = '#ffa500'; // オレンジ
            break;
        case 'assign':
            emoji = '📌';
            color = '#36a64f'; // 緑
            break;
    }
    
    // Slack通知用のメッセージを作成
    const message = {
        channel: slackChannel,
        username: 'HCP Packer',
        icon_emoji: ':hashicorp:',
        attachments: [{
            color: color,
            title: `${emoji} HCP ${eventDescription}`,
            fields: [
                {
                    title: 'イベントタイプ',
                    value: eventType,
                    short: true
                },
                {
                    title: 'アクション',
                    value: eventAction,
                    short: true
                },
                {
                    title: 'リソース名',
                    value: resourceName,
                    short: true
                },
                {
                    title: 'リソースID',
                    value: resourceId,
                    short: true
                }
            ],
            footer: 'HCP Packer',
            ts: Math.floor(Date.now() / 1000)
        }]
    };
    
    // バケット情報がある場合は追加
    if (bucket.name) {
        message.attachments[0].fields.push({
            title: 'バケット',
            value: bucket.name,
            short: true
        });
    }
    
    // バージョン情報がある場合は追加
    if (version.name) {
        message.attachments[0].fields.push(
            {
                title: 'バージョン',
                value: version.name,
                short: true
            },
            {
                title: 'ステータス',
                value: version.status || 'Unknown',
                short: true
            },
            {
                title: 'フィンガープリント',
                value: version.fingerprint || 'Unknown',
                short: true
            }
        );
    }
    
    // チャンネル情報がある場合は追加
    if (channel && channel.name) {
        message.attachments[0].fields.push({
            title: 'チャンネル',
            value: `${channel.name}${channel.managed ? ' (managed)' : ''}`,
            short: true
        });
    }
    
    // 前のバージョン情報がある場合は追加
    if (previousVersion.name) {
        message.attachments[0].fields.push({
            title: '前のバージョン',
            value: previousVersion.name,
            short: true
        });
    }
    
    // ビルド情報がある場合は追加
    if (builds.length > 0) {
        const buildInfo = builds.map(build => {
            const artifacts = build.artifacts?.map(art => 
                `${art.region}: ${art.external_identifier}`
            ).join('\n') || 'N/A';
            return `${build.platform} (${build.component_type})\n${artifacts}`;
        }).join('\n\n');
        
        message.attachments[0].fields.push({
            title: 'ビルド情報',
            value: buildInfo,
            short: false
        });
    }
    
    // プロジェクト情報を追加
    message.attachments[0].fields.push(
        {
            title: '組織ID',
            value: organizationId,
            short: true
        },
        {
            title: 'プロジェクトID',
            value: projectId,
            short: true
        }
    );
    
    // アクター情報がある場合は追加
    if (actor.user) {
        message.attachments[0].fields.push({
            title: '実行ユーザー',
            value: `${actor.user.name} (${actor.user.email})`,
            short: false
        });
    }
    
    // HCPポータルへのリンクを追加
    if (bucket.name) {
        const baseUrl = `https://portal.cloud.hashicorp.com/services/packer/buckets/${bucket.name}`;
        message.attachments[0].title_link = baseUrl;
    }
    
    // Slackに通知を送信
    await sendSlackMessage(webhookUrl, message);
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
