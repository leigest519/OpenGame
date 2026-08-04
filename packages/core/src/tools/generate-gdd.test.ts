import { describe, expect, it } from 'vitest';
import {
  configMergeInstruction,
  gameplaySemanticsInstruction,
} from './generate-gdd.js';

describe('configMergeInstruction', () => {
  it('requires consumed config and deletion of superseded 3D leaves', () => {
    const instruction = configMergeInstruction('threed_basic');

    expect(instruction).toContain('every leaf must have a runtime consumer');
    expect(instruction).toContain('superseded leaves must be removed');
    expect(instruction).not.toContain('NEVER delete infrastructure fields');
  });

  it.each(['platformer', 'top_down'] as const)(
    'preserves the existing Phaser config contract for %s',
    (archetype) => {
      const instruction = configMergeInstruction(archetype);

      expect(instruction).toContain('NEVER delete infrastructure fields');
      expect(instruction).toContain('screenSize');
      expect(instruction).toContain('debugConfig');
    },
  );
});

describe('gameplaySemanticsInstruction', () => {
  it('preserves ordered 3D objectives without changing Phaser prompts', () => {
    const instruction = gameplaySemanticsInstruction('threed_basic');

    expect(instruction).toContain('ordered or sequential objectives');
    expect(instruction).toContain('private state inside `GameScene`');
    expect(instruction).toContain('never weaken the user requirement');
    expect(gameplaySemanticsInstruction('platformer')).toBe('');
    expect(gameplaySemanticsInstruction('top_down')).toBe('');
  });
});
