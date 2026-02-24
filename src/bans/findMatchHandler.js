/**
 * /findMatch: Challenger posts "Match started! @A VS @B" with BO3/BO5 dropdown (challenger picks) and "Accept Match" button (opponent clicks).
 * When both format is chosen and opponent accepted, the same BO3/BO5 flow starts (coinflip + stage ban).
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { createSession, updateSession, getActiveSessionForPlayer } from './banSessionStore.js';
import { buildStageSelectRow } from './coinflipHandler.js';
import { STAGES } from './stageData.js';

const INFO_EMBED_COLOR = 0x1e88e5;
const FORMAT_LABELS = { bo3: 'BO3 (first to 2 wins)', bo5: 'BO5 (first to 3 wins)' };

/** In-memory pending find-match: pendingId -> { challengerId, opponentId, guildId, channelId, accepted, format } */
const pendingFindMatches = new Map();

function buildFindMatchEmbed(pending, challengerName, opponentName, formatSet = null) {
  let desc;
  if (formatSet) {
    desc = `**Format:** ${FORMAT_LABELS[formatSet]}\n\n${pending.accepted ? 'Both confirmed. Starting match…' : 'Waiting for opponent to click **Accept Match**.'}`;
  } else if (pending.accepted) {
    desc = 'Opponent has accepted. Challenger: choose **Best of 3** or **Best of 5** from the dropdown below.';
  } else {
    desc = 'Is this match a **Best of 3** or **Best of 5**? Please use the drop down menu to confirm. The opponent must click **Accept Match**.';
  }
  return new EmbedBuilder()
    .setColor(INFO_EMBED_COLOR)
    .setTitle('Match started!')
    .setDescription(
      `<@${pending.challengerId}> VS <@${pending.opponentId}>\n\n` +
      (challengerName && opponentName ? `**${challengerName}** vs **${opponentName}**\n\n` : '') +
      desc
    )
    .setFooter({ text: 'Challenger: pick format from dropdown • Opponent: click Accept Match' });
}

function buildFindMatchComponents(pendingId, formatSet) {
  const row1 = new ActionRowBuilder();
  const dropdown = new StringSelectMenuBuilder()
    .setCustomId(`findmatch_format:${pendingId}`)
    .setPlaceholder(formatSet ? FORMAT_LABELS[formatSet] : 'Best of 3 or Best of 5?')
    .addOptions(
      { label: 'Best of 3 (first to 2 wins)', value: 'bo3' },
      { label: 'Best of 5 (first to 3 wins)', value: 'bo5' }
    );
  row1.addComponents(dropdown);

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`findmatch_accept:${pendingId}`)
      .setLabel('Accept Match')
      .setStyle(ButtonStyle.Success)
  );
  return [row1, row2];
}

/**
 * Start the actual match (coinflip + stage ban) and replace the find-match message.
 */
async function startMatch(pending, interaction, format) {
  const { challengerId, opponentId, guildId, channelId } = pending;
  const matchId = `${guildId}-${Date.now()}`;
  const player1Id = challengerId;
  const player2Id = opponentId;
  const winnerId = Math.random() < 0.5 ? player1Id : player2Id;

  await createSession(matchId, player1Id, player2Id, { guildId, channelId });
  await updateSession(matchId, {
    coinFlipWinnerId: winnerId,
    currentTurn: winnerId,
    turnPhase: 'game1_ban_1',
    format,
    gameWins: { [player1Id]: 0, [player2Id]: 0 },
  });

  const starterList = STAGES.starters.map(s => `• ${s.name} (${s.aliases.join('/')})`).join('\n');
  let winnerName = 'Winner';
  let loserName = 'Loser';
  try {
    const winner = await interaction.client.users.fetch(winnerId).catch(() => null);
    const loser = await interaction.client.users.fetch(winnerId === player1Id ? player2Id : player1Id).catch(() => null);
    if (winner) winnerName = winner.username;
    if (loser) loserName = loser.username;
  } catch (_) {}

  const coinFlipEmbed = new EmbedBuilder()
    .setColor(INFO_EMBED_COLOR)
    .setTitle(`🪙 Coin Flip Result — ${FORMAT_LABELS[format]}`)
    .setDescription(
      `**${winnerName}** won the coin flip and bans **first**!\n\nAvailable stages:\n${starterList}`
    )
    .addFields({
      name: 'Next step',
      value: `<@${winnerId}>, pick **1 stage to ban** from the dropdown below (or use \`/ban <stage>\`).\n*Only the player mentioned here can use the dropdown.*`,
    })
    .setFooter({ text: `Match: ${matchId} • Dropdown is only for the player whose turn it is` });

  const sessionForMenu = { bannedStages: [], turnPhase: 'game1_ban_1' };
  const row = buildStageSelectRow(matchId, sessionForMenu, `${winnerName}: ban 1 stage`);

  await interaction.update({
    embeds: [coinFlipEmbed],
    components: row ? [row] : [],
  });

  try {
    const winnerUser = await interaction.client.users.fetch(winnerId).catch(() => null);
    if (winnerUser) {
      await winnerUser.send({
        content: `You won the coin flip! Ban 1 stage. Use \`/ban stage:<stage> match_id:${matchId}\` in the server.`,
        embeds: [coinFlipEmbed],
      });
    }
  } catch (err) {
    console.warn('[findMatch] Could not DM winner:', err.message);
  }
  try {
    const loserId = winnerId === player1Id ? player2Id : player1Id;
    const loserUser = await interaction.client.users.fetch(loserId).catch(() => null);
    if (loserUser) {
      await loserUser.send({
        content: `${winnerName} won the coin flip and will ban first. You'll ban 2 stages after they ban 1. Match ID: \`${matchId}\``,
        embeds: [coinFlipEmbed],
      });
    }
  } catch (err) {
    console.warn('[findMatch] Could not DM loser:', err.message);
  }
}

/**
 * Handle /findMatch slash: post message with "Match started! @A VS @B", BO3/BO5 dropdown, Accept Match button.
 */
export async function handleFindMatch(interaction) {
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

    const challengerId = interaction.user.id;
    const opponentId = opponent.id;
    const guildId = interaction.guildId;

    const existing1 = await getActiveSessionForPlayer(challengerId, guildId);
    if (existing1) {
      await interaction.editReply('❌ You are already in an active match. Finish it or wait for it to expire before starting another.');
      return;
    }
    const existing2 = await getActiveSessionForPlayer(opponentId, guildId);
    if (existing2) {
      await interaction.editReply('❌ Your opponent is already in an active match. They need to finish it or wait for it to expire.');
      return;
    }

    const pending = {
      challengerId,
      opponentId,
      guildId,
      channelId: interaction.channelId,
      accepted: false,
      format: null,
    };
    const pendingId = `findmatch-${guildId}-${Date.now()}`;
    pending.id = pendingId;
    pendingFindMatches.set(pendingId, pending);

    const challengerName = interaction.user.username;
    const opponentName = opponent.username;
    const embed = buildFindMatchEmbed(pending, challengerName, opponentName, null);
    const components = buildFindMatchComponents(pendingId, null);

    await interaction.editReply({
      embeds: [embed],
      components,
    });
  } catch (err) {
    console.error('[findMatchHandler] handleFindMatch error:', err);
    try {
      await interaction.editReply('❌ Something went wrong.');
    } catch (_) {}
  }
}

/**
 * Handle format dropdown: only challenger can pick; then if opponent already accepted, start match.
 */
export async function handleFindMatchFormat(interaction) {
  const pendingId = interaction.customId.replace('findmatch_format:', '');
  const pending = pendingFindMatches.get(pendingId);
  if (!pending) {
    await interaction.reply({ content: '❌ This match request expired or was cancelled.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (interaction.user.id !== pending.challengerId) {
    await interaction.reply({ content: '❌ Only the challenger can choose the format.', ephemeral: true }).catch(() => {});
    return true;
  }

  const format = interaction.values && interaction.values[0];
  if (format !== 'bo3' && format !== 'bo5') {
    await interaction.reply({ content: '❌ Invalid format.', ephemeral: true }).catch(() => {});
    return true;
  }

  pending.format = format;

  if (pending.accepted) {
    pendingFindMatches.delete(pendingId);
    await startMatch(pending, interaction, format);
    return true;
  }

  let challengerName = interaction.user.username;
  let opponentName = null;
  try {
    const opponent = await interaction.client.users.fetch(pending.opponentId).catch(() => null);
    if (opponent) opponentName = opponent.username;
  } catch (_) {}

  const embed = buildFindMatchEmbed(pending, challengerName, opponentName, format);
  const components = buildFindMatchComponents(pendingId, format);
  await interaction.update({ embeds: [embed], components });
  return true;
}

/**
 * Handle Accept Match button: only opponent can click; then if format already chosen, start match.
 */
export async function handleFindMatchAccept(interaction) {
  const pendingId = interaction.customId.replace('findmatch_accept:', '');
  const pending = pendingFindMatches.get(pendingId);
  if (!pending) {
    await interaction.reply({ content: '❌ This match request expired or was cancelled.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (interaction.user.id !== pending.opponentId) {
    await interaction.reply({ content: '❌ Only the opponent can accept the match.', ephemeral: true }).catch(() => {});
    return true;
  }

  pending.accepted = true;

  if (pending.format) {
    pendingFindMatches.delete(pendingId);
    await startMatch(pending, interaction, pending.format);
    return true;
  }

  let challengerName = null;
  let opponentName = interaction.user.username;
  try {
    const challenger = await interaction.client.users.fetch(pending.challengerId).catch(() => null);
    if (challenger) challengerName = challenger.username;
  } catch (_) {}

  const embed = buildFindMatchEmbed(pending, challengerName, opponentName, null);
  const components = buildFindMatchComponents(pendingId, null);
  await interaction.update({ embeds: [embed], components });
  return true;
}
