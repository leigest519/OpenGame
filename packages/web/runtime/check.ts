import { readdir, readFile } from 'node:fs/promises';
import { buildGame, validateGame } from '../src/server/build-game';
import {
  parseAcceptanceCases,
  readPlaytestPlan,
} from '../src/server/game-playtest';

try {
  await buildGame('/input/project', '/output');
  const acceptance = parseAcceptanceCases(
    JSON.parse(await readFile('/input/acceptance.json', 'utf8')),
  );
  const validation = await validateGame(
    '/output',
    undefined,
    await readPlaytestPlan('/input/project'),
    acceptance,
  );
  console.log(
    'OPENGAME_RESULT=' +
      JSON.stringify({ ok: true, validation, files: await readdir('/output') }),
  );
} catch (error) {
  console.log(
    'OPENGAME_RESULT=' +
      JSON.stringify({
        ok: false,
        error:
          error instanceof Error
            ? error.message.slice(0, 1500)
            : '检查未完成。',
      }),
  );
}
