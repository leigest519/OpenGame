import { LoadingManager, Texture, TextureLoader } from 'three';

export class Preloader {
  readonly textures = new Map<string, Texture>();

  async load(entries?: Record<string, string>): Promise<void> {
    const assetEntries = entries ?? (await this.readAssetPack());
    const manager = new LoadingManager();
    const loader = new TextureLoader(manager);
    const loads = Object.entries(assetEntries).map(
      ([key, url]) =>
        new Promise<void>((resolve) => {
          loader.load(
            url,
            (texture) => {
              this.textures.set(key, texture);
              resolve();
            },
            undefined,
            () => resolve(),
          );
        }),
    );
    await Promise.all(loads);
  }

  private async readAssetPack(): Promise<Record<string, string>> {
    try {
      const response = await fetch('assets/asset-pack.json');
      if (!response.ok) return {};
      const pack = (await response.json()) as Record<
        string,
        { files?: Array<{ type?: string; key?: string; url?: string }> }
      >;
      const entries: Record<string, string> = {};
      for (const section of Object.values(pack)) {
        for (const file of section.files ?? []) {
          if (file.type === 'image' && file.key && file.url) {
            entries[file.key] = file.url;
          }
        }
      }
      return entries;
    } catch {
      return {};
    }
  }
}
