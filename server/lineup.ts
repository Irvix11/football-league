import type { SquadPlayerEntry, TeamRoles } from '../src/types/football.js';

function setupManagerRoles(starters: SquadPlayerEntry[]): TeamRoles {
  if (starters.length === 0) {
    return { captainId: '', penaltyTakerId: '', freeKickTakerId: '', cornerTakerId: '' };
  }
  const sortedByOvr = [...starters].sort((a, b) => b.player.overall - a.player.overall);
  const captain = sortedByOvr[0]?.player.id || starters[0].player.id;

  const sortedBySho = [...starters].sort((a, b) => b.player.attributes.sho - a.player.attributes.sho);
  const pkTaker = sortedBySho[0]?.player.id || captain;

  const sortedByPas = [...starters].sort((a, b) => b.player.attributes.pas - a.player.attributes.pas);
  const fkTaker = sortedByPas[0]?.player.id || captain;
  const ckTaker = sortedByPas[1]?.player.id || sortedByPas[0]?.player.id || captain;

  return {
    captainId: captain,
    penaltyTakerId: pkTaker,
    freeKickTakerId: fkTaker,
    cornerTakerId: ckTaker,
  };
}
