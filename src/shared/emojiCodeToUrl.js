/** Converts a Discord custom emoji shortcode (<:name:id> or <a:name:id>) into its CDN image URL. */
export function emojiCodeToUrl(code) {
    const m = code && code.match(/<(a?):([^:]+):(\d+)>/);
    if (!m) return null;
    const ext = m[1] === 'a' ? 'gif' : 'png';
    return `https://cdn.discordapp.com/emojis/${m[3]}.${ext}`;
}
