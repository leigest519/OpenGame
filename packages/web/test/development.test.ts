import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConversationResult } from '../src/shared/development';
import { generatorArguments } from '../src/server/generator-policy';

test('a discussion cannot silently turn into implementation; incomplete plans fail closed', () => {
  assert.equal(
    parseConversationResult(
      '{"action":"discuss","reply":"可以先讨论操作方式。","plan":null}',
    ).action,
    'discuss',
  );
  for (const text of [
    '{"action":"implement","reply":"开始","plan":null}',
    '{"action":"implement","reply":"开始","plan":{"goal":"做游戏","decisions":[],"tasks":[],"checks":[]}}',
    '游戏已经完成',
    '{"action":"execute_shell","reply":"开始","plan":null}',
  ])
    assert.throws(() => parseConversationResult(text), /未开始制作/);
});

test('conversation sandbox is read-only with network and neighboring paths still denied', () => {
  const args = generatorArguments('/private/project', true);
  const policy = args.find((arg) => arg.startsWith('permissions.'))!;
  assert.ok(policy.includes('"."="read"'));
  assert.ok(!policy.includes('"write"'));
  assert.ok(policy.includes('":root"="deny"'));
  assert.ok(policy.includes('network={enabled=false}'));
  assert.ok(
    generatorArguments('/private/project').some((arg) =>
      arg.includes('"."="write"'),
    ),
  );
});
