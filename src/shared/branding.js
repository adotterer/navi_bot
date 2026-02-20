const { EmbedBuilder } = require('discord.js');

const BRAND_COLOR = '#0099ff';

/**
 * Creates a base embed with common branding elements applied.
 * @returns {EmbedBuilder}
 */
function createBaseEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setFooter({ text: 'Bot Framework' })
    .setTimestamp();
}

module.exports = {
  BRAND_COLOR,
  createBaseEmbed,
};
