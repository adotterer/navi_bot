import fs from 'fs';
import { fetchAllMessages, uploadToS3 } from '../shared/s3Helper.js';
import { buildCharacterAliasMap, resolveCharacterFromText } from '../matchups/characterAliases.js';

export async function handleExportFalco(message) {
    const guild = message.guild;
    const channel = guild.channels.cache.find(ch => ch.name === "falco");
    
    if (!channel) {
        await message.reply("❌ Channel 'falco' not found!");
        return;
    }
    
    try {
        await message.reply("⏳ Exporting messages from #falco...");
        
        const messages = await fetchAllMessages(channel);
        
        const jsonData = JSON.stringify(messages, null, 2);
        fs.writeFileSync('falco_messages.json', jsonData);
        
        await message.reply(`✅ Exported ${messages.length} messages to falco_messages.json`);
        console.log(`✅ Exported ${messages.length} messages from #falco`);
    } catch (error) {
        console.error(error);
        await message.reply("❌ Error exporting messages: " + error.message);
    }
}

function findMatchupChannel(guild, slug) {
    const categoryNames = ["Match Ups (B-L)", "Match Ups (M-Z)"];
    for (const categoryName of categoryNames) {
        const category = guild.channels.cache.find(ch => ch.children && ch.name === categoryName);
        if (!category) continue;
        const channel = category.children.cache.find(
            ch => ch.isTextBased() && ch.name === slug
        );
        if (channel) return channel;
    }
    return null;
}

export async function handleExportCharacter(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply("❌ This command must be used in a server.");
        return;
    }

    const input = message.content.trim().split(" ").slice(1).join(" ").trim();
    if (!input) {
        await message.reply("❌ Usage: !export <character> (e.g., !export palu)");
        return;
    }

    const lowerInput = input.toLowerCase();
    if (lowerInput === "matchups") {
        await handleExportMatchups(message);
        return;
    }

    const aliasMap = buildCharacterAliasMap(guild);
    const match = resolveCharacterFromText(lowerInput, aliasMap);
    const slug = match?.slug || lowerInput;
    const channel = findMatchupChannel(guild, slug);

    if (!channel) {
        await message.reply(`❌ Channel '${slug}' not found in Match Ups categories.`);
        return;
    }

    try {
        await message.reply(`⏳ Exporting messages from #${channel.name}...`);

        const messages = await fetchAllMessages(channel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = `${channel.name}.json`;
        fs.writeFileSync(filename, jsonData);

        const s3Url = await uploadToS3(filename, jsonData);
        await message.reply(`✅ Exported ${messages.length} messages to ${filename}\n☁️ ${s3Url}`);
        console.log(`✅ Exported ${messages.length} messages from #${channel.name}`);
    } catch (error) {
        console.error(error);
        await message.reply("❌ Error exporting messages: " + error.message);
    }
}

export async function handleExportMatchups(message) {
    const guild = message.guild;
    const categoryNames = ["Match Ups (B-L)", "Match Ups (M-Z)"];
    
    try {
        await message.reply("⏳ Exporting all Match Ups channels...");
        
        let totalChannels = 0;
        let totalMessages = 0;
        const exportedFiles = [];
        
        for (const categoryName of categoryNames) {
            const category = guild.channels.cache.find(ch => ch.children && ch.name === categoryName);
            
            if (!category) {
                console.log(`⚠️  Category '${categoryName}' not found`);
                continue;
            }
            
            const channels = category.children.cache.filter(ch => ch.isTextBased());
            
            for (const [, channel] of channels) {
                try {
                    console.log(`📥 Exporting #${channel.name}...`);
                    const messages = await fetchAllMessages(channel);
                    
                    const jsonData = JSON.stringify(messages, null, 2);
                    const filename = `${channel.name}.json`;
                    fs.writeFileSync(filename, jsonData);
                    
                    const s3Url = await uploadToS3(filename, jsonData);
                    console.log(`☁️  Uploaded to S3: ${s3Url}`);
                    
                    exportedFiles.push(`[${channel.name}](${s3Url}) - ${messages.length} messages`);
                    totalMessages += messages.length;
                    totalChannels++;
                    
                    console.log(`✅ Exported #${channel.name}: ${messages.length} messages`);
                } catch (error) {
                    console.error(`❌ Error exporting #${channel.name}:`, error.message);
                }
            }
        }
        
        await message.reply(
            `✅ Exported ${totalChannels} channels with ${totalMessages} total messages!\n\n` +
            exportedFiles.slice(0, 10).join('\n') +
            (exportedFiles.length > 10 ? `\n... and ${exportedFiles.length - 10} more` : '')
        );
        console.log(`✅ Completed: ${totalChannels} channels, ${totalMessages} total messages`);
    } catch (error) {
        console.error(error);
        await message.reply("❌ Error exporting Match Ups channels: " + error.message);
    }
}
