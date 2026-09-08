export class LevelManager {
  static readonly LEVEL_ORDER = ['GameScene'];

  static getFirstLevelScene(): string {
    return LevelManager.LEVEL_ORDER[0];
  }
}
