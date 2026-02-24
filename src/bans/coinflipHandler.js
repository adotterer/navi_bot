import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { createSession, updateSession, getActiveSessionForPlayer } from './banSessionStore.js';
import { STAGES } from './stageData.js';

const INFO_EMBED_COLOR = 0x1e88e5;

/**
 * Get the list of stages the current-turn player can ban or select for this session.
 * @param {object} session
 * @returns {{ name: string, aliases: string[] }[]}
 */
function getAllowedStagesForSession(session) {
  const banned = session.bannedStages || [];
  const isSelect = session.turnPhase === 'game1_select';
  const starters = STAGES.starters.filter(s => !banned.includes(s.name));
  if (isSelect) return starters;
  if (session.turnPhase && session.turnPhase.includes('game1')) return starters;
  return [];
}

/**
 * Build an ActionRow with a StringSelectMenu for the current turn's allowed stages, or null if none (e.g. game 1 complete).
 * @param {string} matchId
 * @param {object} session
 * @param {string} [placeholder] - e.g. "Ban a stage" or "Select stage"
 * @returns {ActionRowBuilder|null}
 */
export function buildStageSelectRow(matchId, session, placeholder = 'Ban or select a stage') {
  const allowed = getAllowedStagesForSession(session);
  if (allowed.length === 0) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ban:${matchId}`)
    .setPlaceholder(placeholder)
    .addOptions(allowed.map(s => ({ label: s.name, value: s.name })));
  return new ActionRowBuilder().addComponents(menu);
}

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
    const guildId = interaction.guildId;

    const existing1 = await getActiveSessionForPlayer(player1.id, guildId);
    if (existing1) {
      await interaction.editReply('❌ You are already in an active match. Finish it or wait for it to expire before starting another.');
      return;
    }
    const existing2 = await getActiveSessionForPlayer(player2.id, guildId);
    if (existing2) {
      await interaction.editReply('❌ Your opponent is already in an active match. They need to finish it or wait for it to expire.');
      return;
    }

    const matchId = `${guildId}-${Date.now()}`;
    const winner = Math.random() < 0.5 ? player1 : player2;
    const loser = winner.id === player1.id ? player2 : player1;

    await createSession(matchId, player1.id, player2.id, {
      guildId,
      channelId: interaction.channelId,
    });
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
        value: `${winner}, pick a stage from the **dropdown below** (or use \`/ban <stage>\`).`,
      })
      .setFooter({ text: `Match ID: ${matchId}` });

    const sessionForMenu = { bannedStages: [], turnPhase: 'game1_ban_1' };
    const row = buildStageSelectRow(matchId, sessionForMenu, 'Ban 1 stage');
    const replyPayload = { embeds: [coinFlipEmbed] };
    if (row) replyPayload.components = [row];

    await interaction.editReply(replyPayload);

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
