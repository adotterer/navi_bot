import fs from 'fs';
import path from 'path';
import { EmbedBuilder } from "discord.js";
import { fetchAllMessages, fetchFromS3, uploadToS3 } from '../shared/s3Helper.js';
import { buildCharacterAliasMap, resolveCharacterFromText } from '../matchups/characterAliases.js';
import { createSplitEmbeds } from '../shared/messageSplitter.js';
import { INFO_EMBED_COLOR } from '../messages/faqAndAliasHandler.js';

const ERROR_EMBED_COLOR = '#FF4444';

/** Isolated directory for export files; served under /exports. */
const EXPORTS_DIR = path.join(process.cwd(), 'data', 'exports');

/** Source-of-truth list of matchup channel names (same format as values in character-aliases.json). */
const CANONICAL_THREADS_PATH = path.join(process.cwd(), 'data', 'canonical-character-threads.json');

const MATCHUP_CATEGORY_NAMES = ['Match Ups (B-L)', 'Match Ups (M-Z)'];

/**
 * Collect all text channel names from the Match Ups (B-L) and (M-Z) categories.
 * Returns a sorted array of slugs (channel names), e.g. ["banjo-and-kazooie", "mr-game-and-watch", "peach | daisy"].
 * Use this for a canonical list of character threads; also written to data/canonical-character-threads.json when exports run.
 */
export function getMatchupChannelSlugs(guild) {
    if (!guild || !guild.channels?.cache) return [];
    const slugs = [];
    for (const categoryName of MATCHUP_CATEGORY_NAMES) {
        const category = guild.channels.cache.find(ch => ch.children && ch.name === categoryName);
        if (!category) continue;
        for (const [, ch] of category.children.cache.filter(ch => ch.isTextBased())) {
            slugs.push(ch.name);
        }
    }
    return [...new Set(slugs)].sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * Refresh the canonical character threads file from the guild's Match Ups categories.
 * Call after exporting matchup channels (e.g. from handleExportMatchups or the weekly scheduler).
 */
export function writeCanonicalCharacterThreads(guild) {
    const slugs = getMatchupChannelSlugs(guild);
    const dir = path.dirname(CANONICAL_THREADS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CANONICAL_THREADS_PATH, JSON.stringify(slugs, null, 2), 'utf8');
    console.log(`📋 Wrote ${slugs.length} canonical character threads to ${path.basename(CANONICAL_THREADS_PATH)}`);
}

function ensureExportsDir() {
    if (!fs.existsSync(EXPORTS_DIR)) {
        fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }
}

function buildEmbed(description, color = INFO_EMBED_COLOR) {
    return new EmbedBuilder().setColor(color).setDescription(description);
}

export async function handleExportFalco(message) {
    const guild = message.guild;
    const channel = guild.channels.cache.find(ch => ch.name === "falco");
    
    if (!channel) {
        await message.reply({ embeds: [buildEmbed("❌ Channel 'falco' not found!", ERROR_EMBED_COLOR)] });
        return;
    }
    
    try {
        await message.reply({ embeds: [buildEmbed("⏳ Exporting messages from #falco...")] });
        
        const messages = await fetchAllMessages(channel);
        
        const jsonData = JSON.stringify(messages, null, 2);
        ensureExportsDir();
        fs.writeFileSync(path.join(EXPORTS_DIR, 'falco_messages.json'), jsonData);
        
        await message.reply({ embeds: [buildEmbed(`✅ Exported ${messages.length} messages to falco_messages.json`)] });
        console.log(`✅ Exported ${messages.length} messages from #falco`);
    } catch (error) {
        console.error(error);
        await message.reply({ embeds: [buildEmbed("❌ Error exporting messages: " + error.message, ERROR_EMBED_COLOR)] });
    }
}

function findMatchupChannel(guild, slug) {
    for (const categoryName of MATCHUP_CATEGORY_NAMES) {
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
        await message.reply({ embeds: [buildEmbed("❌ This command must be used in a server.", ERROR_EMBED_COLOR)] });
        return;
    }

    const input = message.content.trim().split(" ").slice(1).join(" ").trim();
    if (!input) {
        await message.reply({ embeds: [buildEmbed("❌ Usage: `!export <character>` (e.g., `!export palu`)", ERROR_EMBED_COLOR)] });
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
        await message.reply({ embeds: [buildEmbed(`❌ Channel '${slug}' not found in Match Ups categories.`, ERROR_EMBED_COLOR)] });
        return;
    }

    try {
        await message.reply({ embeds: [buildEmbed(`⏳ Exporting messages from #${channel.name}...`)] });

        const messages = await fetchAllMessages(channel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = `${channel.name}.json`;
        ensureExportsDir();
        fs.writeFileSync(path.join(EXPORTS_DIR, filename), jsonData);

        const s3Url = await uploadToS3(filename, jsonData);
        await message.reply({ embeds: [buildEmbed(`✅ Exported **#${channel.name}**: ${messages.length} messages → \`${filename}\`\n☁️ ${s3Url}`)] });
        console.log(`✅ Exported ${messages.length} messages from #${channel.name}`);
    } catch (error) {
        console.error(error);
        await message.reply({ embeds: [buildEmbed("❌ Error exporting messages: " + error.message, ERROR_EMBED_COLOR)] });
    }
}

export async function handleExportMatchups(message) {
    const guild = message.guild;
    
    try {
        await message.reply({ embeds: [buildEmbed("⏳ Exporting all Match Ups channels, glossary, fundies, and game state channels...")] });
        
        let totalChannels = 0;
        let totalMessages = 0;
        const exportedFiles = [];
        
        for (const categoryName of MATCHUP_CATEGORY_NAMES) {
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
                    ensureExportsDir();
                    fs.writeFileSync(path.join(EXPORTS_DIR, filename), jsonData);
                    
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

        writeCanonicalCharacterThreads(guild);

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
        
        const summary =
            `✅ Exported **${totalChannels} channels** with **${totalMessages} total messages**!\n\n` +
            exportedFiles.slice(0, 10).join('\n') +
            (exportedFiles.length > 10 ? `\n... and ${exportedFiles.length - 10} more` : '');
        const embeds = createSplitEmbeds(EmbedBuilder, summary, INFO_EMBED_COLOR);
        await message.channel.send({ embeds });
        console.log(`✅ Completed: ${totalChannels} channels, ${totalMessages} total messages`);
    } catch (error) {
        console.error(error);
        await message.reply({ embeds: [buildEmbed("❌ Error exporting Match Ups channels: " + error.message, ERROR_EMBED_COLOR)] });
    }
}

export async function handleListThreadCounts(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply({ embeds: [buildEmbed("❌ This command must be used in a server.", ERROR_EMBED_COLOR)] });
        return;
    }

    const counts = [];

    try {
        await message.reply({ embeds: [buildEmbed("⏳ Counting messages in each character thread...")] });

        for (const categoryName of MATCHUP_CATEGORY_NAMES) {
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
            await message.reply({ embeds: [buildEmbed("⚠️ No matchup channels found.", ERROR_EMBED_COLOR)] });
            return;
        }

        counts.sort((a, b) => b.count - a.count);
        const lines = counts.map(c => `#${c.name}: ${c.count} messages`).join("\n");
        const output = `📊 **Character Thread Message Counts** (${counts.length})\n${lines}`;

        const embeds = createSplitEmbeds(EmbedBuilder, output, INFO_EMBED_COLOR);
        await message.channel.send({ embeds });
    } catch (error) {
        console.error(error);
        await message.reply({ embeds: [buildEmbed("❌ Error counting messages: " + error.message, ERROR_EMBED_COLOR)] });
    }
}

async function handleExportGlossary(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply({ embeds: [buildEmbed("❌ This command must be used in a server.", ERROR_EMBED_COLOR)] });
        return;
    }

    try {
        await message.reply({ embeds: [buildEmbed("⏳ Exporting glossary...")] });

        const glossaryChannel = guild.channels.cache.find(
            ch => ch.isTextBased() && ch.name.toLowerCase().includes("glossary")
        );

        if (!glossaryChannel) {
            await message.reply({ embeds: [buildEmbed("❌ Glossary channel not found in this server.", ERROR_EMBED_COLOR)] });
            return;
        }

        const messages = await fetchAllMessages(glossaryChannel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = "glossary.json";

        const s3Url = await uploadToS3(filename, jsonData);
        await message.reply({ embeds: [buildEmbed(`✅ Exported **glossary**: ${messages.length} messages → \`${filename}\`\n☁️ ${s3Url}`)] });
        console.log(`✅ Exported ${messages.length} messages from glossary channel`);
    } catch (error) {
        console.error(error);
        await message.reply({ embeds: [buildEmbed("❌ Error exporting glossary: " + error.message, ERROR_EMBED_COLOR)] });
    }
}

async function handleExportFundies(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply({ embeds: [buildEmbed("❌ This command must be used in a server.", ERROR_EMBED_COLOR)] });
        return;
    }

    try {
        await message.reply({ embeds: [buildEmbed("⏳ Exporting fundies/fundamentals...")] });

        const fundiesChannel = guild.channels.cache.find(
            ch => ch.isTextBased() && (
                ch.name.toLowerCase().includes("fundies") ||
                ch.name.toLowerCase().includes("fundamentals")
            )
        );

        if (!fundiesChannel) {
            await message.reply({ embeds: [buildEmbed("❌ Fundies/fundamentals channel not found in this server.", ERROR_EMBED_COLOR)] });
            return;
        }

        const messages = await fetchAllMessages(fundiesChannel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = "fundies.json";

        const s3Url = await uploadToS3(filename, jsonData);
        await message.reply({ embeds: [buildEmbed(`✅ Exported **fundies/fundamentals**: ${messages.length} messages → \`${filename}\`\n☁️ ${s3Url}`)] });
        console.log(`✅ Exported ${messages.length} messages from fundies/fundamentals channel`);
    } catch (error) {
        console.error(error);
        await message.reply({ embeds: [buildEmbed("❌ Error exporting fundies/fundamentals: " + error.message, ERROR_EMBED_COLOR)] });
    }
}

async function handleExportDisadvantage(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply({ embeds: [buildEmbed("❌ This command must be used in a server.", ERROR_EMBED_COLOR)] });
        return;
    }

    try {
        await message.reply({ embeds: [buildEmbed("⏳ Exporting disadvantage...")] });

        const disadvantageChannel = guild.channels.cache.find(
            ch => ch.isTextBased() && ch.name.toLowerCase().includes("disadvantage")
        );

        if (!disadvantageChannel) {
            await message.reply({ embeds: [buildEmbed("❌ Disadvantage channel not found in this server.", ERROR_EMBED_COLOR)] });
            return;
        }

        const messages = await fetchAllMessages(disadvantageChannel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = "disadvantage.json";

        const s3Url = await uploadToS3(filename, jsonData);
        await message.reply({ embeds: [buildEmbed(`✅ Exported **disadvantage**: ${messages.length} messages → \`${filename}\`\n☁️ ${s3Url}`)] });
        console.log(`✅ Exported ${messages.length} messages from disadvantage channel`);
    } catch (error) {
        console.error(error);
        await message.reply({ embeds: [buildEmbed("❌ Error exporting disadvantage: " + error.message, ERROR_EMBED_COLOR)] });
    }
}

async function handleExportAdvantage(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply({ embeds: [buildEmbed("❌ This command must be used in a server.", ERROR_EMBED_COLOR)] });
        return;
    }

    try {
        await message.reply({ embeds: [buildEmbed("⏳ Exporting advantage...")] });

        const advantageChannel = guild.channels.cache.find(
            ch => ch.isTextBased() && ch.name.toLowerCase().includes("advantage")
        );

        if (!advantageChannel) {
            await message.reply({ embeds: [buildEmbed("❌ Advantage channel not found in this server.", ERROR_EMBED_COLOR)] });
            return;
        }

        const messages = await fetchAllMessages(advantageChannel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = "advantage.json";

        const s3Url = await uploadToS3(filename, jsonData);
        await message.reply({ embeds: [buildEmbed(`✅ Exported **advantage**: ${messages.length} messages → \`${filename}\`\n☁️ ${s3Url}`)] });
        console.log(`✅ Exported ${messages.length} messages from advantage channel`);
    } catch (error) {
        console.error(error);
        await message.reply({ embeds: [buildEmbed("❌ Error exporting advantage: " + error.message, ERROR_EMBED_COLOR)] });
    }
}

async function handleExportNeutral(message) {
    const guild = message.guild;
    if (!guild) {
        await message.reply({ embeds: [buildEmbed("❌ This command must be used in a server.", ERROR_EMBED_COLOR)] });
        return;
    }

    try {
        await message.reply({ embeds: [buildEmbed("⏳ Exporting neutral...")] });

        const neutralChannel = guild.channels.cache.find(
            ch => ch.isTextBased() && ch.name.toLowerCase().includes("neutral")
        );

        if (!neutralChannel) {
            await message.reply({ embeds: [buildEmbed("❌ Neutral channel not found in this server.", ERROR_EMBED_COLOR)] });
            return;
        }

        const messages = await fetchAllMessages(neutralChannel);
        const jsonData = JSON.stringify(messages, null, 2);
        const filename = "neutral.json";

        const s3Url = await uploadToS3(filename, jsonData);
        await message.reply({ embeds: [buildEmbed(`✅ Exported **neutral**: ${messages.length} messages → \`${filename}\`\n☁️ ${s3Url}`)] });
        console.log(`✅ Exported ${messages.length} messages from neutral channel`);
    } catch (error) {
        console.error(error);
        await message.reply({ embeds: [buildEmbed("❌ Error exporting neutral: " + error.message, ERROR_EMBED_COLOR)] });
    }
}
