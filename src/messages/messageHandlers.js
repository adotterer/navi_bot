export const followupResponses = [
    "Coulds make us feel empowered and remind us we're all still learning. 🎮",
    "The word 'could' reminds us we had options—let's focus on the next play! 💫",
    "'Could' is about growth, not regret. You've got this next time! 🚀",
    "Remember, 'could' means you understand what should happen next time. That's progress! ✨",
    "Swap 'should' for 'could' and you'll feel way better about any situation. 🎯",
    "Using 'could' takes the pressure off and keeps the fun going! 🎪",
    "Princess Zelda herself will be notified immediately 👑",
    "Even Link wouldn't say 'should'—have 🤐",
    "The Triforce of wisdom demands you use the word 'could' instead! ✨",
    "The Great Deku Tree is disappointed in your use of 'should'. Plant a 'could' instead! 🌳",
];

export const lanWarningResponses = [
    "Stow your fear, it's now or never!",
    "⚠️ WARNING: LAN is not Guaranteed 🚨",
];

export async function handleShouldHave(message) {
    // Only when the speaker is talking about themselves (first person). Don't correct
    // "X and Y should have..." or "they should have..." — that's about others, not self-criticism.
    const match = message.content.match(/\b(I|we)\s+should\s+have\b/i);
    if (!match) return false;

    const after = message.content.slice(match.index + match[0].length).trim();
    const tail = after ? ` ${after}` : "";

    const pool = Array.isArray(followupResponses) ? followupResponses : [String(followupResponses)];
    const followup = pool[Math.floor(Math.random() * pool.length)];

    await message.reply(
        `<:6symbolnavi:1341400385709019138> Hey Listen ${message.author}! Remember to say, you *could* have${tail}! ${followup}`
    );
    
    siteTimeout(() => {
        message.send(".... <@596207448935628812> is being summommed...")

    }, 2000)


    return true;
}

export async function handleArenaIsUp(message) {
    if (message.author.username !== "condymathceo") return false;

    if (!message.content.toLowerCase().includes("arena is up") &&
        !message.content.toLowerCase().includes("arena is ready")) {
        return false;
    }

    const pool = Array.isArray(lanWarningResponses) ? lanWarningResponses : [String(lanWarningResponses)];
    const warning = pool[Math.floor(Math.random() * pool.length)];
    await message.reply(warning);
    return true;
}
