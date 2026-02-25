/**
 * /findmatch: Open-ended matchmaking. Challenger posts; anyone in the thread can click "Accept Match" to become the opponent.
 * Challenger picks BO3/BO5 from dropdown. When both someone has accepted and format is chosen, coinflip + stage ban starts.
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { createSession, updateSession, getActiveSessionForPlayer } from './banSessionStore.js';
import { buildStageSelectRow } from './coinflipHandler.js';
import { STAGES } from './stageData.js';

const INFO_EMBED_COLOR = 0x1e88e5;
const FORMAT_LABELS = { bo3: 'BO3 (first to 2 wins)', bo5: 'BO5 (first to 3 wins)' };

/** In-memory pending find-match: pendingId -> { challengerId, opponentId?, guildId, channelId, format? } */
const pendingFindMatches = new Map();

function buildFindMatchEmbed(pending, challengerName, opponentName, formatSet = null) {
  const hasOpponent = pending.opponentId != null;
  let desc;
  if (formatSet && hasOpponent) {
    desc = 'Both set! Starting match…';
  } else if (formatSet) {
    desc = `**Format:** ${FORMAT_LABELS[formatSet]}\n\nSomeone click **Accept Match** to play!`;
  } else if (hasOpponent) {
    desc = `Opponent: <@${pending.opponentId}>. Challenger: choose **Best of 3** or **Best of 5** from the dropdown below.`;
  } else {
    desc = 'Is this match a **Best of 3** or **Best of 5**? Challenger: use the dropdown. Anyone can click **Accept Match** to play!';
  }
  const vsLine = hasOpponent
    ? `<@${pending.challengerId}> VS <@${pending.opponentId}>\n\n`
    : `<@${pending.challengerId}> is looking for an opponent.\n\n`;
  const namesLine = (challengerName && opponentName) ? `**${challengerName}** vs **${opponentName}**\n\n` : (challengerName ? `**${challengerName}** is the challenger.\n\n` : '');
  return new EmbedBuilder()
    .setColor(INFO_EMBED_COLOR)
    .setTitle('Match started!')
    .setDescription(vsLine + namesLine + desc)
    .setFooter({ text: 'Challenger: pick format from dropdown • Anyone: click Accept Match to play' });
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
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`findmatch_cancel:${pendingId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2];
}

function buildCancelledEmbed() {
  return new EmbedBuilder()
    .setColor(0x9e9e9e)
    .setTitle('Find-match cancelled')
    .setDescription('This matchmaking request was cancelled (e.g. challenger found a match elsewhere).');
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
 * Handle /findmatch slash: post open-ended "Match started! Challenger is looking for an opponent." BO3/BO5 dropdown + Accept Match button. Anyone can click to play.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{ roleName?: string }} [options] - If roleName is set, the first message pings that role (e.g. for /acolyte, /evoker).
 */
export async function handleFindMatch(interaction, options = {}) {
  try {
    await interaction.deferReply();

    const challengerId = interaction.user.id;
    const guildId = interaction.guildId;

    const existing = await getActiveSessionForPlayer(challengerId, guildId);
    if (existing) {
      await interaction.editReply('❌ You are already in an active match. Finish it or wait for it to expire before starting another.');
      return;
    }

    let content = null;
    if (options.roleName && interaction.guild) {
      const role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === options.roleName.toLowerCase());
      if (role) {
        content = `<@&${role.id}>`;
      }
    }

    const pending = {
      challengerId,
      opponentId: null,
      guildId,
      channelId: interaction.channelId,
      format: null,
    };
    const pendingId = `findmatch-${guildId}-${Date.now()}`;
    pending.id = pendingId;
    pendingFindMatches.set(pendingId, pending);

    const challengerName = interaction.user.username;
    const embed = buildFindMatchEmbed(pending, challengerName, null, null);
    const components = buildFindMatchComponents(pendingId, null);

    const message = await interaction.editReply({
      content: content ?? undefined,
      embeds: [embed],
      components,
    });
    pending.messageId = message.id;
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

  if (pending.opponentId != null) {
    pendingFindMatches.delete(pendingId);
    await startMatch(pending, interaction, format);
    return true;
  }

  let challengerName = interaction.user.username;
  const embed = buildFindMatchEmbed(pending, challengerName, null, format);
  const components = buildFindMatchComponents(pendingId, format);
  await interaction.update({ embeds: [embed], components });
  return true;
}

/**
 * Handle Accept Match button: anyone (except the challenger) can click to become the opponent; first clicker wins. Then if format chosen, start match.
 */
export async function handleFindMatchAccept(interaction) {
  const pendingId = interaction.customId.replace('findmatch_accept:', '');
  const pending = pendingFindMatches.get(pendingId);
  if (!pending) {
    await interaction.reply({ content: '❌ This match request expired or was cancelled.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (interaction.user.id === pending.challengerId) {
    await interaction.reply({ content: "❌ You're the challenger; someone else must click Accept Match to play you.", ephemeral: true }).catch(() => {});
    return true;
  }
  if (interaction.user.bot) {
    await interaction.reply({ content: '❌ Bots cannot accept matches.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (pending.opponentId != null) {
    await interaction.reply({ content: '❌ Someone already accepted this match.', ephemeral: true }).catch(() => {});
    return true;
  }

  const accepterId = interaction.user.id;
  const existing = await getActiveSessionForPlayer(accepterId, pending.guildId);
  if (existing) {
    await interaction.reply({ content: '❌ You are already in an active match. Finish it or wait for it to expire.', ephemeral: true }).catch(() => {});
    return true;
  }

  pending.opponentId = accepterId;

  if (pending.format) {
    pendingFindMatches.delete(pendingId);
    await startMatch(pending, interaction, pending.format);
    return true;
  }

  let challengerName = null;
  const opponentName = interaction.user.username;
  try {
    const challenger = await interaction.client.users.fetch(pending.challengerId).catch(() => null);
    if (challenger) challengerName = challenger.username;
  } catch (_) {}

  const embed = buildFindMatchEmbed(pending, challengerName, opponentName, null);
  const components = buildFindMatchComponents(pendingId, null);
  await interaction.update({ embeds: [embed], components });
  return true;
}

/**
 * Edit the find-match message to "Cancelled" and remove from pending map. Used by both slash and button.
 */
async function doCancelPendingFindMatch(pending, client) {
  pendingFindMatches.delete(pending.id);
  if (!pending.messageId || !pending.channelId) return;
  try {
    const channel = await client.channels.fetch(pending.channelId).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(pending.messageId).catch(() => null);
    if (!message) return;
    await message.edit({
      content: null,
      embeds: [buildCancelledEmbed()],
      components: [],
    });
  } catch (err) {
    console.warn('[findMatchHandler] doCancelPendingFindMatch:', err?.message);
  }
}

/**
 * Handle /cancel-findmatch slash: cancel the user's pending find-match in this server (e.g. found a match elsewhere).
 */
export async function handleCancelFindMatch(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const pending = [...pendingFindMatches.values()].find(
    p => p.challengerId === userId && p.guildId === guildId
  );
  if (!pending) {
    await interaction.reply({
      content: "You don't have a pending find-match in this server. Use /findmatch or a tier command (e.g. /acolyte) to start one.",
      ephemeral: true,
    });
    return;
  }
  await doCancelPendingFindMatch(pending, interaction.client);
  await interaction.reply({
    content: 'Your find-match request has been cancelled.',
    ephemeral: true,
  });
}

/**
 * Handle Cancel button on find-match message: only the challenger can cancel.
 */
export async function handleFindMatchCancel(interaction) {
  const pendingId = interaction.customId.replace('findmatch_cancel:', '');
  const pending = pendingFindMatches.get(pendingId);
  if (!pending) {
    await interaction.reply({ content: '❌ This match request already expired or was cancelled.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (interaction.user.id !== pending.challengerId) {
    await interaction.reply({ content: '❌ Only the challenger can cancel this find-match request.', ephemeral: true }).catch(() => {});
    return true;
  }
  pendingFindMatches.delete(pendingId);
  await interaction.update({
    embeds: [buildCancelledEmbed()],
    components: [],
  });
  return true;
}
