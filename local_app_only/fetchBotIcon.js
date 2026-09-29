/**
 * One-off script: pulls the bot's own Discord avatar (Ask Navi's profile picture) and saves it as
 * PWA home-screen icon assets under public/icons/. Discord's CDN resizes on request via ?size=, so
 * no local image-processing dependency is needed. Re-run this if the bot's avatar ever changes.
 *
 * Run: node local_app_only/fetchBotIcon.js
 * Requires: DISCORD_TOKEN in .env
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { REST, Routes } from 'discord.js';

const OUT_DIR = path.join(process.cwd(), 'public', 'icons');
// Discord's CDN only accepts power-of-2 sizes (16, 32, ..., 4096), and won't upscale past the
// avatar's actual uploaded resolution — requesting 256 or 512 both just return the native image
// unchanged. Fetch once at the largest valid size and reuse it for both icon slots; manifest.json
// declares the real dimensions rather than a size we didn't actually get.
const SIZES = [
    { file: 'apple-touch-icon.png', size: 512 },
    { file: 'icon.png', size: 512 },
];

async function main() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const me = await rest.get(Routes.user('@me'));
    if (!me.avatar) throw new Error('Bot user has no avatar set.');
    if (me.avatar.startsWith('a_')) console.warn('Avatar is animated (gif) — CDN will still serve a static png fine.');

    fs.mkdirSync(OUT_DIR, { recursive: true });

    for (const { file, size } of SIZES) {
        const url = `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=${size}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(path.join(OUT_DIR, file), buffer);
        console.log(`Saved ${file} (${buffer.length} bytes)`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
