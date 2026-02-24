/**
 * Stage lists and aliases for SSBU stage bans.
 * Used by /coinflip and /ban slash commands.
 */
export const STAGES = {
  starters: [
    { name: 'Smashville', aliases: ['sv'] },
    { name: 'Pokémon Stadium 2', aliases: ['ps2'] },
    { name: 'Battlefield', aliases: ['bf'] },
    { name: 'Small Battlefield', aliases: ['sbf'] },
    { name: 'Town & City', aliases: ['tnc', 't&c'] },
  ],
  counterpicks: [
    { name: 'Kalos Pokemon League', aliases: ['kalos'] },
    { name: 'Hollow Bastion', aliases: ['hollow', 'hb'] },
    { name: 'Final Destination', aliases: ['fd'] },
  ],
};

/**
 * Find a stage by display name or alias (case-insensitive).
 * @param {string} input - Stage name or alias
 * @returns {{ name: string, aliases: string[] } | null}
 */
export function findStageByInput(input) {
  if (!input || typeof input !== 'string') return null;
  const lower = input.toLowerCase().trim();
  const all = [...STAGES.starters, ...STAGES.counterpicks];
  for (const stage of all) {
    if (stage.name.toLowerCase() === lower || stage.aliases.includes(lower)) {
      return stage;
    }
  }
  return null;
}
