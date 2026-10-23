import { test } from 'node:test';
import { checkGeneratorSandbox } from '../../src/server/generator-check';

test(
  'Linux generation sandbox starts with a private workspace and denies neighboring files',
  { skip: process.platform !== 'linux', timeout: 20000 },
  async () => {
    await checkGeneratorSandbox();
  },
);

test(
  'conversation sandbox also denies writes inside its own context directory',
  { skip: process.platform !== 'linux', timeout: 20000 },
  async () => {
    await checkGeneratorSandbox(true);
  },
);
