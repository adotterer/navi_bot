import { EmbedBuilder } from 'discord.js';
import { createSession, updateSession } from './banSessionStore.js';
import { STAGES } from './stageData.js';

const INFO_EMBED_COLOR = 0x1e88e5;

/**
 * Handle /coinflip slash command: start a stage ban match, pick random first ban, create session.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleCoinFlip(interaction) {
  try {
    await interaction.deferReply();

    const opponent = interaction.options.getUser('opponent');
    if (!opponent) {
      await interaction.editReply('❌ Please specify an opponent.');
      return;
    }

    if (opponent.bot) {
      await interaction.editReply('❌ You cannot play against a bot.');
      return;
    }

    const player1 = interaction.user;
    const player2 = opponent;
    const matchId = `${interaction.guildId}-${Date.now()}`;

    const winner = Math.random() < 0.5 ? player1 : player2;
    const loser = winner.id === player1.id ? player2 : player1;

    await createSession(matchId, player1.id, player2.id);
    await updateSession(matchId, {
      coinFlipWinnerId: winner.id,
      currentTurn: winner.id,
      turnPhase: 'game1_ban_1',
    });

    const starterList = STAGES.starters.map(s => `• ${s.name} (${s.aliases.join('/')})`).join('\n');
    const coinFlipEmbed = new EmbedBuilder()
      .setColor(INFO_EMBED_COLOR)
      .setTitle('🪙 Coin Flip Result')
      .setDescription(
        `**${winner.username}** won the coin flip and bans **first**!\n\nAvailable stages:\n${starterList}`
      )
      .addFields({
        name: 'Next Step',
        value: `${winner}, use \`/ban <stage>\` to ban 1 stage. Include match ID: \`${matchId}\``,
      })
      .setFooter({ text: `Match ID: ${matchId} (use this with /ban if needed)` });

    await interaction.editReply({ embeds: [coinFlipEmbed] });

    try {
      await winner.send({
        content: `You won the coin flip! Ban 1 stage. Use \`/ban stage:<stage> match_id:${matchId}\` in the server.`,
        embeds: [coinFlipEmbed],
      });
    } catch (err) {
      console.warn(`[coinflip] Could not DM ${winner.username}:`, err.message);
    }

    try {
      await loser.send({
        content: `${winner.username} won the coin flip and will ban first. You'll ban 2 stages after they ban 1. Match ID: \`${matchId}\``,
        embeds: [coinFlipEmbed],
      });
    } catch (err) {
      console.warn(`[coinflip] Could not DM ${loser.username}:`, err.message);
    }
  } catch (err) {
    console.error('[coinflipHandler] error:', err);
    let message = '❌ Something went wrong with the coin flip.';
    const name = err?.name || '';
    const msg = err?.message || '';
    if (name === 'ResourceNotFoundException' || msg.includes('Requested resource not found')) {
      const table = process.env.DYNAMODB_BAN_SESSIONS_TABLE || 'navi-ban-sessions';
      message = `❌ Ban sessions table not found. Create a DynamoDB table named **${table}** with partition key **pk** (String) in the same region as your AUTH_DYNAMODB_* credentials.`;
    } else if (msg.includes('DynamoDB not configured')) {
      message = `❌ ${msg}`;
    }
    try {
      await interaction.editReply(message);
    } catch (_) {}
  }
}
