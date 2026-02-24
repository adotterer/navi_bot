import { exec } from 'child_process';
import { PermissionFlagsBits } from 'discord.js';
import { splitMessage } from '../shared/messageSplitter.js';

/**
 * Handle !logs command: fetch last 100 lines of system logs and send to Discord.
 * Restricted to users with ManageMessages permission.
 */
export async function handleGetLogs(message) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return message.reply("❌ Only Moderators can run this command.");
    }

    const logPath = process.env.LOG_PATH || '/var/log/web.stdout.log';

    exec(`tail -n 100 ${logPath}`, async (error, stdout, stderr) => {
        if (error) {
            console.error(`Error fetching logs: ${error.message}`);
            return message.reply(`❌ Error fetching logs: ${error.message}`);
        }

        if (stderr) {
            console.warn(`Stderr from log tail: ${stderr}`);
        }

        const logOutput = stdout || "No logs found.";
        const formattedLogs = "```text\n" + logOutput + "\n```";

        try {
            const parts = splitMessage(formattedLogs);
            for (const part of parts) {
                await message.channel.send(part);
            }
        } catch (err) {
            console.error("Error sending logs:", err);
            await message.reply("❌ Failed to send log output.");
        }
    });
}
