import { getSession, getActiveSessionForPlayer, deleteSession } from './banSessionStore.js';

/**
 * Handle /cancel-match slash command: either participant can cancel their active match.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleCancelMatch(interaction) {
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
        '❌ No active match found. You can only cancel a match you’re in; use the match ID from the embed if you have one.'
      );
      return;
    }

    const isParticipant =
      session.player1Id === interaction.user.id || session.player2Id === interaction.user.id;
    if (!isParticipant) {
      await interaction.editReply('❌ Only a participant in this match can cancel it.');
      return;
    }

    await deleteSession(matchId);
    await interaction.editReply('✅ Match cancelled. You can start a new one with `/coinflip`.');
  } catch (err) {
    console.error('[cancelMatchHandler] error:', err);
    try {
      await interaction.editReply('❌ Something went wrong cancelling the match.');
    } catch (_) {}
  }
}
