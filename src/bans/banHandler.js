import { EmbedBuilder } from 'discord.js';
import { getSession, updateSession } from './banSessionStore.js';
import { STAGES, findStageByInput } from './stageData.js';

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

/**
 * Advance turn and phase after a ban/selection. Game 1: winner bans 1, loser bans 2, winner selects from remaining 2.
 * @param {object} session - Current session
 * @returns {{ nextPlayer: string, nextPhase: string }}
 */
function advanceTurn(session) {
  const { player1Id, player2Id, coinFlipWinnerId, turnPhase } = session;
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
      return { nextPlayer: loser, nextPhase: 'game2_ban_3' };
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
    if (!matchId) {
      await interaction.editReply(
        '❌ No match ID provided. Run `/coinflip` first and use the Match ID from the embed footer or your DM.'
      );
      return;
    }

    const session = await getSession(matchId);
    if (!session) {
      await interaction.editReply('❌ Match session not found or expired. Start a new match with `/coinflip`.');
      return;
    }

    if (session.currentTurn !== interaction.user.id) {
      await interaction.editReply("❌ It's not your turn.");
      return;
    }

    const isSelectionPhase = session.turnPhase === 'game1_select';
    const bannedStages = session.bannedStages || [];

    if (isSelectionPhase) {
      const remainingStarters = STAGES.starters.filter(s => !bannedStages.includes(s.name));
      if (!remainingStarters.some(s => s.name === stage.name)) {
        await interaction.editReply(
          `❌ **${stage.name}** is not one of the remaining starters. Choose from: ${remainingStarters.map(s => s.name).join(', ')}`
        );
        return;
      }
    } else {
      if (bannedStages.includes(stage.name)) {
        await interaction.editReply(`❌ **${stage.name}** is already banned.`);
        return;
      }

      if (session.turnPhase.includes('game1')) {
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
    if (isSelectionPhase) {
      updates.selectedStage = stage.name;
    }

    const { nextPlayer, nextPhase } = advanceTurn({
      ...session,
      ...updates,
    });
    updates.currentTurn = nextPlayer;
    updates.turnPhase = nextPhase;

    const updatedSession = await updateSession(matchId, updates);
    const nextBannedList = updatedSession.bannedStages || [];

    const remainingStarters = STAGES.starters.filter(s => !nextBannedList.includes(s.name));
    const remainingAll = [...STAGES.starters, ...STAGES.counterpicks].filter(
      s => !nextBannedList.includes(s.name)
    );

    const banEmbed = new EmbedBuilder()
      .setColor(INFO_EMBED_COLOR)
      .setTitle(isSelectionPhase ? `Stage selected: ${stage.name}` : `Stage banned: ${stage.name}`)
      .setDescription(
        `**${interaction.user.username}** ${isSelectionPhase ? 'selected' : 'banned'} **${stage.name}**.\n\nBanned/used so far:\n${nextBannedList.map(s => `• ${s}`).join('\n') || '(none)'}`
      )
      .addFields({
        name: 'Remaining stages',
        value: remainingAll.map(s => `• ${s.name}`).join('\n') || 'None',
      });

    const nextMention = nextPlayer === session.player1Id ? `<@${session.player1Id}>` : `<@${session.player2Id}>`;
    if (nextPhase.includes('select')) {
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention}, use \`/ban\` to **select** the stage for Game 1 from the remaining starters.`,
      });
    } else if (nextPhase.includes('ban')) {
      const bansLeft = getBansForPhase(nextPhase);
      banEmbed.addFields({
        name: 'Next step',
        value: `${nextMention}, ban **${bansLeft}** stage(s). Match ID: \`${matchId}\``,
      });
    } else if (nextPhase === 'game2_ban_3') {
      banEmbed.addFields({
        name: 'Game 1 complete',
        value: `Stage for Game 1: **${updatedSession.selectedStage}**. Next: Game 2 counterpick bans (${nextMention} bans 3).`,
      });
    }

    await interaction.editReply({ embeds: [banEmbed] });

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
  } catch (err) {
    console.error('[banHandler] error:', err);
    try {
      await interaction.editReply('❌ Something went wrong.');
    } catch (_) {}
  }
}
