import cron from 'node-cron';
import { fetchAllMessages, uploadToS3 } from './s3Helper.js';

export function initializeScheduler(client) {
    // Weekly export every Sunday at 2 AM UTC
    // Cron format: minute hour day month dayOfWeek
    // 0 2 * * 0 = Every Sunday at 2:00 AM
    const task = cron.schedule('0 2 * * 0', async () => {
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

            const endTime = new Date();
            const duration = Math.round((endTime - startTime) / 1000); // seconds
            
            console.log(`✅ Weekly export completed: ${totalChannels} channels, ${totalMessages} total messages`);
            
            // Send notification to Moderators chat channel
            await notifyModerators(guild, totalChannels, totalMessages, duration);
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
    });

    // Optional: Run on startup for testing (comment out in production)
    // Uncomment the line below to test the scheduler immediately when bot starts
    // task.emit('tick');

    console.log('📅 Weekly export scheduler initialized (runs every Sunday at 2:00 AM UTC)');
    return task;
}

// Helper function to send success notification to Moderators chat
async function notifyModerators(guild, channelsExported, messagesExported, duration) {
    try {
        // Find Moderators category
        const moderatorsCategory = guild.channels.cache.find(
            ch => ch.isCategory && ch.name === "Moderators"
        );
        
        if (!moderatorsCategory) {
            console.warn('⚠️  Moderators category not found');
            return;
        }

        // Find chat channel in Moderators category
        const chatChannel = moderatorsCategory.children.cache.find(
            ch => ch.isTextBased() && ch.name === "chat"
        );

        if (!chatChannel) {
            console.warn('⚠️  chat channel not found in Moderators category');
            return;
        }

        // Send notification
        const message = `✅ **Weekly Matchup Export Complete**\n\n📊 Summary:\n• **Channels Exported:** ${channelsExported}\n• **Total Messages:** ${messagesExported.toLocaleString()}\n• **Duration:** ${duration}s\n• **Status:** All data synced to S3 for AI analysis\n\n🤖 Your matchup AI now has the latest community insights!`;

        await chatChannel.send(message);
        console.log('📢 Notification sent to Moderators/chat');
    } catch (error) {
        console.error('❌ Failed to send moderator notification:', error.message);
    }
}

// Helper function to send failure notification to Moderators chat
async function notifyModeratorsOfFailure(guild, errorMessage) {
    try {
        const moderatorsCategory = guild.channels.cache.find(
            ch => ch.isCategory && ch.name === "Moderators"
        );
        
        if (!moderatorsCategory) return;

        const chatChannel = moderatorsCategory.children.cache.find(
            ch => ch.isTextBased() && ch.name === "chat"
        );

        if (!chatChannel) return;

        const message = `❌ **Weekly Matchup Export Failed**\n\n⚠️ Error: ${errorMessage}\n\nPlease check the bot logs or try running \`!export matchups\` manually.`;

        await chatChannel.send(message);
        console.log('📢 Failure notification sent to Moderators/chat');
    } catch (error) {
        console.error('❌ Failed to send failure notification:', error.message);
    }
}
