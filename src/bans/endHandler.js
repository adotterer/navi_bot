import { getSession, getActiveSessionForPlayer, deleteSession } from './banSessionStore.js';

/**
 * Handle /end slash command: either participant can end the session (e.g. after a set or when done playing).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleEnd(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    let matchId = interaction.options.getString('match_id');
    let session = null;

    if (matchId) {
      session = await getSession(matchId);
    } else {
      session = await getActiveSessionForPlayer(interaction.user.id, interaction.guildId);
      if (session) matchId = session.matchId;
    }

    if (!session) {
      await interaction.editReply(
        '❌ No active session found. Use the match ID from the embed if you have one, or you may have already ended it.'
      );
      return;
    }

    const isParticipant =
      session.player1Id === interaction.user.id || session.player2Id === interaction.user.id;
    if (!isParticipant) {
      await interaction.editReply('❌ Only a participant in this match can end the session.');
      return;
    }

    await deleteSession(matchId);
    await interaction.editReply('✅ Session ended. Use `/coinflip` or `/bo3` (etc.) to start a new match.');
  } catch (err) {
    console.error('[endHandler] error:', err);
    try {
      await interaction.editReply('❌ Something went wrong ending the session.');
    } catch (_) {}
  }
}
