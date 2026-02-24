/**
 * Handler for !logs – returns last 100 lines of system log (Moderators/Legend only).
 * Log path: LOG_PATH env or /var/log/web.stdout.log (AWS Elastic Beanstalk default).
 */
import { EmbedBuilder } from 'discord.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { INFO_EMBED_COLOR } from './faqAndAliasHandler.js';

const execFileAsync = promisify(execFile);

const DEFAULT_LOG_PATH = '/var/log/web.stdout.log';

export async function handleGetLogs(message) {
    if (!message.member) {
        await message.reply('❌ Only Moderators or Legend members can run this command.');
        return;
    }

    const hasAuthorizedRole = message.member.roles?.cache?.some(
        role => role.name === 'Moderators' || role.name === 'Legend'
    );
    if (!hasAuthorizedRole) {
        await message.reply('❌ Only Moderators or Legend members can run this command.');
        return;
    }

    const logPath = process.env.LOG_PATH || DEFAULT_LOG_PATH;

    let stdout;
    try {
        const { stdout: out } = await execFileAsync('tail', ['-n', '100', logPath]);
        stdout = out || '';
    } catch (err) {
        const msg = err.message || String(err);
        const isPermissionDenied = err.code === 'EACCES' || /Permission denied/i.test(msg);
        if (isPermissionDenied) {
            await message.reply(
                '❌ Permission denied reading the log file. The app user cannot read that path. ' +
                'Set **LOG_PATH** in the server env to a log file the process can read (e.g. one your app writes to), or fix file permissions / group membership for the default path.'
            );
        } else {
            await message.reply('❌ Failed to read log file: ' + msg);
        }
        return;
    }

    const lines = stdout.trim() || '(empty)';
    const MAX_EMBED_CHARS = 4000;
    const chunks = [];
    for (let i = 0; i < lines.length; i += MAX_EMBED_CHARS) {
        chunks.push(lines.substring(i, i + MAX_EMBED_CHARS));
    }
    if (chunks.length === 0) chunks.push('(empty)');

    for (let i = 0; i < chunks.length; i++) {
        const embed = new EmbedBuilder()
            .setColor(INFO_EMBED_COLOR)
            .setTitle(i === 0 ? '📋 System Logs (Last 100 Lines)' : '📋 System Logs (Continued)')
            .setDescription('```text\n' + chunks[i] + '\n```')
            .setFooter({ text: `Part ${i + 1} of ${chunks.length}` })
            .setTimestamp();
        await message.channel.send({ embeds: [embed] }).catch(e => {
            console.error('[!logs] send chunk error:', e);
        });
    }
}
