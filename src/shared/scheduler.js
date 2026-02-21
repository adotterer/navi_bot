import cron from 'node-cron';
import { fetchAllMessages, uploadToS3 } from './s3Helper.js';
import { checkTodaysTournaments } from '../tournaments/dailyTournamentCheck.js';

export function initializeScheduler(client) {
    // Weekly export every Sunday at 2 AM UTC
    // Cron format: minute hour day month dayOfWeek
    // Testing: 5 1 * * * = Every day at 1:05 AM America/New_York
    // Production: 0 2 * * 0 = Every Sunday at 2:00 AM UTC
    const weeklyExportTask = cron.schedule('24 1 * * *', async () => {
        console.log('📅 Starting scheduled weekly export...');
        
        try {
            const guild = client.guilds.cache.first();
            if (!guild) {
                console.error('❌ No guild found for scheduled export');
                return;
            }

            const categoryNames = ["Match Ups (B-L)", "Match Ups (M-Z)"];
            let totalChannels = 0;
            let totalMessages = 0;
            let glossaryMessages = 0;
            let fundiesMessages = 0;
            let glossaryExported = false;
            let fundiesExported = false;
            const startTime = new Date();

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

                        await uploadToS3(filename, jsonData);

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
                    await uploadToS3("glossary.json", jsonData);
                    glossaryMessages = messages.length;
                    glossaryExported = true;
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
                    await uploadToS3("fundies.json", jsonData);
                    fundiesMessages = messages.length;
                    fundiesExported = true;
                    totalMessages += messages.length;
                    totalChannels++;
                    console.log(`✅ Exported fundies/fundamentals: ${messages.length} messages`);
                }
            } catch (error) {
                console.error(`❌ Error exporting fundies/fundamentals:`, error.message);
            }

            // Export disadvantage
            let disadvantageMessages = 0;
            let disadvantageExported = false;
            try {
                const disadvantageChannel = guild.channels.cache.find(
                    ch => ch.isTextBased() && ch.name.toLowerCase().includes("disadvantage")
                );
                if (disadvantageChannel) {
                    console.log(`📥 Exporting disadvantage...`);
                    const messages = await fetchAllMessages(disadvantageChannel);
                    const jsonData = JSON.stringify(messages, null, 2);
                    await uploadToS3("disadvantage.json", jsonData);
                    disadvantageMessages = messages.length;
                    disadvantageExported = true;
                    totalMessages += messages.length;
                    totalChannels++;
                    console.log(`✅ Exported disadvantage: ${messages.length} messages`);
                }
            } catch (error) {
                console.error(`❌ Error exporting disadvantage:`, error.message);
            }

            // Export advantage
            let advantageMessages = 0;
            let advantageExported = false;
            try {
                const advantageChannel = guild.channels.cache.find(
                    ch => ch.isTextBased() && ch.name.toLowerCase().includes("advantage")
                );
                if (advantageChannel) {
                    console.log(`📥 Exporting advantage...`);
                    const messages = await fetchAllMessages(advantageChannel);
                    const jsonData = JSON.stringify(messages, null, 2);
                    await uploadToS3("advantage.json", jsonData);
                    advantageMessages = messages.length;
                    advantageExported = true;
                    totalMessages += messages.length;
                    totalChannels++;
                    console.log(`✅ Exported advantage: ${messages.length} messages`);
                }
            } catch (error) {
                console.error(`❌ Error exporting advantage:`, error.message);
            }

            // Export neutral
            let neutralMessages = 0;
            let neutralExported = false;
            try {
                const neutralChannel = guild.channels.cache.find(
                    ch => ch.isTextBased() && ch.name.toLowerCase().includes("neutral")
                );
                if (neutralChannel) {
                    console.log(`📥 Exporting neutral...`);
                    const messages = await fetchAllMessages(neutralChannel);
                    const jsonData = JSON.stringify(messages, null, 2);
                    await uploadToS3("neutral.json", jsonData);
                    neutralMessages = messages.length;
                    neutralExported = true;
                    totalMessages += messages.length;
                    totalChannels++;
                    console.log(`✅ Exported neutral: ${messages.length} messages`);
                }
            } catch (error) {
                console.error(`❌ Error exporting neutral:`, error.message);
            }

            const endTime = new Date();
            const duration = Math.round((endTime - startTime) / 1000); // seconds
            
            console.log(`✅ Weekly export completed: ${totalChannels} channels, ${totalMessages} total messages`);
            
            // Send notification to Moderators chat channel
            await notifyModerators(guild, totalChannels, totalMessages, duration, {
                glossaryExported,
                glossaryMessages,
                fundiesExported,
                fundiesMessages,
                disadvantageExported,
                disadvantageMessages,
                advantageExported,
                advantageMessages,
                neutralExported,
                neutralMessages
            });
        } catch (error) {
            console.error('❌ Scheduled export failed:', error);
            // Still notify moderators of failure
            try {
                const guild = client.guilds.cache.first();
                await notifyModeratorsOfFailure(guild, error.message);
            } catch (notifyError) {
                console.error('❌ Failed to send failure notification:', notifyError);
            }
        }
    }, {
        timezone: 'America/New_York'
    });

    // Optional: Run on startup for testing (comment out in production)
    // Uncomment the line below to test the scheduler immediately when bot starts
    // task.emit('tick');

    console.log('📅 Weekly export scheduler initialized (runs every day at 1:24 AM America/New_York for testing)');
    
    // ========== DAILY TOURNAMENT CHECK ==========
    // Runs daily at 8:30 AM EST to check for Zelda players in tournaments
    // Cron format: minute hour day month dayOfWeek
    // '30 8 * * *' = Every day at 8:30 AM America/New_York
    const dailyTournamentTask = cron.schedule('30 11 * * *', async () => {
        console.log('🎮 Starting daily tournament check for Zelda players...');
        
        try {
            const guild = client.guilds.cache.first();
            if (!guild) {
                console.error('❌ No guild found for daily tournament check');
                return;
            }

            const STARTGG_TOKEN = process.env.STARTGG_AUTH_TOKEN || '';
            if (!STARTGG_TOKEN) {
                console.error('❌ Start.gg API token not configured');
                return;
            }

            // Find the #daily-tournaments-streams channel
            const channel = guild.channels.cache.find(
                ch => ch.isTextBased() && ch.name === 'audit-logs'
            );

            if (!channel) {
                console.warn('⚠️ #audit-logs channel not found');
                return;
            }

            // Check today's tournaments
            const tournaments = await checkTodaysTournaments(STARTGG_TOKEN);

            if (tournaments.length === 0) {
                await channel.send('❌ No Zelda players found in today\'s tournaments with Ultimate Singles.');
                return;
            }

            // Post one message per tournament
            let postedCount = 0;
            for (const tournament of tournaments) {
                try {
                    const startTime = new Date(tournament.startAt * 1000).toLocaleTimeString('en-US', { 
                        hour: '2-digit', 
                        minute: '2-digit', 
                        timeZone: 'America/New_York'
                    });
                    const streamInfo = tournament.streams.length > 0
                        ? tournament.streams.map(s => {
                            const source = (s.streamSource || '').toString().toUpperCase();
                            const label = `${s.streamName} (${source || 'Stream'})`;
                            let url;
                            if (source === 'TWITCH') {
                                url = `https://www.twitch.tv/${encodeURIComponent(s.streamName)}`;
                            } else if (source === 'YOUTUBE') {
                                url = `https://www.youtube.com/@${encodeURIComponent(s.streamName)}`;
                            } else if (s.streamName) {
                                url = `https://www.twitch.tv/${encodeURIComponent(s.streamName)}`;
                            } else {
                                return label;
                            }
                            return `[${label}](${url})`;
                        }).join(', ')
                        : 'No streams listed';

                    const playersList = tournament.zeldaPlayers
                        .map(p => `• ${p.gamerTag}`)
                        .join('\n');

                    const startggUrl = `https://www.start.gg/${tournament.tournamentSlug}`;
                    const messageContent = `🏆 **${tournament.tournamentName}**\n` +
                        `📅 Start: ${startTime} EST\n` +
                        `🎮 Event: ${tournament.eventName}\n` +
                        `👤 Zelda Player(s):\n${playersList}\n` +
                        `📺 Streams: ${streamInfo}\n` +
                        `🔗 [Tournament page](${startggUrl})`;

                    await channel.send(messageContent);
                    postedCount++;
                } catch (error) {
                    console.error(`❌ Error posting tournament message:`, error.message);
                }
            }

            console.log(`✅ Daily tournament check completed: ${postedCount} tournament(s) posted`);
        } catch (error) {
            console.error('❌ Daily tournament check failed:', error);
        }
    }, {
        timezone: 'America/New_York'
    });

    console.log('📅 Daily tournament check scheduler initialized (runs every day at 8:30 AM America/New_York)');
    return weeklyExportTask;
}

// Helper function to send success notification to audit-logs
async function notifyModerators(guild, channelsExported, messagesExported, duration, extraExports = {}) {
    try {
        // Find the audit-logs channel
        const auditLogsChannel = guild.channels.cache.find(
            ch => ch.isTextBased() && ch.name === 'audit-logs'
        );
        
        if (!auditLogsChannel) {
            console.warn('⚠️  audit-logs channel not found');
            return;
        }

        // Send notification
        const glossaryLine = extraExports.glossaryExported
            ? `• **Glossary:** ${extraExports.glossaryMessages.toLocaleString()} messages`
            : `• **Glossary:** Not found`;
        const fundiesLine = extraExports.fundiesExported
            ? `• **Fundies:** ${extraExports.fundiesMessages.toLocaleString()} messages`
            : `• **Fundies:** Not found`;
        const disadvantageLine = extraExports.disadvantageExported
            ? `• **Disadvantage:** ${extraExports.disadvantageMessages.toLocaleString()} messages`
            : `• **Disadvantage:** Not found`;
        const advantageLine = extraExports.advantageExported
            ? `• **Advantage:** ${extraExports.advantageMessages.toLocaleString()} messages`
            : `• **Advantage:** Not found`;
        const neutralLine = extraExports.neutralExported
            ? `• **Neutral:** ${extraExports.neutralMessages.toLocaleString()} messages`
            : `• **Neutral:** Not found`;

        const message = `✅ **Daily Export Complete**\n\n📊 Summary:\n• **Channels Exported:** ${channelsExported}\n• **Total Messages:** ${messagesExported.toLocaleString()}\n• **Duration:** ${duration}s\n${glossaryLine}\n${fundiesLine}\n${disadvantageLine}\n${advantageLine}\n${neutralLine}\n• **Status:** All data synced to S3 for AI analysis\n\n🤖 Navi now has the latest community insights!`;

        await auditLogsChannel.send(message);
        console.log('📢 Notification sent to audit-logs');
    } catch (error) {
        console.error('❌ Failed to send notification:', error.message);
    }
}

// Helper function to send failure notification to audit-logs
async function notifyModeratorsOfFailure(guild, errorMessage) {
    try {
        const auditLogsChannel = guild.channels.cache.find(
            ch => ch.isTextBased() && ch.name === 'audit-logs'
        );
        
        if (!auditLogsChannel) return;

        const message = `❌ **Daily Matchup Export Failed**\n\n⚠️ Error: ${errorMessage}\n\nPlease check the bot logs or try running \`!export matchups\` manually.`;

        await auditLogsChannel.send(message);
        console.log('📢 Failure notification sent to audit-logs');
    } catch (error) {
        console.error('❌ Failed to send failure notification:', error.message);
    }
}
