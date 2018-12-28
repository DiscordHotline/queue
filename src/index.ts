import {Channel, connect, Message as AMQPMessage} from 'amqplib';
import {AxiosInstance, default as axios} from 'axios';
import * as hookcord from 'hookcord';
import * as moment from 'moment';

import * as interfaces from './interfaces';
import {Report, Subscription} from './interfaces';
import {Vault} from './Vault';

let vault: Vault;
let api: AxiosInstance;
let channel: Channel;
const cdn = 'https://cdn.discordapp.com';

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

async function main(): Promise<void> {
    vault = new Vault({
        address:  process.env.VAULT_ADDR,
        roleId:   process.env.VAULT_ROLE_ID,
        secretId: process.env.VAULT_SECRET_ID,
    });
    await vault.initialize();

    const queue = await vault.getSecrets('queue');
    api         = axios.create({
        baseURL: process.env.API_URL || 'https://api.hotline.gg',
        headers: {
            'Authorization': 'Bearer ' + queue.api_key,
            'Accepts':       'application/json',
            'Content-Type':  'application/json',
        },
    });

    const connection = await connect({
        hostname: queue.host,
        port:     parseInt(queue.port, 10),
        username: queue.username,
        password: queue.password,
        vhost:    'hotline',
    });

    channel = await connection.createChannel();

    console.log('Consuming messages');
    await channel.consume('hotline-reports', async (msg: AMQPMessage) => {
        try {
            if (await onMessage(JSON.parse(msg.content.toString()))) {
                channel.ack(msg, false);
            } else {
                channel.nack(msg, false, false);
            }
        } catch (e) {
            console.error(e);

            channel.nack(msg, false, false);
        }
    });
}

async function onMessage(message: interfaces.Message) {
    console.log('Processing message: ' + message.type);

    switch (message.type) {
        case 'EDIT_REPORT':
        case 'NEW_REPORT':
        case 'DELETE_REPORT':
            const data   = message.data as interfaces.ReportData;
            const report = data.report as Report;

            return await handleReport(
                typeToAction[message.type],
                report,
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
    report: Report,
    subscriptionId?: number,
    attempt: number = 0,
): Promise<boolean> {
    let url = '/subscription';
    if (report.tags.length > 0) {
        url += '?tags=' + (report.tags.map((x) => x.id).join(','));
    } else {
        url += '?tags=20';
    }
    let subscriptions: Subscription[];
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
            response = await axios.post(subscription.url, {report: JSON.stringify(report), action});
        }

        if (response.status !== subscription.expectedResponseCode) {
            console.warn('Subscription did not respond as expected. Attempt: ' + attempt, subscription);
            setTimeout(
                () => channel.publish(
                    'hotline-reports',
                    'report',
                    Buffer.from(
                        JSON.stringify({
                                type: actionToType[action],
                                data: {
                                          subscription: subscription.id,
                                          attempt:      attempt + 1,
                                          report,
                                      } as interfaces.SpecificSubscriptionReport,
                            },
                        ),
                    ),
                ),
                5 * 60 * 1000,
            );
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
