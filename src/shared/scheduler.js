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

            console.log(`✅ Weekly export completed: ${totalChannels} channels, ${totalMessages} total messages`);
        } catch (error) {
            console.error('❌ Scheduled export failed:', error);
        }
    });

    // Optional: Run on startup for testing (comment out in production)
    // Uncomment the line below to test the scheduler immediately when bot starts
    // task.emit('tick');

    console.log('📅 Weekly export scheduler initialized (runs every Sunday at 2:00 AM UTC)');
    return task;
}

// Helper function to manually trigger export (useful for testing)
export function triggerExportNow(client) {
    console.log('🚀 Manually triggering export now...');
    // This would call the same logic as initializeScheduler
}
