/**
 * Handler for !logs – returns last 100 lines of system log (Moderators/Legend only).
 * Log path: LOG_PATH env or /var/log/web.stdout.log (AWS Elastic Beanstalk default).
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { splitMessage, MAX_DISCORD_LENGTH } from '../shared/messageSplitter.js';

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

    const codeBlock = '```text\n' + (stdout.trim() || '(empty)') + '\n```';
    const chunks = splitMessage(codeBlock, MAX_DISCORD_LENGTH);

    for (let i = 0; i < chunks.length; i++) {
        await message.reply(chunks[i]).catch(e => {
            console.error('[!logs] send chunk error:', e);
        });
    }
}
