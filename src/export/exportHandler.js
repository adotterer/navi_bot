import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import { fetchAllMessages, fetchFromS3, uploadToS3 } from '../shared/s3Helper.js';
import { buildCharacterAliasMap, resolveCharacterFromText } from '../matchups/characterAliases.js';
import { sendSplitMessage } from '../shared/messageSplitter.js';

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
    if (lowerInput === "glossary") {
        await handleExportGlossary(message);
        return;
    }
    if (lowerInput === "fundies") {
        await handleExportFundies(message);
        return;
    }
    if (lowerInput === "disadvantage") {
        await handleExportDisadvantage(message);
        return;
    }
    if (lowerInput === "advantage") {
        await handleExportAdvantage(message);
        return;
    }
    if (lowerInput === "neutral") {
        await handleExportNeutral(message);
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
        const statusEmbed = new EmbedBuilder()
            .setColor(0x36AAD4)
            .setDescription(`⏳ Exporting messages from #${channel.name}...`);
        await message.reply({ embeds: [statusEmbed] });

        const messages = await fetchAllMessages(channel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = `${channel.name}.json`;
        fs.writeFileSync(filename, jsonData);

        const s3Url = await uploadToS3(filename, jsonData);

        const successEmbed = new EmbedBuilder()
            .setColor(0x36AAD4)
            .setDescription(`✅ Exported #${channel.name}: ${messages.length} messages → ${filename}\n☁️ ${s3Url}`);
        await message.reply({ embeds: [successEmbed] });

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
        await message.reply("⏳ Exporting all Match Ups channels, glossary, fundies, and game state channels...");
        
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

        // Export glossary
        try {
            const glossaryChannel = guild.channels.cache.find(
                ch => ch.isTextBased() && ch.name.toLowerCase().includes("glossary")
            );
            if (glossaryChannel) {
                console.log(`📥 Exporting glossary...`);
                const messages = await fetchAllMessages(glossaryChannel);
                const jsonData = JSON.stringify(messages, null, 2);
                const s3Url = await uploadToS3("glossary.json", jsonData);
                exportedFiles.push(`[glossary](${s3Url}) - ${messages.length} messages`);
                totalMessages += messages.length;
                totalChannels++;
                console.log(`✅ Exported glossary: ${messages.length} messages`);
            }
        } catch (error) {
            console.error(`❌ Error exporting glossary:`, error.message);
        }

        // Export fundies/fundamentals
        try {
            const fundiesChannel = guild.channels.cache.find(
                ch => ch.isTextBased() && (
                    ch.name.toLowerCase().includes("fundies") ||
                    ch.name.toLowerCase().includes("fundamentals")
                )
            );
            if (fundiesChannel) {
                console.log(`📥 Exporting fundies/fundamentals...`);
                const messages = await fetchAllMessages(fundiesChannel);
                const jsonData = JSON.stringify(messages, null, 2);
                const s3Url = await uploadToS3("fundies.json", jsonData);
                exportedFiles.push(`[fundies](${s3Url}) - ${messages.length} messages`);
                totalMessages += messages.length;
                totalChannels++;
                console.log(`✅ Exported fundies/fundamentals: ${messages.length} messages`);
            }
        } catch (error) {
            console.error(`❌ Error exporting fundies/fundamentals:`, error.message);
        }

        // Export disadvantage
        try {
            const disadvantageChannel = guild.channels.cache.find(
                ch => ch.isTextBased() && ch.name.toLowerCase().includes("disadvantage")
            );
            if (disadvantageChannel) {
                console.log(`📥 Exporting disadvantage...`);
                const messages = await fetchAllMessages(disadvantageChannel);
                const jsonData = JSON.stringify(messages, null, 2);
                const s3Url = await uploadToS3("disadvantage.json", jsonData);
                exportedFiles.push(`[disadvantage](${s3Url}) - ${messages.length} messages`);
                totalMessages += messages.length;
                totalChannels++;
                console.log(`✅ Exported disadvantage: ${messages.length} messages`);
            }
        } catch (error) {
            console.error(`❌ Error exporting disadvantage:`, error.message);
        }

        // Export advantage
        try {
            const advantageChannel = guild.channels.cache.find(
                ch => ch.isTextBased() && ch.name.toLowerCase().includes("advantage")
            );
            if (advantageChannel) {
                console.log(`📥 Exporting advantage...`);
                const messages = await fetchAllMessages(advantageChannel);
                const jsonData = JSON.stringify(messages, null, 2);
                const s3Url = await uploadToS3("advantage.json", jsonData);
                exportedFiles.push(`[advantage](${s3Url}) - ${messages.length} messages`);
                totalMessages += messages.length;
                totalChannels++;
                console.log(`✅ Exported advantage: ${messages.length} messages`);
            }
        } catch (error) {
            console.error(`❌ Error exporting advantage:`, error.message);
        }

        // Export neutral
        try {
            const neutralChannel = guild.channels.cache.find(
                ch => ch.isTextBased() && ch.name.toLowerCase().includes("neutral")
            );
            if (neutralChannel) {
                console.log(`📥 Exporting neutral...`);
                const messages = await fetchAllMessages(neutralChannel);
                const jsonData = JSON.stringify(messages, null, 2);
                const s3Url = await uploadToS3("neutral.json", jsonData);
                exportedFiles.push(`[neutral](${s3Url}) - ${messages.length} messages`);
                totalMessages += messages.length;
                totalChannels++;
                console.log(`✅ Exported neutral: ${messages.length} messages`);
            }
        } catch (error) {
            console.error(`❌ Error exporting neutral:`, error.message);
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

export async function handleListThreadCounts(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply("❌ This command must be used in a server.");
        return;
    }

    const categoryNames = ["Match Ups (B-L)", "Match Ups (M-Z)"];
    const counts = [];

    try {
        await message.reply("⏳ Counting messages in each character thread...");

        for (const categoryName of categoryNames) {
            const category = guild.channels.cache.find(ch => ch.children && ch.name === categoryName);
            if (!category) continue;

            const channels = category.children.cache.filter(ch => ch.isTextBased());

            for (const [, channel] of channels) {
                try {
                    const filename = `${channel.name}.json`;
                    const messages = await fetchFromS3(filename);
                    const count = Array.isArray(messages) ? messages.length : 0;
                    counts.push({ name: channel.name, count });
                } catch (error) {
                    console.error(`❌ Error counting #${channel.name}:`, error.message);
                    counts.push({ name: channel.name, count: 0 });
                }
            }
        }

        if (counts.length === 0) {
            await message.reply("⚠️ No matchup channels found.");
            return;
        }

        counts.sort((a, b) => b.count - a.count);
        const lines = counts.map(c => `#${c.name}: ${c.count} messages`).join("\n");
        const header = `📊 **Character Thread Message Counts** (${counts.length})\n`;
        const output = header + lines;

        await sendSplitMessage(message, output, true);
    } catch (error) {
        console.error(error);
        await message.reply("❌ Error counting messages: " + error.message);
    }
}

async function handleExportGlossary(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply("❌ This command must be used in a server.");
        return;
    }

    try {
        await message.reply(`⏳ Exporting glossary...`);

        // Find glossary channel in the guild
        const glossaryChannel = guild.channels.cache.find(
            ch => ch.isTextBased() && ch.name.toLowerCase().includes("glossary")
        );

        if (!glossaryChannel) {
            await message.reply(`❌ Glossary channel not found in this server.`);
            return;
        }

        const messages = await fetchAllMessages(glossaryChannel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = "glossary.json";

        const s3Url = await uploadToS3(filename, jsonData);
        await message.reply(`✅ Exported glossary: ${messages.length} messages → ${filename}\n☁️ ${s3Url}`);
        console.log(`✅ Exported ${messages.length} messages from glossary channel`);
    } catch (error) {
        console.error(error);
        await message.reply("❌ Error exporting glossary: " + error.message);
    }
}

async function handleExportFundies(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply("❌ This command must be used in a server.");
        return;
    }

    try {
        await message.reply(`⏳ Exporting fundies/fundamentals...`);

        // Find fundies/fundamentals channel in the guild
        const fundiesChannel = guild.channels.cache.find(
            ch => ch.isTextBased() && (
                ch.name.toLowerCase().includes("fundies") ||
                ch.name.toLowerCase().includes("fundamentals")
            )
        );

        if (!fundiesChannel) {
            await message.reply(`❌ Fundies/fundamentals channel not found in this server.`);
            return;
        }

        const messages = await fetchAllMessages(fundiesChannel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = "fundies.json";

        const s3Url = await uploadToS3(filename, jsonData);
        await message.reply(`✅ Exported fundies/fundamentals: ${messages.length} messages → ${filename}\n☁️ ${s3Url}`);
        console.log(`✅ Exported ${messages.length} messages from fundies/fundamentals channel`);
    } catch (error) {
        console.error(error);
        await message.reply("❌ Error exporting fundies/fundamentals: " + error.message);
    }
}

async function handleExportDisadvantage(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply("❌ This command must be used in a server.");
        return;
    }

    try {
        await message.reply(`⏳ Exporting disadvantage...`);

        const disadvantageChannel = guild.channels.cache.find(
            ch => ch.isTextBased() && ch.name.toLowerCase().includes("disadvantage")
        );

        if (!disadvantageChannel) {
            await message.reply(`❌ Disadvantage channel not found in this server.`);
            return;
        }

        const messages = await fetchAllMessages(disadvantageChannel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = "disadvantage.json";

        const s3Url = await uploadToS3(filename, jsonData);
        await message.reply(`✅ Exported disadvantage: ${messages.length} messages → ${filename}\n☁️ ${s3Url}`);
        console.log(`✅ Exported ${messages.length} messages from disadvantage channel`);
    } catch (error) {
        console.error(error);
        await message.reply("❌ Error exporting disadvantage: " + error.message);
    }
}

async function handleExportAdvantage(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply("❌ This command must be used in a server.");
        return;
    }

    try {
        await message.reply(`⏳ Exporting advantage...`);

        const advantageChannel = guild.channels.cache.find(
            ch => ch.isTextBased() && ch.name.toLowerCase().includes("advantage")
        );

        if (!advantageChannel) {
            await message.reply(`❌ Advantage channel not found in this server.`);
            return;
        }

        const messages = await fetchAllMessages(advantageChannel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = "advantage.json";

        const s3Url = await uploadToS3(filename, jsonData);
        await message.reply(`✅ Exported advantage: ${messages.length} messages → ${filename}\n☁️ ${s3Url}`);
        console.log(`✅ Exported ${messages.length} messages from advantage channel`);
    } catch (error) {
        console.error(error);
        await message.reply("❌ Error exporting advantage: " + error.message);
    }
}

async function handleExportNeutral(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply("❌ This command must be used in a server.");
        return;
    }

    try {
        await message.reply(`⏳ Exporting neutral...`);

        const neutralChannel = guild.channels.cache.find(
            ch => ch.isTextBased() && ch.name.toLowerCase().includes("neutral")
        );

        if (!neutralChannel) {
            await message.reply(`❌ Neutral channel not found in this server.`);
            return;
        }

        const messages = await fetchAllMessages(neutralChannel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = "neutral.json";

        const s3Url = await uploadToS3(filename, jsonData);
        await message.reply(`✅ Exported neutral: ${messages.length} messages → ${filename}\n☁️ ${s3Url}`);
        console.log(`✅ Exported ${messages.length} messages from neutral channel`);
    } catch (error) {
        console.error(error);
        await message.reply("❌ Error exporting neutral: " + error.message);
    }
}
