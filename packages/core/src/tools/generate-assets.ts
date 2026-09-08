/**
 * Generate Assets Tool
 * A complete rewrite inspired by PiXelDa architecture
 *
 * Features:
 * - Multi-model support (Tongyi / Doubao)
 * - Image generation with auto background removal
 * - Animation generation via I2V (Image-to-Video) or I2I fallback
 * - Audio generation via ABC Notation
 * - Background images (no bg removal)
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import type { Config } from '../config/config.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';

import type { ModelRouter } from '../services/assetModelRouter.js';
import { createModelRouter } from '../services/assetModelRouter.js';
import { MissingProviderConfigError } from '../services/providerConfig.js';
import { BackgroundRemovalService } from '../utils/backgroundRemoval.js';
import { FrameExtractionService } from '../services/assetVideoService.js';
import type {
  GenerateAssetsParams,
  BackgroundRequest,
  ImageRequest,
  AnimationRequest,
  AudioRequest,
  TilesetRequest,
  AssetPack,
} from './generate-assets-types.js';
import { ToolNames, ToolDisplayNames } from './tool-names.js';

import { TilesetProcessor } from '../services/tileset-processor.js';

// ============== Constants ==============

const MAX_CONCURRENCY = 2;
const DEFAULT_IMAGE_SIZE = '1024*1024';

export type ImageNormalization = {
  width: number;
  height: number;
  fit: 'contain' | 'cover';
};

export function parseImageSize(
  size: string,
): Pick<ImageNormalization, 'width' | 'height'> {
  const match = /^(\d+)[*x](\d+)$/.exec(size);
  if (!match) throw new Error(`Invalid image size: ${size}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

export async function normalizeImageBuffer(
  buffer: Buffer,
  spec: ImageNormalization,
): Promise<Buffer> {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  if (
    metadata.format === 'png' &&
    metadata.width === spec.width &&
    metadata.height === spec.height
  ) {
    return buffer;
  }
  return image
    .resize(spec.width, spec.height, {
      fit: spec.fit,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
    })
    .toBuffer();
}

const DEFAULT_SPRITE_NORMALIZATION: ImageNormalization = {
  ...parseImageSize(DEFAULT_IMAGE_SIZE),
  fit: 'contain',
};

// ============== Invocation Class ==============

class GenerateAssetsInvocation extends BaseToolInvocation<
  GenerateAssetsParams,
  ToolResult
> {
  private config: Config;
  /**
   * The router (and its underlying provider services) is built lazily so
   * a missing API key surfaces as an actionable execute-time error
   * instead of crashing tool registration / invocation construction.
   */
  private modelRouter!: ModelRouter;
  private bgRemovalService: BackgroundRemovalService;
  private frameExtractionService: FrameExtractionService;
  private tilesetProcessor: TilesetProcessor;

  constructor(config: Config, params: GenerateAssetsParams) {
    super(params);
    this.config = config;

    // Initialize background removal service
    // Use BACKGROUND_REMOVAL_BACKEND env var to switch: 'imgly' (default) or 'rembg' (Python/PiXelDa)
    const bgBackend =
      (process.env.BACKGROUND_REMOVAL_BACKEND as 'imgly' | 'rembg') || 'imgly';
    this.bgRemovalService = new BackgroundRemovalService({
      projectRoot: config.getProjectRoot(),
      backend: bgBackend,
      pythonPath: process.env.PYTHON_PATH, // Optional: custom Python path
    });

    // Initialize frame extraction service
    this.frameExtractionService = new FrameExtractionService();

    // Initialize tileset processor
    this.tilesetProcessor = new TilesetProcessor();
  }

  getDescription(): string {
    return `Generating ${this.params.assets.length} assets...`;
  }

  /**
   * Build the model router on demand. Throws `MissingProviderConfigError`
   * (with an actionable message + docs link) when the user hasn't
   * configured an image provider; that error is caught at the top of
   * `execute()` and surfaced as a tool-result error rather than
   * propagated as an uncaught exception.
   */
  private ensureModelRouter(): ModelRouter {
    if (!this.modelRouter) {
      this.modelRouter = createModelRouter({
        modelType: this.params.model_type,
        providers: this.config.getOpenGameProviders(),
      });
    }
    return this.modelRouter;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    try {
      this.ensureModelRouter();
    } catch (error) {
      if (error instanceof MissingProviderConfigError) {
        return {
          llmContent: error.message,
          returnDisplay: `**Asset generation cannot start**\n\n${error.message}`,
          error: { message: error.message, type: 'API_ERROR' as never },
        };
      }
      throw error;
    }

    const workspaceDir = this.config.getWorkspaceContext().getDirectories()[0];
    const targetDirName =
      this.params.output_dir_name || path.join('public', 'assets');
    const absoluteAssetsDir = path.join(workspaceDir, targetDirName);
    const assetPackPath = path.join(absoluteAssetsDir, 'asset-pack.json');

    // Ensure output directory exists
    await fs.mkdir(absoluteAssetsDir, { recursive: true });

    // Load or initialize asset pack
    const assetPack = await this.loadAssetPack(assetPackPath);

    const results: string[] = [];
    const errors: string[] = [];
    const activePromises = new Set<Promise<void>>();

    // Process assets with concurrency control
    for (const assetReq of this.params.assets) {
      if (signal.aborted) break;

      // Wait if at max concurrency
      if (activePromises.size >= MAX_CONCURRENCY) {
        await Promise.race(activePromises);
      }

      const task = (async () => {
        try {
          switch (assetReq.type) {
            case 'background':
              await this.handleBackground(
                assetReq,
                assetPack,
                absoluteAssetsDir,
                signal,
              );
              break;
            case 'image':
              await this.handleImage(
                assetReq,
                assetPack,
                absoluteAssetsDir,
                signal,
              );
              break;
            case 'animation':
              await this.handleAnimation(
                assetReq,
                assetPack,
                absoluteAssetsDir,
                signal,
              );
              break;
            case 'audio':
              await this.handleAudio(
                assetReq,
                assetPack,
                absoluteAssetsDir,
                signal,
              );
              break;
            case 'tileset':
              await this.handleTileset(
                assetReq,
                assetPack,
                absoluteAssetsDir,
                signal,
              );
              break;
            default:
              console.warn(
                `[GenerateAssets] Unknown asset type: ${(assetReq as { type: string }).type}`,
              );
              throw new Error(
                `Unsupported asset type: ${(assetReq as { type: string }).type}. Supported types: background, image, animation, audio, tileset`,
              );
          }
          results.push(`${assetReq.key} (${assetReq.type})`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[GenerateAssets] Failed ${assetReq.key}:`, msg);
          errors.push(`${assetReq.key}: ${msg}`);
        }
      })();

      activePromises.add(task);
      task.finally(() => activePromises.delete(task));
    }

    // Wait for all tasks to complete
    await Promise.all(activePromises);

    // Save asset pack
    await fs.writeFile(assetPackPath, JSON.stringify(assetPack, null, 2));

    // Generate result message
    const sections = Object.keys(assetPack).filter((k) => k !== 'meta');
    const instruction = `
Assets generated in '${targetDirName}/asset-pack.json'.
Items: ${results.join(', ')}
Sections: ${sections.join(', ')}

CODING INSTRUCTION (Phaser 3):
1. Preloader - load ALL sections:
   this.load.pack('assetPack', 'assets/asset-pack.json');

2. Or load SPECIFIC sections:
   this.load.pack('backgrounds', 'assets/asset-pack.json', 'backgrounds');
   this.load.pack('player_animations', 'assets/asset-pack.json', 'player_animations');

3. Use keys directly: this.add.image(0, 0, 'key_name');

4. For audio:
   this.load.audio('bgm', 'assets/bgm.wav');
   this.sound.play('bgm', { loop: true });
`;

    return {
      llmContent: instruction,
      returnDisplay: `✅ Generated ${results.length} assets.\nErrors: ${errors.length}${errors.length > 0 ? '\n' + errors.join('\n') : ''}`,
    };
  }

  // ============== Asset Handlers ==============

  private async handleBackground(
    req: BackgroundRequest,
    assetPack: AssetPack,
    assetsDir: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new Error('Aborted');

    console.log(`[GenerateAssets] Generating background: ${req.key}`);

    const prompt = `
      Game background art, ${req.description}, ${this.params.style_anchor}.
      Full scene illustration, edge-to-edge, high detail, seamless composition.
      IMPORTANT: This is a BACKGROUND - must be fully opaque with rich colors.
      Fill entire canvas with scenery.
      
      ---FORBIDDEN (CRITICAL)---
      NO characters, NO people, NO figures, NO creatures, NO animals, NO NPCs.
      NO text, NO UI elements, NO transparency.
      PURE SCENERY ONLY - landscape, buildings, environment, sky, etc.
    `;

    const resolution = req.resolution || DEFAULT_IMAGE_SIZE;
    const imageUrl = await this.modelRouter.generateImage(prompt, resolution);
    const buffer = await this.downloadImage(imageUrl);
    const cdnUrl = await this.saveAsset(buffer, req.key, assetsDir, 'png', {
      ...parseImageSize(resolution),
      fit: 'cover',
    });

    this.updateAssetPack(assetPack, req.key, 'background', cdnUrl);
  }

  private async handleImage(
    req: ImageRequest,
    assetPack: AssetPack,
    assetsDir: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new Error('Aborted');

    console.log(`[GenerateAssets] Generating image: ${req.key}`);

    const prompt = `
      Game asset sprite, ${req.description}, ${this.params.style_anchor}.
      Single object only, isolated on white background, centered composition, consistent size.
      ${this.params.composition_env || ''}
      IMPORTANT: Pure white background, no text, no position offset, ONE object only.
    `;

    const imageUrl = await this.modelRouter.generateImage(
      prompt,
      req.size || DEFAULT_IMAGE_SIZE,
    );

    // Remove background
    const buffer = await this.bgRemovalService.removeBackgroundSafe(imageUrl);
    const cdnUrl = await this.saveAsset(
      buffer,
      req.key,
      assetsDir,
      'png',
      DEFAULT_SPRITE_NORMALIZATION,
    );

    this.updateAssetPack(assetPack, req.key, 'image', cdnUrl);
  }

  private async handleAnimation(
    req: AnimationRequest,
    assetPack: AssetPack,
    assetsDir: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new Error('Aborted');

    console.log(`[GenerateAssets] Generating animation: ${req.key}`);

    // Step 1: Generate base image
    const basePrompt = `
      Game character sprite, ${req.description}, ${this.params.style_anchor}.
      SIDE VIEW (profile view, facing right), chibi style with big head.
      Single character only, neutral idle pose, centered composition.
      ${this.params.composition_env || ''}
      IMPORTANT: Pure white background, SIDE VIEW only, ONE character only.
    `;

    const baseImageUrl = await this.modelRouter.generateImage(
      basePrompt,
      DEFAULT_IMAGE_SIZE,
    );

    // Save base/idle frame
    const baseKey = `${req.key}_idle_01`;
    const baseBuffer =
      await this.bgRemovalService.removeBackgroundSafe(baseImageUrl);
    const baseCdnUrl = await this.saveAsset(
      baseBuffer,
      baseKey,
      assetsDir,
      'png',
      DEFAULT_SPRITE_NORMALIZATION,
    );
    this.updateAssetPack(assetPack, baseKey, 'animation', baseCdnUrl);

    // Step 2: Generate animation frames
    // Default to I2V (video) because I2I (wanx2.1-imageedit) may output to non-Beijing OSS
    // which is not accessible from some network environments (e.g., RunPod)
    const useI2V = req.useI2V !== false; // Default: true (use I2V unless explicitly disabled)

    if (useI2V) {
      // Use I2V (Image-to-Video) approach - outputs to Beijing OSS, always accessible
      await this.generateAnimationViaI2V(
        req,
        baseImageUrl,
        assetPack,
        assetsDir,
        signal,
      );
    } else {
      // Use I2I (Image-to-Image) approach - may have OSS accessibility issues
      console.warn(
        `[GenerateAssets] Using I2I mode - may have OSS network issues`,
      );
      await this.generateAnimationViaI2I(
        req,
        baseImageUrl,
        assetPack,
        assetsDir,
        signal,
      );
    }
  }

  private async generateAnimationViaI2V(
    req: AnimationRequest,
    baseImageUrl: string,
    assetPack: AssetPack,
    assetsDir: string,
    signal: AbortSignal,
  ): Promise<void> {
    // Check if ffmpeg is available for local frame extraction
    const ffmpegAvailable =
      await this.frameExtractionService.isFFmpegAvailable();

    if (!ffmpegAvailable) {
      console.warn(
        `[GenerateAssets] FFmpeg not available, falling back to I2I mode`,
      );
      await this.generateAnimationViaI2I(
        req,
        baseImageUrl,
        assetPack,
        assetsDir,
        signal,
      );
      return;
    }

    console.log(`[GenerateAssets] FFmpeg available: ${ffmpegAvailable}`);

    for (const animation of req.animations) {
      if (signal.aborted) break;
      if (animation.name === 'idle' && animation.frameCount <= 1) continue;

      console.log(
        `[GenerateAssets] Generating I2V animation: ${animation.name}`,
      );

      try {
        // Step 1: Generate video from base image using I2V
        const videoPrompt = `
          ${req.description}, ${animation.action_desc}.
          SIDE VIEW animation, single character only, smooth loop.
          IMPORTANT: Keep SIDE VIEW, character size MUST remain identical, stay at same position!
          ${this.params.style_anchor}
        `;

        console.log(`[GenerateAssets] Step 1: Generating video via I2V...`);
        const { videoUrl } = await this.modelRouter.generateVideo(
          baseImageUrl,
          videoPrompt,
          '480P',
        );
        console.log(
          `[GenerateAssets] Video generated: ${videoUrl.substring(0, 50)}...`,
        );

        // Step 2: Extract frames from video locally using ffmpeg
        // Use FIRST_LAST_FRAME_ONLY env var to enable first+last frame mode (for testing)
        const firstLastOnly = process.env.FIRST_LAST_FRAME_ONLY === 'true';
        console.log(
          `[GenerateAssets] Step 2: Extracting frames locally via ffmpeg (firstLastOnly=${firstLastOnly})...`,
        );
        const result = await this.frameExtractionService.extractFramesLocal(
          videoUrl,
          animation.frameCount,
          0, // fromTime
          4, // toTime (video is usually ~5s)
          assetsDir, // Output to assets dir
          firstLastOnly, // Only extract first and last frames when enabled
        );
        const framePaths = result.framePaths;
        const videoPath = result.videoPath;

        if (framePaths.length === 0) {
          throw new Error('Frame extraction failed - no frames extracted');
        }

        console.log(
          `[GenerateAssets] Extracted ${framePaths.length} frames locally (firstLastOnly=${firstLastOnly})`,
        );

        // Step 2.5: Save video file with proper name
        if (videoPath) {
          const videoKey = `${req.key}_${animation.name}_video`;
          const finalVideoPath = path.join(assetsDir, `${videoKey}.mp4`);

          // Move video to final location with proper name
          try {
            // If video is already in assetsDir, just rename it
            if (path.dirname(videoPath) === assetsDir) {
              await fs.rename(videoPath, finalVideoPath);
            } else {
              // Otherwise copy it
              await fs.copyFile(videoPath, finalVideoPath);
            }

            const videoCdnUrl = `assets/${videoKey}.mp4`;
            this.updateAssetPack(assetPack, videoKey, 'video', videoCdnUrl);
            console.log(`[GenerateAssets] Video saved: ${videoKey}.mp4`);
          } catch (error) {
            console.warn(`[GenerateAssets] Failed to save video: ${error}`);
          }
        }

        // Step 3: Process frames - remove background and save
        console.log(
          `[GenerateAssets] Step 3: Processing ${framePaths.length} frames...`,
        );
        for (let i = 0; i < framePaths.length; i++) {
          if (signal.aborted) break;

          const frameKey = `${req.key}_${animation.name}_${String(i + 1).padStart(2, '0')}`;

          // Read frame, remove background, and save
          const frameBuffer = await fs.readFile(framePaths[i]);
          const processedBuffer =
            await this.bgRemovalService.removeBackgroundFromBuffer(frameBuffer);
          const frameCdnUrl = await this.saveAsset(
            processedBuffer,
            frameKey,
            assetsDir,
            'png',
            DEFAULT_SPRITE_NORMALIZATION,
          );
          this.updateAssetPack(assetPack, frameKey, 'animation', frameCdnUrl);

          // Clean up temp frame file
          try {
            await fs.unlink(framePaths[i]);
          } catch {
            // best-effort temp cleanup
          }

          console.log(
            `[GenerateAssets] Saved frame ${i + 1}/${framePaths.length}: ${frameKey}`,
          );
        }

        // Step 4: Extract audio from animation video (optional)
        try {
          console.log(
            `[GenerateAssets] Step 4: Extracting audio from animation video (first 2s)...`,
          );
          const audioPath = await this.frameExtractionService.extractAudio(
            videoUrl,
            undefined,
            0,
            2,
          );
          const audioBuffer = await fs.readFile(audioPath);
          await fs.unlink(audioPath);
          try {
            await fs.rmdir(path.dirname(audioPath));
          } catch {
            // best-effort temp cleanup
          }

          const audioKey = `${req.key}_${animation.name}_sfx`;
          const audioCdnUrl = await this.saveAsset(
            audioBuffer,
            audioKey,
            assetsDir,
            'wav',
          );
          this.updateAssetPack(assetPack, audioKey, 'audio', audioCdnUrl);
          console.log(
            `[GenerateAssets] Extracted animation audio: ${audioKey}.wav`,
          );
        } catch (error) {
          console.log(
            `[GenerateAssets] No audio extracted from animation (might be silent video): ${error}`,
          );
        }

        console.log(
          `[GenerateAssets] I2V animation ${animation.name} completed!`,
        );
      } catch (error) {
        console.warn(
          `[GenerateAssets] I2V failed for ${animation.name}: ${error}`,
        );
        console.log(
          `[GenerateAssets] Falling back to I2I for ${animation.name}...`,
        );
        await this.generateSingleAnimationI2I(
          req,
          animation,
          baseImageUrl,
          assetPack,
          assetsDir,
          signal,
        );
      }
    }
  }

  private async generateAnimationViaI2I(
    req: AnimationRequest,
    baseImageUrl: string,
    assetPack: AssetPack,
    assetsDir: string,
    signal: AbortSignal,
  ): Promise<void> {
    for (const animation of req.animations) {
      if (signal.aborted) break;
      await this.generateSingleAnimationI2I(
        req,
        animation,
        baseImageUrl,
        assetPack,
        assetsDir,
        signal,
      );
    }
  }

  private async generateSingleAnimationI2I(
    req: AnimationRequest,
    animation: { name: string; frameCount: number; action_desc: string },
    baseImageUrl: string,
    assetPack: AssetPack,
    assetsDir: string,
    signal: AbortSignal,
  ): Promise<void> {
    let previousFrameUrl: string | null = null;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 5000; // 5 seconds
    const FRAME_DELAY = 2000; // 2 seconds between frames to avoid rate limiting

    for (let i = 1; i <= animation.frameCount; i++) {
      if (signal.aborted) break;
      if (animation.name === 'idle' && i === 1) continue;

      const frameKey = `${req.key}_${animation.name}_${String(i).padStart(2, '0')}`;

      const framePrompt = [
        `Same exact character as reference, ${animation.action_desc}.`,
        `SIDE VIEW animation, single character only, frame ${i} of ${animation.frameCount}.`,
        `IMPORTANT: Keep SIDE VIEW, same direction as reference.`,
        `IMPORTANT: Character size MUST be identical, stay at same position!`,
        `${this.params.style_anchor}, white background.`,
      ].join(' ');

      // Retry logic for I2I API failures
      let frameUrl: string | null = null;
      let lastError: Error | null = null;

      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        try {
          if (retry > 0) {
            console.log(
              `[GenerateAssets] Retry ${retry}/${MAX_RETRIES} for frame ${frameKey}...`,
            );
            await this.sleep(RETRY_DELAY * retry); // Exponential backoff
          }

          frameUrl = await this.modelRouter.editImage(
            baseImageUrl,
            framePrompt,
            previousFrameUrl,
          );
          break; // Success, exit retry loop
        } catch (error) {
          lastError = error as Error;
          console.warn(
            `[GenerateAssets] I2I failed (attempt ${retry + 1}/${MAX_RETRIES}): ${lastError.message}`,
          );

          // If it's a server error, retry; otherwise, throw immediately
          if (
            !lastError.message.includes('Internal server error') &&
            !lastError.message.includes('Task failed')
          ) {
            throw error;
          }
        }
      }

      if (!frameUrl) {
        console.warn(
          `[GenerateAssets] Skipping frame ${frameKey} after ${MAX_RETRIES} retries`,
        );
        continue; // Skip this frame instead of failing entire animation
      }

      const frameBuffer =
        await this.bgRemovalService.removeBackgroundSafe(frameUrl);
      const frameCdnUrl = await this.saveAsset(
        frameBuffer,
        frameKey,
        assetsDir,
        'png',
        DEFAULT_SPRITE_NORMALIZATION,
      );
      this.updateAssetPack(assetPack, frameKey, 'animation', frameCdnUrl);

      previousFrameUrl = frameUrl;

      // Add delay between frames to avoid rate limiting
      if (i < animation.frameCount) {
        await this.sleep(FRAME_DELAY);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async handleAudio(
    req: AudioRequest,
    assetPack: AssetPack,
    assetsDir: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new Error('Aborted');

    console.log(
      `[GenerateAssets] Generating audio: ${req.key} (${req.audioType})`,
    );
    console.log(
      `[GenerateAssets] Audio request details: duration=${req.duration}, genre=${req.genre}, tempo=${req.tempo}`,
    );
    console.log(`[GenerateAssets] Output directory: ${assetsDir}`);

    const duration =
      req.audioType === 'sfx' ? req.duration || 1 : req.duration || 5;
    const audioType = req.audioType === 'bgm' ? 'bgm' : 'sfx';
    let buffer: Buffer | null = null;

    // Strategy 1: T2V → Extract audio (best quality, uses video model)
    const ffmpegAvailable =
      await this.frameExtractionService.isFFmpegAvailable();
    if (ffmpegAvailable) {
      try {
        console.log(
          `[GenerateAssets] Step 1: Generating video for audio extraction (T2V)...`,
        );
        const videoPrompt = `
          ${req.description}.
          Music visualization, abstract, ${req.genre || 'ambient'}, ${req.tempo || 'medium'} tempo.
          High quality audio, clear sound.
        `;
        const { videoUrl } = await this.modelRouter.generateVideoFromText(
          videoPrompt,
          '720P',
        );
        console.log(
          `[GenerateAssets] Video generated: ${videoUrl.substring(0, 50)}...`,
        );

        console.log(`[GenerateAssets] Step 2: Extracting audio from video...`);
        const audioPath = await this.frameExtractionService.extractAudio(
          videoUrl,
          undefined,
          0,
          7,
        );
        buffer = await fs.readFile(audioPath);
        await fs.unlink(audioPath);
        try {
          await fs.rmdir(path.dirname(audioPath));
        } catch {
          // best-effort temp cleanup
        }
        console.log(`[GenerateAssets] Audio extraction successful!`);
      } catch (error) {
        console.warn(
          `[GenerateAssets] Video-based audio generation failed: ${error}`,
        );
      }
    }

    // Strategy 2: ABC notation → WAV via symusic
    if (!buffer) {
      console.log(`[GenerateAssets] Trying ABC notation via LLM...`);
      let abcNotation: string | null = null;
      try {
        abcNotation = await this.modelRouter.generateABC(req);
        console.log(
          `[GenerateAssets] ABC notation generated (${abcNotation.length} chars)`,
        );
      } catch (error) {
        console.warn(`[GenerateAssets] ABC generation failed: ${error}`);
      }

      if (abcNotation) {
        try {
          buffer = await this.modelRouter.generateAudioFromABC(
            abcNotation,
            audioType,
            duration,
          );
          console.log(`[GenerateAssets] ABC → WAV conversion successful!`);
        } catch (error) {
          console.warn(`[GenerateAssets] ABC → WAV failed: ${error}`);
        }
      }
    }

    // Strategy 3: Procedural fallback
    if (!buffer) {
      console.log(
        `[GenerateAssets] Using procedural audio generation (duration=${duration}s, type=${audioType})...`,
      );
      try {
        buffer = await this.modelRouter.generatePlaceholderAudio(
          duration,
          audioType,
        );
        console.log(
          `[GenerateAssets] Procedural audio generated successfully (${buffer.length} bytes)`,
        );
      } catch (error) {
        console.error(`[GenerateAssets] Procedural audio FAILED: ${error}`);
        throw new Error(
          `Audio generation failed for ${req.key}: All methods failed. Error: ${error}`,
        );
      }
    }

    if (!buffer || buffer.length === 0) {
      throw new Error(`Audio generation failed for ${req.key}: Empty buffer`);
    }

    const cdnUrl = await this.saveAsset(buffer, req.key, assetsDir, 'wav');
    console.log(
      `[GenerateAssets] Audio file written: ${req.key}.wav (${buffer.length} bytes)`,
    );

    this.updateAssetPack(assetPack, req.key, 'audio', cdnUrl);
    console.log(
      `[GenerateAssets] Audio saved: ${req.key}.wav (${audioType}, ${duration}s)`,
    );
  }

  // ============== Tileset Generation ==============

  private async handleTileset(
    req: TilesetRequest,
    assetPack: AssetPack,
    assetsDir: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new Error('Aborted');

    // Force 3x3 strategy, ignore any tileset_size=7 that might be passed in
    // But we need to remember tile_size (default 64)
    const TILE_SIZE = req.tile_size || 64;

    // Final output size fixed at 7x7 (448px)
    const OUTPUT_GRID = 7;

    console.log(
      `[GenerateAssets] Generating tileset: ${req.key} using 9-Slice (3x3 -> 7x7) Strategy`,
    );

    // 1. Build Prompt: Request a perfect 3x3 core grid
    // IMPORTANT: Emphasize the theme/material from req.description
    const prompt = `
      3x3 Seamless Tileset (9 tiles total), ${this.params.style_anchor}.
      
THEME: ${req.description}. Use THIS EXACT material/theme for ALL tiles.

#1 SEAMLESS: All 9 tiles MUST touch directly. ZERO gaps. ZERO padding. ZERO spacing.
#2 FULL COVERAGE: Fill ENTIRE 1024x1024 canvas. NO margins. NO white space. NO empty areas.
#3 THEME CONSISTENCY: ALL 9 tiles must match the theme "${req.description}".

LAYOUT - exactly 3 rows × 3 columns:
Row 1: [TL corner][Top edge][TR corner]
Row 2: [Left edge][Center][Right edge]  
Row 3: [BL corner][Bottom edge][BR corner]

GRID CONTENTS (Row by Row):
- Top Row (1,2,3): Surface layer / Top Edges.
- Middle Row (4,5,6): Main Body / Center Fill. MUST BE TILEABLE.
- Bottom Row (7,8,9): Bottom Edges / Hanging base.

STYLE: Flat 2D front view. ${this.params.style_anchor}. Consistent lighting. 

---FORBIDDEN---
text, labels, numbers, letters, watermarks,
grid lines, borders, frames, padding, margins, gaps,
isometric, 3D, perspective, vignette, dark corners.
    `;

    // 2. Generate raw image (1024x1024)
    console.log(`[GenerateAssets] Step 1: Generating 3x3 source atlas...`);
    const imageUrl = await this.modelRouter.generateImage(prompt, '1024*1024');
    const rawBuffer = await this.downloadImage(imageUrl);

    // 3. Call Processor for intelligent expansion
    console.log(`[GenerateAssets] Step 2: Expanding to 7x7 Blobset...`);
    const isPixelArt = (this.params.style_anchor || '')
      .toLowerCase()
      .includes('pixel');

    const finalBuffer = await this.tilesetProcessor.expand3x3To7x7(
      rawBuffer,
      TILE_SIZE,
      isPixelArt,
    );

    // 4. Save
    const cdnUrl = await this.saveAsset(finalBuffer, req.key, assetsDir, 'png');

    // 5. Update Asset Pack
    // Note: We still mark it as "tileset" in JSON, but Phaser will load it as 7x7
    this.updateAssetPack(assetPack, req.key, 'tileset', cdnUrl);

    console.log(
      `[GenerateAssets] Tileset saved: ${req.key}.png (${OUTPUT_GRID}x${OUTPUT_GRID} grid, ${TILE_SIZE}px tiles)`,
    );
  }

  // ============== Helper Methods ==============

  private async loadAssetPack(packPath: string): Promise<AssetPack> {
    try {
      const data = await fs.readFile(packPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  private async downloadImage(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async saveAsset(
    buffer: Buffer,
    key: string,
    assetsDir: string,
    extension: string = 'png',
    normalization?: ImageNormalization,
  ): Promise<string> {
    if (normalization)
      buffer = await normalizeImageBuffer(buffer, normalization);
    const filename = `${key}.${extension}`;
    const filePath = path.join(assetsDir, filename);
    await fs.writeFile(filePath, buffer);
    return `assets/${filename}`;
  }

  private getSectionName(assetType: string, key: string): string {
    switch (assetType) {
      case 'background':
        return 'backgrounds';
      case 'animation': {
        const entityName = key.split('_')[0];
        return `${entityName}_animations`;
      }
      case 'audio':
        return 'audio';
      case 'video': {
        const videoEntityName = key.split('_')[0];
        return `${videoEntityName}_videos`;
      }
      case 'tileset':
        return 'tilesets';
      case 'image':
      default:
        return 'images';
    }
  }

  private updateAssetPack(
    pack: AssetPack,
    key: string,
    assetType: string,
    url: string,
  ): void {
    const section = this.getSectionName(assetType, key);

    if (!pack[section]) {
      pack[section] = { files: [] };
    }

    const list = pack[section].files;
    const existing = list.find((f) => f.key === key);

    // Determine file type for asset pack (Phaser compatible)
    let fileType: 'image' | 'audio' | 'video' | 'tileset' = 'image';
    if (assetType === 'audio') {
      fileType = 'audio';
    } else if (assetType === 'video') {
      fileType = 'video';
    } else if (assetType === 'tileset') {
      fileType = 'image'; // Phaser loads tilesets as images
    }

    if (existing) {
      existing.url = url;
    } else {
      list.push({ type: fileType, key, url });
    }
  }
}

// ============== Tool Class ==============

export class GenerateAssetsTool extends BaseDeclarativeTool<
  GenerateAssetsParams,
  ToolResult
> {
  static readonly Name: string = ToolNames.GENERATE_ASSETS;

  constructor(private config: Config) {
    super(
      ToolNames.GENERATE_ASSETS,
      ToolDisplayNames.GENERATE_ASSETS,
      `Generates game assets (images, animations, audio) using AI models.
       Provider (Tongyi / Doubao / any OpenAI-compatible API) and model names
       are configured per-modality via env vars or ~/.qwen/settings.json
       (see docs/users/configuration/api-keys.md). Features auto background
       removal, I2V animation generation, and ABC-based music generation.`,
      Kind.Fetch,
      {
        type: 'object',
        properties: {
          style_anchor: {
            type: 'string',
            description:
              'Global visual style (e.g., "16-bit pixel art, vibrant colors")',
          },
          composition_env: {
            type: 'string',
            description:
              'Composition hints (e.g., "white background, centered, same size, no offset")',
          },
          output_dir_name: {
            type: 'string',
            description: 'Output directory (default: "public/assets")',
          },
          model_type: {
            type: 'string',
            enum: ['tongyi', 'doubao', 'openai-compat'],
            description:
              'Optional hint for the asset-generation provider family. ' +
              'Most users should configure providers via env vars or settings.json instead — ' +
              'see docs/users/configuration/api-keys.md.',
          },
          assets: {
            type: 'array',
            description: 'List of assets to generate',
            items: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    type: { const: 'background' },
                    key: { type: 'string' },
                    description: { type: 'string' },
                    resolution: {
                      type: 'string',
                      enum: ['1024*1024', '1536*1024', '2048*2048'],
                    },
                  },
                  required: ['type', 'key', 'description'],
                },
                {
                  type: 'object',
                  properties: {
                    type: { const: 'image' },
                    key: { type: 'string' },
                    description: { type: 'string' },
                    size: { type: 'string' },
                  },
                  required: ['type', 'key', 'description'],
                },
                {
                  type: 'object',
                  properties: {
                    type: { const: 'animation' },
                    key: { type: 'string' },
                    description: { type: 'string' },
                    useI2V: {
                      type: 'boolean',
                      description: 'Use I2V for animation (faster, smoother)',
                    },
                    animations: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          frameCount: { type: 'number' },
                          action_desc: { type: 'string' },
                        },
                        required: ['name', 'frameCount', 'action_desc'],
                      },
                    },
                  },
                  required: ['type', 'key', 'description', 'animations'],
                },
                {
                  type: 'object',
                  properties: {
                    type: { const: 'audio' },
                    key: { type: 'string' },
                    description: { type: 'string' },
                    audioType: { type: 'string', enum: ['bgm', 'sfx'] },
                    duration: { type: 'number' },
                    genre: { type: 'string' },
                    tempo: { type: 'string', enum: ['slow', 'medium', 'fast'] },
                  },
                  required: ['type', 'key', 'description', 'audioType'],
                },
                {
                  type: 'object',
                  properties: {
                    type: { const: 'tileset' },
                    key: { type: 'string' },
                    description: {
                      type: 'string',
                      description:
                        'Tileset theme/style (e.g., "jungle terrain", "dungeon walls")',
                    },
                    tileset_size: {
                      type: 'number',
                      description: 'Grid size (default 7 = 7x7 = 49 tiles)',
                    },
                    tile_size: {
                      type: 'number',
                      description: 'Pixel size per tile (default 64)',
                    },
                  },
                  required: ['type', 'key', 'description'],
                },
              ],
            },
          },
        },
        required: ['style_anchor', 'assets'],
      },
      false,
      true,
    );
  }

  protected createInvocation(
    params: GenerateAssetsParams,
  ): ToolInvocation<GenerateAssetsParams, ToolResult> {
    return new GenerateAssetsInvocation(this.config, params);
  }
}
