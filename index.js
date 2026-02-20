import { EmbedBuilder } from 'discord.js';

// Step 1: Initial setup
console.log('Hello, world!');

export const exportCommand = () => {
  const embed = new EmbedBuilder()
    .setTitle('Export Status')
    .setDescription('The data export process has been initiated successfully.')
    .setColor(0x00FF00)
    .setTimestamp();

  return embed;
};
