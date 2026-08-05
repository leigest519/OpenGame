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
    expect(instruction).toContain(
      'Derive authored counts from `SceneMap` arrays',
    );
    expect(instruction).toContain(
      'do not add a config count leaf merely to mirror or assert',
    );
    expect(instruction).toContain('separate completion threshold');
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
  it('requires a complete 3D core loop without changing Phaser prompts', () => {
    const instruction = gameplaySemanticsInstruction('threed_basic');

    expect(instruction).toContain('Do not default to the scaffold pickup loop');
    expect(instruction).toContain('repeatable 20-60 second core loop');
    expect(instruction).toContain('meaningful decision or skill demand');
    expect(instruction).toContain('observable failure condition');
    expect(instruction).toContain('explicitly requests a no-fail experience');
    expect(instruction).toContain('instead of inventing game over');
    expect(instruction).toContain('three escalating beats');
    expect(instruction).toContain('exact win/lose conditions');
    expect(instruction).toContain('final `GameScene` or DOM consumer');
    expect(instruction).toContain('ordered or sequential objectives');
    expect(instruction).toContain('private state inside `GameScene`');
    expect(instruction).toContain('never weaken the user requirement');
    expect(instruction).toContain(
      'fog or DPR leaves do not make camera far config-backed',
    );
    expect(instruction).toContain('forbidden cross-lane transitions');
    expect(instruction).toContain('play every branch');
    expect(instruction).toContain('attempt any claimed blocked switch');
    expect(instruction).toContain(
      'never strengthen, replace, or contradict it',
    );
    expect(instruction).toContain(
      'optional objectives must not become pass gates',
    );
    expect(instruction).toContain('final uninstrumented artifact');
    expect(instruction).toContain('probes must not be a prerequisite for PASS');
    expect(instruction).toContain(
      'cue -> player action -> decision -> state change -> feedback -> repeat',
    );
    expect(instruction).toContain('Gameplay Feasibility Ledger');
    expect(instruction).toContain('one complete winning trace');
    expect(instruction).toContain('derived traversal/action time');
    expect(instruction).toContain(
      'handled-action counts must equal the authored event count',
    );
    expect(instruction).toContain(
      'Recompute the ledger after every tuning edit',
    );
    expect(instruction).toContain('Label every trace DERIVED or OBSERVED');
    expect(instruction).toContain('exact route, strategy, and terminal state');
    expect(instruction).toContain(
      'must not upgrade the target trace to observed',
    );
    expect(instruction).toContain('carry state across escalation thresholds');
    expect(instruction).toContain(
      'observed terminal values override conflicting estimates',
    );
    expect(gameplaySemanticsInstruction('platformer')).toBe('');
    expect(gameplaySemanticsInstruction('top_down')).toBe('');
  });
});
