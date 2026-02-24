import { EmbedBuilder } from 'discord.js';
import { getSession, getSessionByCurrentTurn, updateSession } from './banSessionStore.js';
import { STAGES, findStageByInput } from './stageData.js';
import { buildStageSelectRow } from './coinflipHandler.js';
import { buildResultReportRow } from './resultHandler.js';

const INFO_EMBED_COLOR = 0x1e88e5;

/**
 * Get number of bans for the given phase (for display).
 */
function getBansForPhase(phase) {
  if (phase === 'game1_ban_1') return 1;
  if (phase.includes('game1_ban_2')) return 2;
  if (phase === 'game2_ban_3') return 3;
  return 1;
}

/** True when phase is still Game 1 (starters only; no counterpicks in pool). */
function isGame1Phase(phase) {
  return phase && (phase === 'game1_ban_1' || phase.includes('game1_ban_2') || phase === 'game1_select');
}

/**
 * Remaining stages to show in the embed. Game 1 = starters only; Game 2+ = starters + counterpicks.
 * @param {string} phase - turnPhase or nextPhase
 * @param {string[]} bannedList
 * @returns {{ name: string, aliases: string[] }[]}
 */
function getRemainingStagesForDisplay(phase, bannedList) {
  const list = isGame1Phase(phase)
    ? STAGES.starters.filter(s => !bannedList.includes(s.name))
    : [...STAGES.starters, ...STAGES.counterpicks].filter(s => !bannedList.includes(s.name));
  return list;
}

/**
 * Field name for remaining stages (contextual for Game 1).
 */
function getRemainingStagesFieldName(nextPhase, bansLeft) {
  if (nextPhase === 'game1_report_result' || nextPhase === 'game2_complete') return null;
  if (nextPhase === 'game2_ban_3') return 'Remaining stages (Game 2 pool)';
  if (nextPhase === 'game2_select') return 'Remaining stages (Game 2 — loser picks 1)';
  if (nextPhase.includes('select') && nextPhase.includes('game1')) return 'Remaining stages (winner picks 1 for Game 1)';
  if (isGame1Phase(nextPhase) && bansLeft === 2) return 'Remaining stages (opponent bans 2)';
  if (isGame1Phase(nextPhase) && bansLeft === 1) return 'Remaining stages (winner bans 1)';
  return 'Remaining stages';
}

/**
 * Advance turn and phase after a ban/selection.
 * Game 1: winner bans 1, loser bans 2, winner selects → then game1_report_result (use /result to report winner).
 * Game 2: after result confirmed, winner bans 3, loser selects 1 (stages refresh).
 * @param {object} session - Current session
 * @returns {{ nextPlayer: string, nextPhase: string }}
 */
function advanceTurn(session) {
  const { player1Id, player2Id, coinFlipWinnerId, turnPhase, game1WinnerId } = session;
  const winner = coinFlipWinnerId;
  const loser = winner === player1Id ? player2Id : player1Id;

  const starterBanCount = (session.bannedStages || []).filter(s =>
    STAGES.starters.some(st => st.name === s)
  ).length;

  switch (turnPhase) {
    case 'game1_ban_1':
      return { nextPlayer: loser, nextPhase: 'game1_ban_2_of_2' };
    case 'game1_ban_2_of_2':
      if (starterBanCount < 3) {
        return { nextPlayer: loser, nextPhase: 'game1_ban_2_of_2_part2' };
      }
      return { nextPlayer: winner, nextPhase: 'game1_select' };
    case 'game1_ban_2_of_2_part2':
      return { nextPlayer: winner, nextPhase: 'game1_select' };
    case 'game1_select':
      return { nextPlayer: winner, nextPhase: 'game1_report_result' };
    case 'game2_ban_3': {
      const game2BanCount = (session.bannedStages || []).length;
      const banPlayerId = session.currentTurn;
      const pickerId = banPlayerId === player1Id ? player2Id : player1Id;
      if (game2BanCount >= 3) {
        return { nextPlayer: pickerId, nextPhase: 'game2_select' };
      }
      return { nextPlayer: banPlayerId, nextPhase: 'game2_ban_3' };
    }
    case 'game2_select':
      return { nextPlayer: null, nextPhase: 'game2_complete' };
    default:
      return { nextPlayer: session.currentTurn, nextPhase: turnPhase };
  }
}

/**
 * Handle /ban slash command: ban or select a stage for the current match.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleBan(interaction) {
  try {
    await interaction.deferReply();

    const stageInput = interaction.options.getString('stage');
    const stage = findStageByInput(stageInput);

    if (!stage) {
      const names = [...STAGES.starters, ...STAGES.counterpicks].map(s => s.name).join(', ');
      await interaction.editReply(`❌ Stage not found. Valid stages: ${names}`);
      return;
    }

    let matchId = interaction.options.getString('match_id');
    let session = null;
    if (matchId) {
      session = await getSession(matchId);
    } else {
      const resolved = await getSessionByCurrentTurn(interaction.user.id, interaction.guildId);
      if (resolved) {
        session = resolved;
        matchId = session.matchId;
      }
    }
    if (!session) {
      if (!matchId) {
        await interaction.editReply(
          '❌ No active match where it\'s your turn. Start one with `/coinflip` or provide the match ID.'
        );
      } else {
        await interaction.editReply('❌ Match session not found or expired. Start a new match with `/coinflip`.');
      }
      return;
    }

    if (session.currentTurn !== interaction.user.id) {
      await interaction.editReply("❌ It's not your turn.");
      return;
    }

    const isSelectionPhase = session.turnPhase === 'game1_select' || session.turnPhase === 'game2_select';
    const bannedStages = session.bannedStages || [];

    if (isSelectionPhase) {
      const pool = session.turnPhase === 'game2_select'
        ? [...STAGES.starters, ...STAGES.counterpicks]
        : STAGES.starters;
      const remaining = pool.filter(s => !bannedStages.includes(s.name));
      if (!remaining.some(s => s.name === stage.name)) {
        await interaction.editReply(
          `❌ **${stage.name}** is not one of the remaining stages. Choose from: ${remaining.map(s => s.name).join(', ')}`
        );
        return;
      }
    } else {
      if (bannedStages.includes(stage.name)) {
        await interaction.editReply(`❌ **${stage.name}** is already banned.`);
        return;
      }

      if (session.turnPhase && session.turnPhase.includes('game1')) {
        const allowed = STAGES.starters;
        if (!allowed.some(s => s.name === stage.name)) {
          await interaction.editReply(
            `❌ For Game 1 bans use starters only: ${allowed.map(s => s.name).join(', ')}`
          );
          return;
        }
      }
    }

    const updates = { bannedStages: [...bannedStages, stage.name] };
    if (session.turnPhase === 'game1_select') {
      updates.selectedStage = stage.name;
    }
    if (session.turnPhase === 'game2_select') {
      updates.selectedStageGame2 = stage.name;
    }

    const { nextPlayer, nextPhase } = advanceTurn({
      ...session,
      ...updates,
    });
    updates.currentTurn = nextPlayer;
    updates.turnPhase = nextPhase;

    const updatedSession = await updateSession(matchId, updates);
    const nextBannedList = updatedSession.bannedStages || [];

    const remainingForDisplay = getRemainingStagesForDisplay(nextPhase, nextBannedList);
    const remainingFieldName = getRemainingStagesFieldName(nextPhase, getBansForPhase(nextPhase));

    const banEmbed = new EmbedBuilder()
      .setColor(INFO_EMBED_COLOR)
      .setTitle(isSelectionPhase ? `Stage selected: ${stage.name}` : `Stage banned: ${stage.name}`)
      .setDescription(
        `**${interaction.user.username}** ${isSelectionPhase ? 'selected' : 'banned'} **${stage.name}**.\n\nBanned/used so far:\n${nextBannedList.map(s => `• ${s}`).join('\n') || '(none)'}`
      );
    if (remainingFieldName) {
      banEmbed.addFields({
        name: remainingFieldName,
        value: remainingForDisplay.map(s => `• ${s.name}`).join('\n') || 'None',
      });
    }

    const nextMention = nextPlayer ? (nextPlayer === session.player1Id ? `<@${session.player1Id}>` : `<@${session.player2Id}>`) : null;
    if (nextPhase === 'game1_report_result') {
      banEmbed.addFields({
        name: 'Next step',
        value: `Stage for Game 1: **${updatedSession.selectedStage}**. Play the game, then **pick who won** from the dropdown below. The loser must confirm.`,
      });
    } else if (nextPhase.includes('select') && nextPhase.includes('game1')) {
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention}, use \`/ban\` to **select** the stage for Game 1 from the remaining starters.`,
      });
    } else if (nextPhase === 'game2_select') {
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention} (Game 1 loser), **select the stage for Game 2** from the dropdown or \`/ban stage:<stage>\`.`,
      });
    } else if (nextPhase.includes('ban')) {
      const bansLeft = getBansForPhase(nextPhase);
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention}, ban **${bansLeft}** stage(s). Match ID: \`${matchId}\``,
      });
    } else if (nextPhase === 'game2_ban_3') {
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention} (Game 1 winner): open the **dropdown** and **select exactly 3 stages** to ban for Game 2 (pick all 3 at once). Match ID: \`${matchId}\``,
      });
    } else if (nextPhase === 'game2_complete') {
      banEmbed.addFields({
        name: 'Game 2 ready',
        value: `Stage for Game 2: **${updatedSession.selectedStageGame2}**. Play the game!`,
      });
    }

    let replyComponents = [];
    if (nextPhase === 'game1_report_result') {
      try {
        const m1 = await interaction.guild.members.fetch(session.player1Id).catch(() => null);
        const m2 = await interaction.guild.members.fetch(session.player2Id).catch(() => null);
        replyComponents = [buildResultReportRow(matchId, session.player1Id, session.player2Id, m1?.user?.username ?? 'Player 1', m2?.user?.username ?? 'Player 2')];
      } catch (_) {}
    }
    await interaction.editReply({ embeds: [banEmbed], components: replyComponents });

    if (nextPhase !== 'game1_report_result' && nextPlayer) {
      try {
        const nextMember = await interaction.guild.members.fetch(nextPlayer).catch(() => null);
        if (nextMember) {
          await nextMember.send(
            `Your turn in match \`${matchId}\`. Use \`/ban stage:<stage> match_id:${matchId}\` in the server.`
          );
        }
      } catch (err) {
        console.warn('[banHandler] Could not DM next player:', err.message);
      }
    }
  } catch (err) {
    console.error('[banHandler] error:', err);
    try {
      await interaction.editReply('❌ Something went wrong.');
    } catch (_) {}
  }
}

/**
 * Handle select menu (and optionally button) interaction for stage ban: parse matchId, validate turn, apply ban, update message.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleBanComponent(interaction) {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith('ban:')) return false;
  const matchId = customId.slice(4);

  const session = await getSession(matchId);
  if (!session) {
    await interaction.update({ content: '❌ This match expired.', embeds: [], components: [] }).catch(() => {});
    return true;
  }

  if (session.currentTurn !== interaction.user.id) {
    await interaction.reply({ content: "❌ It's not your turn.", ephemeral: true }).catch(() => {});
    return true;
  }

  await interaction.deferUpdate();

  const selectedValues = interaction.values || [];
  const stages = selectedValues.map(v => findStageByInput(v)).filter(Boolean);
  if (stages.length === 0 || stages.length !== selectedValues.length) {
    await interaction.followUp({ content: '❌ Invalid stage selection.', ephemeral: true }).catch(() => {});
    return true;
  }

  const isSelectionPhase = session.turnPhase === 'game1_select' || session.turnPhase === 'game2_select';
  const bannedStages = session.bannedStages || [];

  if (isSelectionPhase) {
    if (stages.length > 1) {
      await interaction.followUp({ content: '❌ Pick only one stage to select.', ephemeral: true }).catch(() => {});
      return true;
    }
    const stage = stages[0];
    const pool = session.turnPhase === 'game2_select'
      ? [...STAGES.starters, ...STAGES.counterpicks]
      : STAGES.starters;
    const remaining = pool.filter(s => !bannedStages.includes(s.name));
    if (!remaining.some(s => s.name === stage.name)) {
      await interaction.followUp({ content: `❌ **${stage.name}** is not one of the remaining stages.`, ephemeral: true }).catch(() => {});
      return true;
    }
  } else {
    for (const stage of stages) {
      if (bannedStages.includes(stage.name)) {
        await interaction.followUp({ content: `❌ **${stage.name}** is already banned.`, ephemeral: true }).catch(() => {});
        return true;
      }
      if (session.turnPhase && session.turnPhase.includes('game1') && !STAGES.starters.some(s => s.name === stage.name)) {
        await interaction.followUp({ content: `❌ For Game 1 use starters only (${stage.name} is a counterpick).`, ephemeral: true }).catch(() => {});
        return true;
      }
    }
  }

  const newBannedNames = stages.map(s => s.name);
  const updates = { bannedStages: [...bannedStages, ...newBannedNames] };
  if (session.turnPhase === 'game1_select') updates.selectedStage = stages[0].name;
  if (session.turnPhase === 'game2_select') updates.selectedStageGame2 = stages[0].name;

  const { nextPlayer, nextPhase } = advanceTurn({ ...session, ...updates });
  updates.currentTurn = nextPlayer;
  updates.turnPhase = nextPhase;

  const updatedSession = await updateSession(matchId, updates);
  const nextBannedList = updatedSession.bannedStages || [];

  const remainingForDisplay = getRemainingStagesForDisplay(nextPhase, nextBannedList);
  const remainingFieldName = getRemainingStagesFieldName(nextPhase, getBansForPhase(nextPhase));

  const titleStagePart = isSelectionPhase
    ? stages[0].name
    : newBannedNames.length > 1
      ? `${newBannedNames.join(' and ')}`
      : newBannedNames[0];
  const actionVerb = isSelectionPhase ? 'selected' : 'banned';
  const actionDetail = isSelectionPhase
    ? `**${stages[0].name}**`
    : newBannedNames.length > 1
      ? `**${newBannedNames.join('** and **')}**`
      : `**${newBannedNames[0]}**`;

  const banEmbed = new EmbedBuilder()
    .setColor(INFO_EMBED_COLOR)
    .setTitle(isSelectionPhase ? `Stage selected: ${titleStagePart}` : `Stage banned: ${titleStagePart}`)
    .setDescription(
      `**${interaction.user.username}** ${actionVerb} ${actionDetail}.\n\nBanned/used so far:\n${nextBannedList.map(s => `• ${s}`).join('\n') || '(none)'}`
    );
  if (remainingFieldName) {
    banEmbed.addFields({
      name: remainingFieldName,
      value: remainingForDisplay.map(s => `• ${s.name}`).join('\n') || 'None',
    });
  }

  const nextMention = nextPlayer ? (nextPlayer === session.player1Id ? `<@${session.player1Id}>` : `<@${session.player2Id}>`) : null;
  let nextPlaceholder = 'Pick a stage';
  try {
    const nextMember = nextPlayer ? await interaction.guild.members.fetch(nextPlayer).catch(() => null) : null;
    const nextName = nextMember?.user?.username ?? 'Next player';
    if (nextPhase === 'game1_report_result') {
      banEmbed.addFields({
        name: 'Next step',
        value: `Stage for Game 1: **${updatedSession.selectedStage}**. Play the game, then **pick who won** from the dropdown below. The loser must confirm.`,
      });
    } else if (nextPhase.includes('select') && nextPhase.includes('game1')) {
      nextPlaceholder = `${nextName}: select stage for Game 1`;
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention}, **select the stage for Game 1** from the dropdown below.\n*Only ${nextName} can use the dropdown.*`,
      });
    } else if (nextPhase === 'game2_select') {
      const gameNum = updatedSession.gameNumber || 2;
      nextPlaceholder = `${nextName}: select stage for Game ${gameNum}`;
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention}${gameNum === 2 ? ' (Game 1 loser)' : ''}, **select the stage for Game ${gameNum}** from the dropdown below.\n*Only ${nextName} can use the dropdown.*`,
      });
    } else if (nextPhase.includes('ban')) {
      const bansLeft = getBansForPhase(nextPhase);
      nextPlaceholder = `${nextName}: ban ${bansLeft} stage(s)`;
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention}, ban **${bansLeft}** stage(s) from the dropdown below.\n*Only ${nextName} can use the dropdown.*`,
      });
    } else if (nextPhase === 'game2_ban_3') {
      const gameNum = updatedSession.gameNumber || 2;
      nextPlaceholder = `Select exactly 3 stages to ban (Game ${gameNum})`;
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention}${gameNum === 2 ? ' (Game 1 winner)' : ' (previous game winner)'}: open the **dropdown** and **select exactly 3 stages** to ban for Game ${gameNum} (pick all 3 at once).\n*Only ${nextName} can use the dropdown.*`,
      });
    } else if (nextPhase === 'game2_complete') {
      const gameNum = updatedSession.gameNumber || 2;
      banEmbed.addFields({
        name: `Game ${gameNum} ready`,
        value: `Stage for Game ${gameNum}: **${updatedSession.selectedStageGame2}**. Play the game, then **pick who won** from the dropdown below. The loser must confirm.`,
      });
    }
  } catch (_) {
    if (nextPhase === 'game1_report_result') {
      banEmbed.addFields({
        name: 'Next step',
        value: `Stage for Game 1: **${updatedSession.selectedStage}**. Play the game, then **pick who won** from the dropdown below. The loser must confirm.`,
      });
    } else if (nextPhase.includes('select') && nextPhase.includes('game1')) {
      nextPlaceholder = 'Select stage for Game 1';
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention}, **select** the stage for Game 1 from the dropdown below.`,
      });
    } else if (nextPhase === 'game2_select') {
      const gameNum = updatedSession.gameNumber || 2;
      nextPlaceholder = `Select stage for Game ${gameNum}`;
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention}, **select** the stage for Game ${gameNum} from the dropdown below.`,
      });
    } else if (nextPhase.includes('ban')) {
      nextPlaceholder = `Ban ${getBansForPhase(nextPhase)} stage(s)`;
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention}, ban stage(s) from the dropdown below.`,
      });
    } else if (nextPhase === 'game2_ban_3') {
      const gameNum = updatedSession.gameNumber || 2;
      nextPlaceholder = `Select exactly 3 stages to ban (Game ${gameNum})`;
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention}, open the dropdown and **select exactly 3 stages** to ban for Game ${gameNum} (all at once).`,
      });
    } else if (nextPhase === 'game2_complete') {
      const gameNum = updatedSession.gameNumber || 2;
      banEmbed.addFields({
        name: `Game ${gameNum} ready`,
        value: `Stage for Game ${gameNum}: **${updatedSession.selectedStageGame2}**. Play the game, then pick who won from the dropdown below.`,
      });
    }
  }

  let nextRow;
  if (nextPhase === 'game1_report_result') {
    try {
      const m1 = await interaction.guild.members.fetch(session.player1Id).catch(() => null);
      const m2 = await interaction.guild.members.fetch(session.player2Id).catch(() => null);
      nextRow = buildResultReportRow(matchId, session.player1Id, session.player2Id, m1?.user?.username ?? 'Player 1', m2?.user?.username ?? 'Player 2', 1);
    } catch (_) {
      nextRow = null;
    }
  } else if (nextPhase === 'game2_complete') {
    try {
      const m1 = await interaction.guild.members.fetch(session.player1Id).catch(() => null);
      const m2 = await interaction.guild.members.fetch(session.player2Id).catch(() => null);
      const gameNum = updatedSession.gameNumber || 2;
      nextRow = buildResultReportRow(matchId, session.player1Id, session.player2Id, m1?.user?.username ?? 'Player 1', m2?.user?.username ?? 'Player 2', gameNum);
    } catch (_) {
      nextRow = null;
    }
  } else {
    nextRow = buildStageSelectRow(matchId, updatedSession, nextPlaceholder);
  }
  const footerText = nextRow
    ? (nextPhase === 'game1_report_result' ? 'Either player can pick who won Game 1' : nextPhase === 'game2_complete' ? `Either player can pick who won Game ${updatedSession.gameNumber || 2}` : 'Dropdown is only for the player whose turn it is')
    : null;
  if (footerText) banEmbed.setFooter({ text: footerText });

  await interaction.editReply({
    embeds: [banEmbed],
    components: nextRow ? [nextRow] : [],
  });

  try {
    const nextMember = await interaction.guild.members.fetch(nextPlayer).catch(() => null);
    if (nextMember) {
      await nextMember.send(
        `Your turn in match \`${matchId}\`. Use the **dropdown** on the bot message in the server, or \`/ban <stage>\`.`
      );
    }
  } catch (err) {
    console.warn('[banHandler] Could not DM next player:', err.message);
  }
  return true;
}
