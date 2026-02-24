/**
 * Handle reporting Game 1 (and later game) results: dropdown to pick winner or /result, plus loser confirmation.
 * Prevents discrepancies by requiring the loser to confirm the winner.
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { getSession, getActiveSessionForPlayer, updateSession } from './banSessionStore.js';
import { buildStageSelectRow } from './coinflipHandler.js';
import { STAGES } from './stageData.js';

const INFO_EMBED_COLOR = 0x1e88e5;

/**
 * Build a dropdown row to report who won Game 1 (pick one of the two players).
 * @param {string} matchId
 * @param {string} player1Id
 * @param {string} player2Id
 * @param {string} player1Name - display name for option label
 * @param {string} player2Name - display name for option label
 * @returns {ActionRowBuilder}
 */
export function buildResultReportRow(matchId, player1Id, player2Id, player1Name, player2Name) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`result_report:${matchId}`)
    .setPlaceholder('Who won Game 1?')
    .addOptions(
      { label: player1Name, value: player1Id },
      { label: player2Name, value: player2Id }
    );
  return new ActionRowBuilder().addComponents(menu);
}

/**
 * Transition from game1_report_result to game2: set game1WinnerId, refresh stages, start game2_ban_3.
 * @param {string} matchId
 * @param {object} session
 * @param {string} game1WinnerId
 * @returns {Promise<object>} Updated session
 */
async function startGame2(matchId, session, game1WinnerId) {
  const game1LoserId = session.player1Id === game1WinnerId ? session.player2Id : session.player1Id;
  const game1BannedStages = [...(session.bannedStages || [])];
  const updates = {
    game1WinnerId,
    game1BannedStages,
    bannedStages: [], // refresh: Game 2 pool is full (starters + counterpicks)
    currentTurn: game1WinnerId,
    turnPhase: 'game2_ban_3',
    pendingGame1WinnerId: null,
  };
  return updateSession(matchId, updates);
}

/**
 * Handle /result winner:@user — report who won Game 1. Only valid in game1_report_result.
 * Sets pendingGame1WinnerId and shows Confirm/Dispute buttons for the loser.
 */
export async function handleResult(interaction) {
  try {
    await interaction.deferReply();

    const winner = interaction.options.getUser('winner');
    const matchId = interaction.options.getString('match_id');

    let session = null;
    if (matchId) {
      session = await getSession(matchId);
    } else {
      session = await getActiveSessionForPlayer(interaction.user.id, interaction.guildId);
    }

    if (!session) {
      await interaction.editReply(
        matchId
          ? '❌ Match not found or expired. Start a new match with `/coinflip`.'
          : '❌ You are not in an active match. Use `/coinflip` to start one, or provide the match ID.'
      );
      return;
    }

    if (session.turnPhase !== 'game1_report_result') {
      await interaction.editReply(
        "❌ You can only report a result when the match is waiting for the Game 1 result. Finish the current step first."
      );
      return;
    }

    const player1Id = session.player1Id;
    const player2Id = session.player2Id;
    if (winner.id !== player1Id && winner.id !== player2Id) {
      await interaction.editReply('❌ The winner must be one of the two players in this match.');
      return;
    }

    const game1LoserId = winner.id === player1Id ? player2Id : player1Id;

    await updateSession(session.matchId, { pendingGame1WinnerId: winner.id });

    const embed = new EmbedBuilder()
      .setColor(INFO_EMBED_COLOR)
      .setTitle('Game 1 result reported')
      .setDescription(
        `**${interaction.user.username}** reported that **${winner.username}** won Game 1 on **${session.selectedStage}**.\n\n` +
        `To avoid disputes, the **loser** (${winner.id === player1Id ? '<@' + player2Id + '>' : '<@' + player1Id + '>'}) must confirm below.`
      )
      .setFooter({ text: `Match: ${session.matchId}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`result_confirm:${session.matchId}`)
        .setLabel('Confirm (I lost)')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`result_dispute:${session.matchId}`)
        .setLabel('Dispute')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error('[resultHandler] handleResult error:', err);
    try {
      await interaction.editReply('❌ Something went wrong.');
    } catch (_) {}
  }
}

/**
 * Handle "Who won Game 1?" dropdown selection. Sets pendingGame1WinnerId and shows Confirm/Dispute buttons.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @returns {Promise<boolean>} true if handled
 */
export async function handleResultReportComponent(interaction) {
  const matchId = interaction.customId.replace('result_report:', '');
  const session = await getSession(matchId);
  if (!session) {
    await interaction.reply({ content: '❌ This match expired.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (session.turnPhase !== 'game1_report_result') {
    await interaction.reply({ content: '❌ This match is not waiting for a result.', ephemeral: true }).catch(() => {});
    return true;
  }

  const winnerId = interaction.values && interaction.values[0];
  if (winnerId !== session.player1Id && winnerId !== session.player2Id) {
    await interaction.reply({ content: '❌ Invalid selection.', ephemeral: true }).catch(() => {});
    return true;
  }

  await updateSession(matchId, { pendingGame1WinnerId: winnerId });

  const winner = await interaction.client.users.fetch(winnerId).catch(() => null);
  const winnerName = winner ? winner.username : 'Winner';
  const game1LoserId = winnerId === session.player1Id ? session.player2Id : session.player1Id;
  const loserMention = `<@${game1LoserId}>`;

  const embed = new EmbedBuilder()
    .setColor(INFO_EMBED_COLOR)
    .setTitle('Game 1 result reported')
    .setDescription(
      `**${interaction.user.username}** reported that **${winnerName}** won Game 1 on **${session.selectedStage}**.\n\n` +
      `To avoid disputes, the **loser** (${loserMention}) must confirm below.`
    )
    .setFooter({ text: `Match: ${matchId}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`result_confirm:${matchId}`)
      .setLabel('Confirm (I lost)')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`result_dispute:${matchId}`)
      .setLabel('Dispute')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.update({ embeds: [embed], components: [row] });
  return true;
}

/**
 * Handle loser clicking Confirm: set game1WinnerId, refresh stages, advance to game2_ban_3 and show dropdown.
 */
export async function handleResultConfirm(interaction) {
  const matchId = interaction.customId.replace('result_confirm:', '');
  const session = await getSession(matchId);
  if (!session) {
    await interaction.reply({ content: '❌ This match expired.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (session.turnPhase !== 'game1_report_result' || !session.pendingGame1WinnerId) {
    await interaction.reply({ content: '❌ No result is pending to confirm.', ephemeral: true }).catch(() => {});
    return true;
  }
  const game1LoserId = session.pendingGame1WinnerId === session.player1Id ? session.player2Id : session.player1Id;
  if (interaction.user.id !== game1LoserId) {
    await interaction.reply({ content: '❌ Only the loser of Game 1 can confirm the result.', ephemeral: true }).catch(() => {});
    return true;
  }

  await interaction.deferUpdate();

  const game1WinnerId = session.pendingGame1WinnerId;
  const updatedSession = await startGame2(matchId, session, game1WinnerId);

  const winnerMention = game1WinnerId === session.player1Id ? `<@${session.player1Id}>` : `<@${session.player2Id}>`;
  const loserMention = game1LoserId === session.player1Id ? `<@${session.player1Id}>` : `<@${session.player2Id}>`;

  const fullPool = [...STAGES.starters, ...STAGES.counterpicks];
  const embed = new EmbedBuilder()
    .setColor(INFO_EMBED_COLOR)
    .setTitle('Game 2 — Stage bans (stages refreshed)')
    .setDescription(
      `**${session.selectedStage}** was used for Game 1. Stages **refresh** for Game 2: full pool is available.\n\n` +
      `**Game 1 winner** ${winnerMention} bans **3 stages**. Then **Game 1 loser** ${loserMention} picks the stage for Game 2.`
    )
    .addFields({
      name: 'Remaining stages (Game 2 pool)',
      value: fullPool.map(s => `• ${s.name}`).join('\n'),
    })
    .addFields({
      name: 'Next step',
      value: `${winnerMention}, ban **3** stage(s) from the dropdown below.\n*Only the Game 1 winner can use the dropdown.*`,
    })
    .setFooter({ text: `Match: ${matchId} • Dropdown is only for the player whose turn it is` });

  const row = buildStageSelectRow(matchId, updatedSession, 'Game 1 winner: ban 3 stages');
  await interaction.editReply({
    embeds: [embed],
    components: row ? [row] : [],
  });

  try {
    const winnerMember = await interaction.guild.members.fetch(game1WinnerId).catch(() => null);
    if (winnerMember) {
      await winnerMember.send(
        `You won Game 1! For Game 2 you ban 3 stages. Use the **dropdown** in the server or \`/ban stage:<stage> match_id:${matchId}\`.`
      );
    }
  } catch (err) {
    console.warn('[resultHandler] Could not DM Game 1 winner:', err.message);
  }
  return true;
}

/**
 * Handle loser clicking Dispute: clear pending and show message.
 */
export async function handleResultDispute(interaction) {
  const matchId = interaction.customId.replace('result_dispute:', '');
  const session = await getSession(matchId);
  if (!session) {
    await interaction.reply({ content: '❌ This match expired.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (session.turnPhase !== 'game1_report_result' || !session.pendingGame1WinnerId) {
    await interaction.reply({ content: '❌ No result is pending to dispute.', ephemeral: true }).catch(() => {});
    return true;
  }
  const game1LoserId = session.pendingGame1WinnerId === session.player1Id ? session.player2Id : session.player1Id;
  if (interaction.user.id !== game1LoserId) {
    await interaction.reply({ content: '❌ Only the loser can dispute the result.', ephemeral: true }).catch(() => {});
    return true;
  }

  await updateSession(matchId, { pendingGame1WinnerId: null });

  await interaction.reply({
    content: 'Result disputed. Agree on the correct winner and report again with `/result winner:@user`, or use `/cancel-match` to start over.',
    ephemeral: true,
  }).catch(() => {});

  await interaction.message.edit({ components: [] }).catch(() => {});
  return true;
}
