const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const DELETE_PAUSE_MS = 350;

function findAskNaviChannel(guild) {
    if (!guild) return null;
    return guild.channels.cache.find((ch) => {
        const name = ch?.name?.toLowerCase() || "";
        const normalized = name.replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
        return ch.isTextBased() && normalized.includes("ask") && normalized.includes("navi");
    }) || null;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleCleanup(message, client, options = {}) {
    const { deleteAll = false } = options;
    const guild = message.guild;
    if (!guild) {
        await message.reply("❌ This command must be used in a server.");
        return;
    }

    const channel = findAskNaviChannel(guild);
    if (!channel) {
        await message.reply("❌ Could not find the ask-navi channel.");
        return;
    }

    const now = Date.now();
    let totalDeleted = 0;
    let pinnedSkipped = 0;
    let failedDeletes = 0;
    let beforeId = undefined;

    while (true) {
        const batch = await channel.messages.fetch({ limit: 100, before: beforeId });
        if (!batch.size) break;

        const recentMessages = [];
        const oldMessages = [];

        for (const msg of batch.values()) {
            if (msg.id === message.id) continue;
            const matchesScope = deleteAll || msg.author?.id === client.user?.id;
            if (!matchesScope) continue;

            if (msg.pinned) {
                pinnedSkipped += 1;
                continue;
            }

            const ageMs = now - msg.createdTimestamp;
            if (ageMs < TWO_WEEKS_MS) {
                recentMessages.push(msg);
            } else {
                oldMessages.push(msg);
            }
        }

        if (recentMessages.length > 0) {
            const deleted = await channel.bulkDelete(recentMessages, true);
            totalDeleted += deleted.size;
            if (deleted.size < recentMessages.length) {
                failedDeletes += recentMessages.length - deleted.size;
            }
        }

        for (const msg of oldMessages) {
            try {
                await msg.delete();
                totalDeleted += 1;
            } catch (error) {
                failedDeletes += 1;
            }
            await sleep(DELETE_PAUSE_MS);
        }

        beforeId = batch.last().id;
    }

    const scopeLabel = deleteAll ? "all messages" : "bot messages";
    const failNote = failedDeletes > 0 ? ` (failed: ${failedDeletes})` : "";
    await message.reply(
        `🧹 Cleanup complete for ${scopeLabel} in #${channel.name}. Deleted: ${totalDeleted}, pinned skipped: ${pinnedSkipped}${failNote}.`
    );
}
