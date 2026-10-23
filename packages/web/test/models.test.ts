import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatorArguments } from '../src/server/generator-policy';

test('Astra is explicitly passed for both planning and building; default preserves CLI selection', () => {
  for (const readOnly of [true, false]) {
    const args = generatorArguments('/tmp/game', readOnly, 'gpt-6-astra');
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-astra');
    assert(args.includes('--strict-config'));
    assert(args.includes('features.multi_agent=false'));
    assert(args.some((a) => a.includes('network={enabled=false}')));
  }
  assert(!generatorArguments('/tmp/game').includes('--model'));
  assert.throws(() => generatorArguments('/tmp/game', false, '--bad' as never));
});

import { generationTimeout } from '../src/server/model-runtime';
test('Astra has a bounded independent time budget', () => {
  assert.equal(generationTimeout('gpt-6-astra'), 1200000);
  assert.equal(generationTimeout('default'), 600000);
});
