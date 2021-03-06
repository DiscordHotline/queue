import {Channel, connect, Message as AMQPMessage} from 'amqplib';
import {AxiosInstance, default as axios} from 'axios';
import {parse, stringify} from 'flatted';
import * as hookcord from 'hookcord';
import * as moment from 'moment';

import * as interfaces from './interfaces';
import getSecretManager from './util/getSecretManager';

const secrets = getSecretManager();
let api: AxiosInstance;
let channel: Channel;
const cdn     = 'https://cdn.discordapp.com';

const actionToType: { [key: string]: interfaces.MessageType }   = {
    new:    'NEW_REPORT',
    edit:   'EDIT_REPORT',
    delete: 'DELETE_REPORT',
};
const typeToAction: { [key: string]: interfaces.MessageAction } = {
    NEW_REPORT:    'new',
    EDIT_REPORT:   'edit',
    DELETE_REPORT: 'delete',
};

type Secret = {
    api_key: string;
    host: string;
    username: string;
    password: string;
    port: string;
};

async function main(): Promise<void> {
    const queue = (await secrets.getSecret<Secret>('hotline/queue')).value;
    api         = axios.create({
        baseURL: process.env.API_URL || 'https://api.hotline.gg',
        headers: {
            'Authorization': 'Bearer ' + queue.api_key,
            'Accepts':       'application/json',
            'Content-Type':  'application/json',
        },
    });

    const connection = await connect({
        hostname:  queue.host,
        port:      parseInt(queue.port, 10),
        username:  queue.username,
        password:  queue.password,
        vhost:     'hotline',
        heartbeat: 5,
    });

    channel = await connection.createChannel();
    await channel.assertExchange('hotline-reports', 'direct', {durable: true});
    await channel.assertQueue('hotline-reports', {durable: true});
    await channel.bindQueue('hotline-reports', 'hotline-reports', 'report');

    console.log('Consuming messages');
    await channel.consume('hotline-reports', async (msg: AMQPMessage) => {
        const message: interfaces.Message = parse(msg.content.toString());
        if (message.waitUntil && moment().isBefore(moment(message.waitUntil))) {
            return channel.nack(msg, false, true);
        }
        console.log(`Processing message: ${message.type}`);

        try {
            if (await onMessage(message)) {
                console.log('Acking Message');
                channel.ack(msg, false);
            } else {
                console.log('Nacking Message, Requeue');
                channel.nack(msg, false, true);
            }
        } catch (e) {
            console.error('Nacking Message', e);

            channel.nack(msg, false, false);
        }
    });
}

async function onMessage(message: interfaces.Message): Promise<boolean> {
    switch (message.type) {
        case 'EDIT_REPORT':
        case 'NEW_REPORT':
        case 'DELETE_REPORT':
            if (process.env.DEBUG) {
                console.log(message);
            }

            const data      = message.data as interfaces.ReportData;
            const report    = data.report as interfaces.Report;
            const oldReport = data.oldReport as interfaces.Report;

            return await handleReport(
                typeToAction[message.type],
                report,
                oldReport,
                data.subscription,
                data.attempt,
            );
        default:
            throw new Error('Bad Message: ' + message);
    }
}

/**
 * Basic Flow:
 * 1. Grab all subscriptions
 * 2. Filter out subscriptions that don't match this report
 * 3. Send out report to remaining subscriptions
 */

/**
 * Basic Flow:
 * 1. Grab all subscriptions
 * 2. Filter out subscriptions that don't match this report
 * 3. Send out report to remaining subscriptions
 */
async function handleReport(
    action: interfaces.MessageAction,
    report: interfaces.Report,
    oldReport: interfaces.Report,
    subscriptionId?: number,
    attempt: number = 0,
): Promise<boolean> {
    let url = '/subscription';
    if (report.tags.length > 0) {
        url += '?tags=' + (report.tags.map((x) => x.id).join(','));
    } else {
        url += '?tags=20';
    }
    let subscriptions: interfaces.Subscription[];
    if (subscriptionId) {
        try {
            subscriptions = [
                (await api.get<interfaces.Subscription>('/subscription/' + subscriptionId)).data,
            ];
        } catch (e) {
            return false;
        }
    } else {
        subscriptions = (await api.get<interfaces.SubscriptionSearchResults>(url)).data.results;
    }
    for (const subscription of subscriptions) {
        let response;

        // We cannot/will not edit a webhook. Just post a new one.
        if (subscription.discordWebhook) {
            if (action === 'delete') {
                // Can't / Wont delete a webhook
                continue;
            }

            subscription.expectedResponseCode = 204;
            const hook                        = new hookcord.Hook();
            hook.setOptions({link: subscription.url})
                .setPayload({
                    username:   'Watcher',
                    avatar_url: `${cdn}/avatars/305140278480863233/51daf8a9e8c786dc59f3587999fe5948.webp?size=256`,
                    embeds:     [await getEmbed(report, true)],
                });

            response        = await hook.fire();
            response.status = response.statusCode;
        } else {
            try {
                const body = {
                    embed:     stringify(await getEmbed(report, true)),
                    report:    stringify(report),
                    oldReport: stringify(oldReport),
                    action,
                };
                if (process.env.DEBUG) {
                    console.log(`Posting to ${subscription.url}`, body);
                }
                response = await axios.post(subscription.url, body);
            } catch (e) {
                console.log('Error Posting', e);
                response = e.response;
            }
        }

        if (!response || response.status !== subscription.expectedResponseCode) {
            console.warn(
                'Subscription did not respond as expected.',
                `Received: ${response ? response.status : 0} Attempt: ${attempt}`,
                subscription,
            );
            const dataToSend: { waitUntil: Date, type: string, data: interfaces.ReportData } = {
                waitUntil: moment().add(5, 'm').toDate(),
                type:      actionToType[action],
                data:      {
                    subscription: subscription.id,
                    attempt:      attempt + 1,
                    report,
                    oldReport,
                },
            };
            channel.publish('hotline-reports', 'report', Buffer.from(stringify(dataToSend)));
        } else {
            console.log(`Subscription posted successfully. Subscription: ${subscription.id} Report: ${report.id}`);
        }
    }

    return true;
}

async function getEmbed(report: interfaces.Report, webhook: boolean = false): Promise<any> {
    const reportedUsers = report.reportedUsers.map((x) => `<@${x.id}> (${x.id})`);
    const links         = report.links.map((x) => `<${x}>`);
    const tags          = report.tags.map((x) => x.name);

    let description = `**Users:** ${reportedUsers.join(', ')}`;
    if (report.reason) {
        description += `\n\n**Reason:** ${report.reason}`;
    }

    if (report.tags.length > 0) {
        description += `\n\n**Tags:** ${tags.length === 0 ? 'None' : tags.join(',t')}`;
    }

    if (report.links.length > 0) {
        description += `\n\n**Links:** ${links.length === 0 ? 'None' : links.join('\\n')}`;
    }

    let footerText = webhook
        ? null
        : `Confirmations: ${report.confirmationUsers.length} | Last Edit: ${moment(report.updateDate)
            .from(moment())}`;

    const embed = {
        title:     'Report ID: ' + report.id,
        footer:    {
            text: footerText,
        },
        timestamp: report.insertDate,
        description,
    };

    return embed;
}

main().catch(console.error);
