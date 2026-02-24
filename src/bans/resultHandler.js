/**
 * Handle reporting Game 1 (and later game) results: dropdown to pick winner or /result, plus loser confirmation.
 * Prevents discrepancies by requiring the loser to confirm the winner.
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { getSession, getActiveSessionForPlayer, updateSession, deleteSession, SESSION_TTL_MS } from './banSessionStore.js';
import { buildStageSelectRow } from './coinflipHandler.js';
import { STAGES } from './stageData.js';

const INFO_EMBED_COLOR = 0x1e88e5;

/**
 * Build a dropdown row to report who won a game (pick one of the two players).
 * @param {string} matchId
 * @param {string} player1Id
 * @param {string} player2Id
 * @param {string} player1Name - display name for option label
 * @param {string} player2Name - display name for option label
 * @param {number} [gameNumber=1]
 * @returns {ActionRowBuilder}
 */
export function buildResultReportRow(matchId, player1Id, player2Id, player1Name, player2Name, gameNumber = 1) {
  const placeholder = gameNumber === 1 ? 'Who won Game 1?' : `Who won Game ${gameNumber}?`;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`result_report:${matchId}:${gameNumber}`)
    .setPlaceholder(placeholder)
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
  const game1BannedStages = [...(session.bannedStages || [])];
  const updates = {
    game1WinnerId,
    game1BannedStages,
    bannedStages: [], // refresh: Game 2 pool is full (starters + counterpicks)
    currentTurn: game1WinnerId,
    turnPhase: 'game2_ban_3',
    pendingGame1WinnerId: null,
    gameNumber: 2,
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

    const canReportGame1 = session.turnPhase === 'game1_report_result';
    const canReportGame2 = session.turnPhase === 'game2_complete';
    if (!canReportGame1 && !canReportGame2) {
      await interaction.editReply(
        "❌ You can only report a result when the match is waiting for a game result (Game 1 or Game 2+). Finish the current step first."
      );
      return;
    }

    const player1Id = session.player1Id;
    const player2Id = session.player2Id;
    if (winner.id !== player1Id && winner.id !== player2Id) {
      await interaction.editReply('❌ The winner must be one of the two players in this match.');
      return;
    }

    const gameNumber = canReportGame1 ? 1 : (session.gameNumber || 2);
    const loserMention = winner.id === player1Id ? '<@' + player2Id + '>' : '<@' + player1Id + '>';
    const stageUsed = canReportGame1 ? session.selectedStage : session.selectedStageGame2;

    if (canReportGame1) {
      await updateSession(session.matchId, { pendingGame1WinnerId: winner.id });
    } else {
      await updateSession(session.matchId, { pendingGame2WinnerId: winner.id });
    }

    const embed = new EmbedBuilder()
      .setColor(INFO_EMBED_COLOR)
      .setTitle(`Game ${gameNumber} result reported`)
      .setDescription(
        `**${interaction.user.username}** reported that **${winner.username}** won Game ${gameNumber} on **${stageUsed}**.\n\n` +
        `To avoid disputes, the **loser** (${loserMention}) must confirm below.`
      )
      .setFooter({ text: `Match: ${session.matchId}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`result_confirm:${session.matchId}:${gameNumber}`)
        .setLabel('Confirm (I lost)')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`result_dispute:${session.matchId}:${gameNumber}`)
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
 * Parse result_report:matchId or result_report:matchId:gameNumber
 */
function parseResultReportCustomId(customId) {
  const rest = customId.replace('result_report:', '');
  const colonIdx = rest.lastIndexOf(':');
  if (colonIdx === -1) return { matchId: rest, gameNumber: 1 };
  const matchId = rest.slice(0, colonIdx);
  const gameNumber = parseInt(rest.slice(colonIdx + 1), 10) || 1;
  return { matchId, gameNumber };
}

/**
 * Handle "Who won Game N?" dropdown selection. Sets pending winner and shows Confirm/Dispute buttons.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @returns {Promise<boolean>} true if handled
 */
export async function handleResultReportComponent(interaction) {
  const { matchId, gameNumber } = parseResultReportCustomId(interaction.customId);
  const session = await getSession(matchId);
  if (!session) {
    await interaction.reply({ content: '❌ This match expired.', ephemeral: true }).catch(() => {});
    return true;
  }
  const isGame1 = gameNumber === 1;
  const expectedPhase = isGame1 ? 'game1_report_result' : 'game2_complete';
  if (session.turnPhase !== expectedPhase) {
    await interaction.reply({ content: '❌ This match is not waiting for that result.', ephemeral: true }).catch(() => {});
    return true;
  }

  const winnerId = interaction.values && interaction.values[0];
  if (winnerId !== session.player1Id && winnerId !== session.player2Id) {
    await interaction.reply({ content: '❌ Invalid selection.', ephemeral: true }).catch(() => {});
    return true;
  }

  if (isGame1) {
    await updateSession(matchId, { pendingGame1WinnerId: winnerId });
  } else {
    await updateSession(matchId, { pendingGame2WinnerId: winnerId });
  }

  const winner = await interaction.client.users.fetch(winnerId).catch(() => null);
  const winnerName = winner ? winner.username : 'Winner';
  const loserId = winnerId === session.player1Id ? session.player2Id : session.player1Id;
  const loserMention = `<@${loserId}>`;
  const stageUsed = isGame1 ? session.selectedStage : session.selectedStageGame2;

  const embed = new EmbedBuilder()
    .setColor(INFO_EMBED_COLOR)
    .setTitle(`Game ${gameNumber} result reported`)
    .setDescription(
      `**${interaction.user.username}** reported that **${winnerName}** won Game ${gameNumber} on **${stageUsed}**.\n\n` +
      `To avoid disputes, the **loser** (${loserMention}) must confirm below.`
    )
    .setFooter({ text: `Match: ${matchId}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`result_confirm:${matchId}:${gameNumber}`)
      .setLabel('Confirm (I lost)')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`result_dispute:${matchId}:${gameNumber}`)
      .setLabel('Dispute')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.update({ embeds: [embed], components: [row] });
  return true;
}

/** Parse result_confirm:matchId or result_confirm:matchId:gameNumber */
function parseResultConfirmCustomId(customId) {
  const rest = customId.replace('result_confirm:', '');
  const idx = rest.lastIndexOf(':');
  if (idx === -1) return { matchId: rest, gameNumber: 1 };
  return { matchId: rest.slice(0, idx), gameNumber: parseInt(rest.slice(idx + 1), 10) || 1 };
}

/** Format wins needed for set (bo3=2, bo5=3, ft5=5). */
function getWinsForSet(format) {
  if (format === 'bo3') return 2;
  if (format === 'bo5') return 3;
  if (format === 'ft5') return 5;
  return null;
}

/**
 * Handle loser clicking Confirm: Game 1 → start Game 2; Game 2+ → set lastGameWinnerId and show Another match / End or Set over.
 */
export async function handleResultConfirm(interaction) {
  const { matchId, gameNumber } = parseResultConfirmCustomId(interaction.customId);
  const session = await getSession(matchId);
  if (!session) {
    await interaction.reply({ content: '❌ This match expired.', ephemeral: true }).catch(() => {});
    return true;
  }
  const isGame1 = gameNumber === 1;
  if (isGame1) {
    if (session.turnPhase !== 'game1_report_result' || !session.pendingGame1WinnerId) {
      await interaction.reply({ content: '❌ No result is pending to confirm.', ephemeral: true }).catch(() => {});
      return true;
    }
  } else {
    if (session.turnPhase !== 'game2_complete' || !session.pendingGame2WinnerId) {
      await interaction.reply({ content: '❌ No result is pending to confirm.', ephemeral: true }).catch(() => {});
      return true;
    }
  }
  const pendingWinnerId = isGame1 ? session.pendingGame1WinnerId : session.pendingGame2WinnerId;
  const loserId = pendingWinnerId === session.player1Id ? session.player2Id : session.player1Id;
  if (interaction.user.id !== loserId) {
    await interaction.reply({ content: `❌ Only the loser of Game ${gameNumber} can confirm the result.`, ephemeral: true }).catch(() => {});
    return true;
  }

  await interaction.deferUpdate();

  if (isGame1) {
    const game1WinnerId = session.pendingGame1WinnerId;
    const updatedSession = await startGame2(matchId, session, game1WinnerId);
    const gameWins = session.format
      ? { [session.player1Id]: game1WinnerId === session.player1Id ? 1 : 0, [session.player2Id]: game1WinnerId === session.player2Id ? 1 : 0 }
      : null;
    if (session.format) await updateSession(matchId, { gameWins, lastGameWinnerId: game1WinnerId });

    const winnerMention = game1WinnerId === session.player1Id ? `<@${session.player1Id}>` : `<@${session.player2Id}>`;
    const loserMention = loserId === session.player1Id ? `<@${session.player1Id}>` : `<@${session.player2Id}>`;

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

  // Game 2+ result confirmed
  const winnerId = session.pendingGame2WinnerId;
  const gameWins = session.gameWins || { [session.player1Id]: 0, [session.player2Id]: 0 };
  gameWins[winnerId] = (gameWins[winnerId] || 0) + 1;

  const winsForSet = getWinsForSet(session.format);
  const setOver = winsForSet != null && gameWins[winnerId] >= winsForSet;

  const updates = {
    game2WinnerId: winnerId,
    lastGameWinnerId: winnerId,
    pendingGame2WinnerId: null,
    gameWins,
    turnPhase: setOver ? 'set_over' : 'another_match',
  };
  await updateSession(matchId, updates);

  const winnerMention = winnerId === session.player1Id ? `<@${session.player1Id}>` : `<@${session.player2Id}>`;
  const scoreText = `${gameWins[session.player1Id] || 0}-${gameWins[session.player2Id] || 0}`;
  const formatLabel = session.format ? ` (${session.format.toUpperCase()})` : '';

  if (setOver) {
    const embed = new EmbedBuilder()
      .setColor(INFO_EMBED_COLOR)
      .setTitle(`Set over${formatLabel}`)
      .setDescription(
        `**${winnerMention}** wins the set **${scoreText}**!\n\nUse **/end** to end the session.`
      )
      .setFooter({ text: `Match: ${matchId}` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`end_session:${matchId}`)
        .setLabel('End session')
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.editReply({ embeds: [embed], components: [row] });
    return true;
  }

  const embed = new EmbedBuilder()
    .setColor(INFO_EMBED_COLOR)
    .setTitle(`Game ${gameNumber} complete — Score ${scoreText}${formatLabel}`)
    .setDescription(
      `**${winnerMention}** won Game ${gameNumber} on **${session.selectedStageGame2}**.\n\nPlay another game?`
    )
    .setFooter({ text: `Match: ${matchId}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`another_match:${matchId}`)
      .setLabel('Another match')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`end_session:${matchId}`)
      .setLabel('End session')
      .setStyle(ButtonStyle.Secondary)
  );
  await interaction.editReply({ embeds: [embed], components: [row] });
  return true;
}

/** Parse result_dispute:matchId or result_dispute:matchId:gameNumber */
function parseResultDisputeCustomId(customId) {
  const rest = customId.replace('result_dispute:', '');
  const idx = rest.lastIndexOf(':');
  if (idx === -1) return { matchId: rest, gameNumber: 1 };
  return { matchId: rest.slice(0, idx), gameNumber: parseInt(rest.slice(idx + 1), 10) || 1 };
}

/**
 * Handle loser clicking Dispute: clear pending and show message.
 */
export async function handleResultDispute(interaction) {
  const { matchId, gameNumber } = parseResultDisputeCustomId(interaction.customId);
  const session = await getSession(matchId);
  if (!session) {
    await interaction.reply({ content: '❌ This match expired.', ephemeral: true }).catch(() => {});
    return true;
  }
  const isGame1 = gameNumber === 1;
  const pendingKey = isGame1 ? 'pendingGame1WinnerId' : 'pendingGame2WinnerId';
  const pending = isGame1 ? session.pendingGame1WinnerId : session.pendingGame2WinnerId;
  const expectedPhase = isGame1 ? 'game1_report_result' : 'game2_complete';
  if (session.turnPhase !== expectedPhase || !pending) {
    await interaction.reply({ content: '❌ No result is pending to dispute.', ephemeral: true }).catch(() => {});
    return true;
  }
  const loserId = pending === session.player1Id ? session.player2Id : session.player1Id;
  if (interaction.user.id !== loserId) {
    await interaction.reply({ content: '❌ Only the loser can dispute the result.', ephemeral: true }).catch(() => {});
    return true;
  }

  await updateSession(matchId, { [pendingKey]: null });

  await interaction.reply({
    content: `Result disputed. Agree on the correct winner and report again (dropdown or \`/result winner:@user\` for Game 1), or use \`/cancel-match\` to start over.`,
    ephemeral: true,
  }).catch(() => {});

  await interaction.message.edit({ components: [] }).catch(() => {});
  return true;
}

/**
 * Handle "Another match" button: start next game (counterpick flow), refresh stages, refresh 24h expiry.
 */
export async function handleAnotherMatch(interaction) {
  const matchId = interaction.customId.replace('another_match:', '');
  const session = await getSession(matchId);
  if (!session) {
    await interaction.reply({ content: '❌ This match expired.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (session.turnPhase !== 'another_match') {
    await interaction.reply({ content: '❌ Not in a state to start another match.', ephemeral: true }).catch(() => {});
    return true;
  }
  const nextGameNumber = (session.gameNumber || 2) + 1;
  const banPlayerId = session.lastGameWinnerId || session.game1WinnerId;
  const pickPlayerId = banPlayerId === session.player1Id ? session.player2Id : session.player1Id;

  const updates = {
    bannedStages: [],
    selectedStageGame2: null,
    turnPhase: 'game2_ban_3',
    currentTurn: banPlayerId,
    gameNumber: nextGameNumber,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  const updatedSession = await updateSession(matchId, updates);

  await interaction.deferUpdate();

  const fullPool = [...STAGES.starters, ...STAGES.counterpicks];
  const banMention = `<@${banPlayerId}>`;
  const pickMention = `<@${pickPlayerId}>`;
  const embed = new EmbedBuilder()
    .setColor(INFO_EMBED_COLOR)
    .setTitle(`Game ${nextGameNumber} — Stage bans (stages refreshed)`)
    .setDescription(
      `Stages **refresh** for Game ${nextGameNumber}: full pool is available.\n\n` +
      `**Previous game winner** ${banMention} bans **3 stages**. Then **opponent** ${pickMention} picks the stage.`
    )
    .addFields({
      name: 'Remaining stages (Game ' + nextGameNumber + ' pool)',
      value: fullPool.map(s => `• ${s.name}`).join('\n'),
    })
    .addFields({
      name: 'Next step',
      value: `${banMention}, ban **3** stage(s) from the dropdown below.\n*Only the player mentioned can use the dropdown.*`,
    })
    .setFooter({ text: `Match: ${matchId} • Dropdown is only for the player whose turn it is` });

  const row = buildStageSelectRow(matchId, updatedSession, `Game ${nextGameNumber}: ban 3 stages`);
  await interaction.editReply({ embeds: [embed], components: row ? [row] : [] });

  try {
    const banMember = await interaction.guild.members.fetch(banPlayerId).catch(() => null);
    if (banMember) {
      await banMember.send(
        `Your turn to ban 3 stages for Game ${nextGameNumber}. Use the **dropdown** in the server or \`/ban stage:<stage> match_id:${matchId}\`.`
      );
    }
  } catch (err) {
    console.warn('[resultHandler] Could not DM ban player:', err.message);
  }
  return true;
}

/**
 * Handle "End session" button: delete session and update message.
 */
export async function handleEndSession(interaction) {
  const matchId = interaction.customId.replace('end_session:', '');
  const session = await getSession(matchId);
  if (!session) {
    await interaction.reply({ content: '❌ This match already ended or expired.', ephemeral: true }).catch(() => {});
    return true;
  }
  const isParticipant = interaction.user.id === session.player1Id || interaction.user.id === session.player2Id;
  if (!isParticipant) {
    await interaction.reply({ content: '❌ Only match participants can end the session.', ephemeral: true }).catch(() => {});
    return true;
  }

  await deleteSession(matchId);

  await interaction.deferUpdate().catch(() => {});
  const embed = new EmbedBuilder()
    .setColor(INFO_EMBED_COLOR)
    .setTitle('Session ended')
    .setDescription('The stage ban session has ended. Use `/coinflip @opponent` to start a new match.')
    .setFooter({ text: `Match: ${matchId}` });
  await interaction.message.edit({ embeds: [embed], components: [] }).catch(() => {});
  return true;
}
