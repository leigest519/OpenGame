/**
 * Image Generation Service
 * Supports Tongyi and Doubao models
 * Inspired by PiXelDa's model architecture
 */

import { BaseService } from './assetBaseService.js';
import type { ImageModelConfig } from '../tools/generate-assets-types.js';

// ============== Tongyi Image Service ==============

export class TongyiImageService extends BaseService {
  private config: ImageModelConfig;

  constructor(config: ImageModelConfig) {
    super();
    this.config = config;
  }

  private isAsyncModel(modelName: string): boolean {
    return modelName.includes('wan') && modelName.includes('t2i');
  }

  async generateImage(
    prompt: string,
    size: string = '1024*1024',
  ): Promise<string> {
    this.log(`Generating image with Tongyi: ${prompt.substring(0, 50)}...`);

    const modelName = this.config.modelNameGeneration;

    if (this.isAsyncModel(modelName)) {
      return this.generateImageAsync(prompt, size);
    } else {
      return this.generateImageSync(prompt, size);
    }
  }

  private async generateImageAsync(
    prompt: string,
    size: string,
  ): Promise<string> {
    const url = `${this.config.baseUrl}/api/v1/services/aigc/text2image/image-synthesis`;

    const payload = {
      model: this.config.modelNameGeneration,
      input: {
        prompt,
        negative_prompt: '',
      },
      parameters: {
        prompt_extend: false,
        size,
        n: 1,
      },
    };

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${this.config.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Tongyi Image API failed: ${response.status} - ${errorBody}`,
      );
    }

    const taskData = (await response.json()) as {
      output?: { task_id?: string };
    };
    const taskId = taskData.output?.task_id;
    if (!taskId) {
      throw new Error('Tongyi text2image returned no task ID');
    }

    this.log(`Created async task: ${taskId}`);

    const taskUrl = `${this.config.baseUrl}/api/v1/tasks/${taskId}`;
    const result = await this.pollTaskStatus(taskUrl, {
      Authorization: `${this.config.apiKey}`,
    });

    const resultUrl = result.output?.results?.[0]?.url;
    if (!resultUrl) {
      throw new Error('Tongyi text2image task completed but no URL returned');
    }

    this.log(`Image generated successfully`);
    return resultUrl;
  }

  private async generateImageSync(
    prompt: string,
    size: string,
  ): Promise<string> {
    const url = `${this.config.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`;

    const payload = {
      model: this.config.modelNameGeneration,
      input: {
        messages: [
          {
            role: 'user',
            content: [{ text: prompt }],
          },
        ],
      },
      parameters: {
        prompt_extend: false,
        size,
      },
    };

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${this.config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Tongyi Image API failed: ${response.status} - ${errorBody}`,
      );
    }

    const data = (await response.json()) as {
      output?: {
        choices?: Array<{
          message?: { content?: Array<{ image?: string }> | unknown };
        }>;
      };
    };
    const choices = data.output?.choices;
    if (!choices || choices.length === 0) {
      throw new Error('Tongyi returned no choices');
    }

    const content = choices[0].message?.content;
    if (!content || !Array.isArray(content)) {
      throw new Error('Tongyi content format error');
    }

    const imageItem = content.find((item: { image?: string }) => item.image);
    if (!imageItem || !imageItem.image) {
      throw new Error('Tongyi response missing image URL');
    }

    this.log(`Image generated successfully`);
    return imageItem.image;
  }

  private isWanxEditModel(modelName: string): boolean {
    return modelName.includes('wanx') && modelName.includes('imageedit');
  }

  async editImage(
    referenceImageUrl: string,
    prompt: string,
    previousFrameUrl?: string | null,
  ): Promise<string> {
    this.log(`Editing image with Tongyi I2I...`);

    const modelName = this.config.modelNameEditing;

    if (this.isWanxEditModel(modelName)) {
      return this.editImageWanx(referenceImageUrl, prompt);
    } else {
      return this.editImageI2I(referenceImageUrl, prompt, previousFrameUrl);
    }
  }

  private async editImageWanx(
    referenceImageUrl: string,
    prompt: string,
  ): Promise<string> {
    const url = `${this.config.baseUrl}/api/v1/services/aigc/text2image/image-synthesis`;

    // Convert URL to Base64 to avoid "url error" issues with cross-region OSS
    const base64Image = await this.imageUrlToBase64(referenceImageUrl);

    const payload = {
      model: this.config.modelNameEditing,
      input: {
        prompt,
        negative_prompt: '',
        function: 'description_edit',
        base_image_url: base64Image,
      },
      parameters: {
        prompt_extend: false,
        n: 1,
        size: '1024*1024',
      },
    };

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${this.config.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Tongyi wanx edit API failed: ${response.status} - ${errorBody}`,
      );
    }

    const taskData = (await response.json()) as {
      output?: { task_id?: string };
    };
    const taskId = taskData.output?.task_id;
    if (!taskId) {
      throw new Error('Tongyi wanx edit returned no task ID');
    }

    this.log(`Created wanx edit task: ${taskId}`);

    const taskUrl = `${this.config.baseUrl}/api/v1/tasks/${taskId}`;
    const result = await this.pollTaskStatus(taskUrl, {
      Authorization: `${this.config.apiKey}`,
    });

    const resultUrl = result.output?.results?.[0]?.url;
    if (!resultUrl) {
      throw new Error('Tongyi wanx edit task completed but no URL returned');
    }

    this.log(`Image editing completed`);
    return resultUrl;
  }

  private async editImageI2I(
    referenceImageUrl: string,
    prompt: string,
    previousFrameUrl?: string | null,
  ): Promise<string> {
    const url = `${this.config.baseUrl}/api/v1/services/aigc/image2image/image-synthesis`;

    const images = previousFrameUrl
      ? [referenceImageUrl, previousFrameUrl]
      : [referenceImageUrl];

    const payload = {
      model: this.config.modelNameEditing,
      input: {
        prompt,
        images,
      },
      parameters: {
        prompt_extend: false,
        n: 1,
      },
    };

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${this.config.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Tongyi I2I API failed: ${response.status} - ${errorBody}`,
      );
    }

    const taskData = (await response.json()) as {
      output?: { task_id?: string };
    };
    const taskId = taskData.output?.task_id;
    if (!taskId) {
      throw new Error('Tongyi I2I returned no task ID');
    }

    const taskUrl = `${this.config.baseUrl}/api/v1/tasks/${taskId}`;
    const result = await this.pollTaskStatus(taskUrl, {
      Authorization: `${this.config.apiKey}`,
    });

    const resultUrl = result.output?.results?.[0]?.url;
    if (!resultUrl) {
      throw new Error('Tongyi I2I task completed but no URL returned');
    }

    this.log(`Image editing completed`);
    return resultUrl;
  }

  private async imageUrlToBase64(imageUrl: string): Promise<string> {
    this.log(
      `Downloading image for Base64 conversion: ${imageUrl.substring(0, 50)}...`,
    );

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    const contentType = response.headers.get('content-type') || 'image/png';
    return `data:${contentType};base64,${base64}`;
  }
}

// ============== Doubao Image Service ==============

export class DoubaoImageService extends BaseService {
  private config: ImageModelConfig;
  private arkBaseUrl: string;

  constructor(config: ImageModelConfig) {
    super();
    this.config = config;
    // Allow the user to override the Volcengine ARK base URL (e.g. for
    // a regional endpoint or a self-hosted proxy). Falls back to the
    // public Beijing endpoint that ships with the original implementation.
    this.arkBaseUrl =
      config.baseUrl && config.baseUrl.length > 0
        ? config.baseUrl
        : 'https://ark.cn-beijing.volces.com/api/v3';
  }

  async generateImage(
    prompt: string,
    size: string = '1024x1024',
  ): Promise<string> {
    this.log(`Generating image with Doubao: ${prompt.substring(0, 50)}...`);

    const url = `${this.arkBaseUrl}/images/generations`;
    const normalizedSize = size.replace('*', 'x');

    const payload = {
      model: this.config.modelNameGeneration,
      prompt,
      size: normalizedSize,
      watermark: false,
    };

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Doubao Image API failed: ${response.status} - ${errorBody}`,
      );
    }

    const data = (await response.json()) as {
      data?: Array<{ url?: string }>;
    };

    if (!data.data || data.data.length === 0) {
      throw new Error('Doubao returned no results');
    }

    const resultUrl = data.data[0].url;
    if (!resultUrl) {
      throw new Error('Doubao returned a result without a URL');
    }
    this.log(`Image generated successfully`);
    return resultUrl;
  }

  async editImage(
    imageUrl: string,
    prompt: string,
    _previousFrameUrl?: string | null,
  ): Promise<string> {
    this.log(`Editing image with Doubao...`);

    const url = `${this.arkBaseUrl}/images/edits`;

    const payload = {
      model: this.config.modelNameEditing || this.config.modelNameGeneration,
      prompt,
      image: imageUrl,
      size: '1024x1024',
      watermark: false,
    };

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Doubao Edit API failed: ${response.status} - ${errorBody}`,
      );
    }

    const data = (await response.json()) as {
      data?: Array<{ url?: string }>;
    };

    if (!data.data || data.data.length === 0) {
      throw new Error('Doubao edit returned no results');
    }

    const resultUrl = data.data[0].url;
    if (!resultUrl) {
      throw new Error('Doubao edit returned a result without a URL');
    }
    this.log(`Image editing completed`);
    return resultUrl;
  }
}

// ============== OpenAI-Compatible Image Service ==============
//
// Talks to any endpoint that implements the OpenAI Images REST shape:
//   POST {baseUrl}/images/generations  { model, prompt, size, n }
//   POST {baseUrl}/images/edits        (multipart) { model, prompt, image }
//
// This covers the official OpenAI API (DALL-E / gpt-image-1), Stability
// proxies, fal.ai's OpenAI shim, OpenRouter image routes, Together.ai's
// image endpoints, etc. Sizes are passed through as-is (callers should
// use that provider's native vocabulary, e.g. "1024x1024").

export class OpenAICompatImageService extends BaseService {
  private config: ImageModelConfig;

  constructor(config: ImageModelConfig) {
    super();
    this.config = config;
  }

  async generateImage(
    prompt: string,
    size: string = '1024x1024',
  ): Promise<string> {
    this.log(
      `Generating image via OpenAI-compat: ${prompt.substring(0, 50)}...`,
    );

    const url = `${this.config.baseUrl}/images/generations`;
    const normalizedSize = size.replace('*', 'x');

    const payload = {
      model: this.config.modelNameGeneration,
      prompt,
      size: normalizedSize,
      n: 1,
      response_format: 'url',
    };

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenAI-compat image API failed: ${response.status} - ${errorBody}`,
      );
    }

    const data = (await response.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };
    const item = data.data?.[0];
    if (!item) {
      throw new Error('OpenAI-compat image API returned no results');
    }

    if (item.url) {
      return item.url;
    }
    if (item.b64_json) {
      // Surface base64 results as a data URL so downstream code can consume
      // them with the same `fetch(url)` it uses for hosted images.
      return `data:image/png;base64,${item.b64_json}`;
    }

    throw new Error(
      'OpenAI-compat image API returned neither url nor b64_json',
    );
  }

  async editImage(
    referenceImageUrl: string,
    prompt: string,
    _previousFrameUrl?: string | null,
  ): Promise<string> {
    // The OpenAI image-edit endpoint only takes a single reference image
    // and uses multipart/form-data, which adds non-trivial complexity.
    // For now we fall back to a fresh generation that includes the prompt
    // — most callers (e.g. animation frames) only need style consistency
    // via the prompt rather than a true image-conditioned edit. Users who
    // need real I2I should select a Tongyi or Doubao provider for image.
    this.log(
      'OpenAI-compat editImage falls back to plain text-to-image; use tongyi/doubao for true I2I.',
      'warn',
    );
    return this.generateImage(`${prompt} (matching reference style)`);
  }
}

// ============== Image Service Interface ==============

export interface IImageService {
  generateImage(prompt: string, size?: string): Promise<string>;
  editImage(
    referenceImageUrl: string,
    prompt: string,
    previousFrameUrl?: string | null,
  ): Promise<string>;
}

// ============== Factory ==============

export function createImageService(config: ImageModelConfig): IImageService {
  switch (config.modelType) {
    case 'doubao':
      return new DoubaoImageService(config);
    case 'openai-compat':
      return new OpenAICompatImageService(config);
    case 'tongyi':
    default:
      return new TongyiImageService(config);
  }
}
