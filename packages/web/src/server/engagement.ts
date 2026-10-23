import { pool, migrate, transaction } from './db';
import { StudioError } from './errors';
import type { GameStats } from '../shared/types';

// The caller supplies the project alias; both queries aggregate the same data.
export const engagementColumns = `
  (SELECT count(*)::int FROM studio_game_ratings WHERE project_id=p.id AND rating=1) AS likes,
  (SELECT count(*)::int FROM studio_game_ratings WHERE project_id=p.id AND rating=-1) AS dislikes,
  (SELECT count(*)::int FROM studio_game_visits WHERE project_id=p.id) AS visits`;

export async function gameStats(
  projectId: string,
  voterKey: string,
): Promise<GameStats> {
  await migrate();
  const result = await pool().query(
    `SELECT ${engagementColumns},
      coalesce((SELECT rating FROM studio_game_ratings WHERE project_id=p.id AND voter_key=$2),0)::int AS "myRating"
     FROM studio_projects p WHERE p.id=$1 AND p.released_version_id IS NOT NULL`,
    [projectId, voterKey],
  );
  if (!result.rows[0]) throw new StudioError('这个游戏还没有发布。', 404);
  return result.rows[0];
}

export async function recordEngagement(
  projectId: string,
  voterKey: string,
  input: { rating: -1 | 0 | 1 } | { visitId: string },
): Promise<GameStats> {
  await transaction(async (client) => {
    const project = await client.query(
      'SELECT id FROM studio_projects WHERE id=$1 AND released_version_id IS NOT NULL FOR SHARE',
      [projectId],
    );
    if (!project.rows[0]) throw new StudioError('这个游戏还没有发布。', 404);
    if ('visitId' in input) {
      await client.query(
        'INSERT INTO studio_game_visits(project_id,visit_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [projectId, input.visitId],
      );
    } else if (input.rating === 0) {
      await client.query(
        'DELETE FROM studio_game_ratings WHERE project_id=$1 AND voter_key=$2',
        [projectId, voterKey],
      );
    } else {
      await client.query(
        'INSERT INTO studio_game_ratings(project_id,voter_key,rating) VALUES($1,$2,$3) ON CONFLICT(project_id,voter_key) DO UPDATE SET rating=excluded.rating',
        [projectId, voterKey, input.rating],
      );
    }
  });
  return gameStats(projectId, voterKey);
}
