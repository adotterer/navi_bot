import { EmbedBuilder } from "discord.js";
import { INFO_EMBED_COLOR } from "./faqAndAliasHandler.js";

export async function handleModHelp(message) {
    const hasAuthorizedRole = message.member?.roles?.cache?.some(
        role => role.name === "Moderators" || role.name === "Legend"
    );

    if (!hasAuthorizedRole) {
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(INFO_EMBED_COLOR)
        .setTitle("Moderator Commands")
        .setDescription("Available commands for Moderators and Legend members:")
        .addFields(
            { name: "!modhelp", value: "helps them remember what the mod commands are by sending an embed message with the commands available to mods only." },
            { name: "!ts", value: "!ts – manually trigger tournament notification (Moderators only)" },
            { name: "!export <character> or !export matchups", value: "Export character matchup notes to CSV." },
            { name: "!list-thread-counts", value: "List the message count for each character's matchup thread." },
            { name: "!cleanup", value: "delete all bot messages" },
            { name: "!cleanupall", value: "delete all messages" },
            { name: "!add-a <alias> <canonical char>", value: "!add-a <alias> <canonical char> – add new aliases (Moderators only)" },
            { name: "!canonical", value: "List all canonical character names" }
        );

    await message.reply({ embeds: [embed] });
}
