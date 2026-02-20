/**
 * Shared style constants for Discord embeds used across the application
 * (e.g., !mu and !mq commands)
 */

const EMBED_CONSTANTS = {
  COLORS: {
    DEFAULT: 0x0099FF,
    ERROR: 0xE74C3C,
    SUCCESS: 0x2ECC71,
    INFO: 0x3498DB,
    WARNING: 0xF1C40F,
    ICEBORNE: 0xADD8E6,
    MYSTERY: 0x9B59B6
  },
  BRANDING: {
    FOOTER_TEXT: 'Monster Hunter World: Iceborne',
    FOOTER_ICON_URL: 'https://i.imgur.com/vU5T8Y8.png', // Placeholder icon
    AUTHOR_NAME: 'Monster Hunter Bot',
    AUTHOR_ICON_URL: 'https://i.imgur.com/26H7G6K.png' // Placeholder icon
  },
  LAYOUT: {
    THUMBNAIL_DEFAULT: 'https://i.imgur.com/vU5T8Y8.png',
    FIELD_INLINE: true
  }
};

module.exports = EMBED_CONSTANTS;
