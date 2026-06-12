# API Keys & Provider Configuration

OpenGame is an agentic framework — it talks to several external generative-AI
APIs to actually build a game. **OpenGame does not ship with any default
credentials.** You have to supply your own keys for each capability you want
to use.

There are four configurable modalities, each with an independent provider:

| Modality    | Used by                                                              | Required?                                                                  |
| ----------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `reasoning` | `classify-game-type`, `generate-gdd`, audio ABC-notation generation. | Required for non-trivial games.                                            |
| `image`     | Backgrounds, sprites, animation base frames, tilesets.               | Required for any asset generation.                                         |
| `video`     | Image-to-video (animation frames) and text-to-video (audio source).  | Optional — without it, animations fall back to I2I and audio to ABC/local. |
| `audio`     | LLM that writes ABC music notation (rendered locally to WAV).        | Optional — without it, audio falls back to procedural placeholders.        |

The main agent LLM (the brain that drives the conversation loop) is _not_
part of this system; it uses the upstream qwen-code OpenAI-compatible flow.
Configure it via `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`, or
the interactive `/auth` command.

---

## Supported provider families

| Provider name   | Description                                                                                                           | Modalities supported           |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `tongyi`        | Aliyun DashScope (Wan/Qwen family).                                                                                   | reasoning, image, video, audio |
| `doubao`        | Volcengine ARK (Doubao Seedream/Seedance family).                                                                     | reasoning, image, video, audio |
| `openai-compat` | Any endpoint speaking the OpenAI REST shape (OpenAI, Atlas Cloud, OpenRouter, Together, fal, Stability proxies, ...). | reasoning, image, audio        |

> **Note.** `openai-compat` is intentionally **not** wired up for video,
> because there is no stable OpenAI-shaped public video API today
> (Sora and Veo are not part of that surface). If you select it for
> `OPENGAME_VIDEO_PROVIDER` you'll get a clear error.

> **One backend for every modality.**
> [Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=opengame)
> is an OpenAI-compatible aggregator (`https://api.atlascloud.ai/v1`) that fronts
> 300+ models — Claude, GPT, Qwen-Coder, DeepSeek, GLM, Kimi for `reasoning`/`audio`,
> plus OpenAI-shaped image routes for `image`. Use it through `openai-compat` when you
> want a single key behind several modalities instead of mixing vendors. The full
> catalog is on the [model list page](https://www.atlascloud.ai/zh/models/list/llm);
> budget-friendly access is on the [coding plan](https://www.atlascloud.ai/console/coding-plan).

---

## Configuring with environment variables (recommended)

Each modality reads four environment variables:

```bash
OPENGAME_<MODALITY>_PROVIDER   # tongyi | doubao | openai-compat
OPENGAME_<MODALITY>_API_KEY    # Bearer token sent to the provider
OPENGAME_<MODALITY>_BASE_URL   # required for openai-compat; optional override otherwise
OPENGAME_<MODALITY>_MODEL      # required for openai-compat; optional override otherwise
```

Where `<MODALITY>` is one of `REASONING`, `IMAGE`, `VIDEO`, `AUDIO`.

### Example: everything on Aliyun DashScope

```bash
export OPENGAME_REASONING_PROVIDER=tongyi
export OPENGAME_REASONING_API_KEY=sk-aliyun-key
export OPENGAME_REASONING_MODEL=deepseek-v3.2

export OPENGAME_IMAGE_PROVIDER=tongyi
export OPENGAME_IMAGE_API_KEY=sk-aliyun-key
export OPENGAME_IMAGE_MODEL=wan2.5-t2i-preview

export OPENGAME_VIDEO_PROVIDER=tongyi
export OPENGAME_VIDEO_API_KEY=sk-aliyun-key
export OPENGAME_VIDEO_MODEL=wan2.5-i2v-preview

export OPENGAME_AUDIO_PROVIDER=tongyi
export OPENGAME_AUDIO_API_KEY=sk-aliyun-key
export OPENGAME_AUDIO_MODEL=qwen-plus
```

### Example: mix-and-match (OpenAI for reasoning, Doubao for image+video)

```bash
export OPENGAME_REASONING_PROVIDER=openai-compat
export OPENGAME_REASONING_API_KEY=sk-openai-key
export OPENGAME_REASONING_BASE_URL=https://api.openai.com/v1
export OPENGAME_REASONING_MODEL=gpt-4o-mini

export OPENGAME_IMAGE_PROVIDER=doubao
export OPENGAME_IMAGE_API_KEY=volc-key
export OPENGAME_IMAGE_MODEL=doubao-seedream-4-0-250828

export OPENGAME_VIDEO_PROVIDER=doubao
export OPENGAME_VIDEO_API_KEY=volc-key
export OPENGAME_VIDEO_MODEL=doubao-seedance-1-0-pro-250528

# Reuse OpenAI for ABC generation
export OPENGAME_AUDIO_PROVIDER=openai-compat
export OPENGAME_AUDIO_API_KEY=sk-openai-key
export OPENGAME_AUDIO_BASE_URL=https://api.openai.com/v1
export OPENGAME_AUDIO_MODEL=gpt-4o-mini
```

### Example: an OpenAI-compatible image proxy (e.g. fal.ai)

```bash
export OPENGAME_IMAGE_PROVIDER=openai-compat
export OPENGAME_IMAGE_API_KEY=$FAL_KEY
export OPENGAME_IMAGE_BASE_URL=https://fal.run/openai/v1
export OPENGAME_IMAGE_MODEL=fal-ai/flux/dev
```

### Example: Atlas Cloud as a single openai-compat backend

[Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=opengame)
speaks the OpenAI shape at `https://api.atlascloud.ai/v1`, so one key can drive
the reasoning, audio, and image modalities (video still needs `tongyi`/`doubao`):

```bash
# reasoning: GDD / classifier / ABC-notation brain
export OPENGAME_REASONING_PROVIDER=openai-compat
export OPENGAME_REASONING_API_KEY=$ATLASCLOUD_API_KEY
export OPENGAME_REASONING_BASE_URL=https://api.atlascloud.ai/v1
export OPENGAME_REASONING_MODEL=deepseek-ai/deepseek-v4-pro   # reasoning model, give it max_tokens >= 512; or Qwen/Qwen3-Coder, anthropic/claude-sonnet-4.6

# audio: reuse the same backend for ABC music notation
export OPENGAME_AUDIO_PROVIDER=openai-compat
export OPENGAME_AUDIO_API_KEY=$ATLASCLOUD_API_KEY
export OPENGAME_AUDIO_BASE_URL=https://api.atlascloud.ai/v1
export OPENGAME_AUDIO_MODEL=deepseek-ai/deepseek-v4-pro

# image: OpenAI-shaped text-to-image route
export OPENGAME_IMAGE_PROVIDER=openai-compat
export OPENGAME_IMAGE_API_KEY=$ATLASCLOUD_API_KEY
export OPENGAME_IMAGE_BASE_URL=https://api.atlascloud.ai/v1
export OPENGAME_IMAGE_MODEL=openai/gpt-image-2/text-to-image
```

Browse the full model catalog and per-model details on the
[model list page](https://www.atlascloud.ai/zh/models/list/llm).

A copy-paste template for all variables lives at the repository root in
[`.env.example`](../../../.env.example).

---

## Configuring via `~/.qwen/settings.json`

The same fields can be persisted to your settings file. Environment variables
take precedence, so settings.json is the right place for "default" choices
that you can override on a per-shell basis.

```json
{
  "openGame": {
    "providers": {
      "reasoning": {
        "provider": "openai-compat",
        "apiKey": "sk-openai-key",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-4o-mini"
      },
      "image": {
        "provider": "tongyi",
        "apiKey": "sk-aliyun-key",
        "model": "wan2.5-t2i-preview"
      },
      "video": {
        "provider": "doubao",
        "apiKey": "volc-key",
        "model": "doubao-seedance-1-0-pro-250528"
      },
      "audio": {
        "provider": "openai-compat",
        "apiKey": "sk-openai-key",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-4o-mini"
      }
    }
  }
}
```

When both an env var and a settings.json field are set for the same modality,
the env var wins.

---

## Resolution rules in detail

For each modality, OpenGame walks this list and uses the first non-empty value
it finds:

1. **`OPENGAME_<MOD>_PROVIDER`** env var.
2. `openGame.providers.<mod>.provider` from settings.json.
3. If a _legacy_ DashScope-style key is set (`DASHSCOPE_API_KEY`,
   `IMAGE_MODEL_API_KEY`, `REASONING_MODEL_API_KEY`, ...), the provider is
   inferred to be `tongyi` so existing demos keep working.
4. Otherwise, OpenGame raises `MissingProviderConfigError` with a message
   that names the exact env var or settings field you should set.

The same precedence chain applies independently to `_API_KEY`, `_BASE_URL`,
and `_MODEL`.

---

## What if I haven't configured anything?

The CLI will start fine and the agent will respond as usual. You'll only see
an error when the agent actually invokes one of the asset / GDD / classifier
tools. The error is human-readable and tells you exactly which env var or
settings field to set, e.g.:

```
OpenGame is missing API configuration for the "image" modality.

Set OPENGAME_IMAGE_PROVIDER to one of "tongyi", "doubao", or "openai-compat",
or add an "openGame.providers.image.provider" entry to your settings.json.

See docs/users/configuration/api-keys.md for the full list of supported variables.
```

---

## Legacy environment variables

For backward compatibility with pre-OpenGame setups, the following older
variables are still read as fallbacks. New configurations should prefer the
`OPENGAME_*` names above.

| Modality    | Legacy fallbacks (in order)                                         |
| ----------- | ------------------------------------------------------------------- |
| `reasoning` | `REASONING_MODEL_API_KEY` → `DASHSCOPE_API_KEY` → `OPENAI_API_KEY`  |
| `image`     | `IMAGE_MODEL_API_KEY` → `DASHSCOPE_API_KEY`                         |
| `video`     | `VIDEO_MODEL_API_KEY` → `IMAGE_MODEL_API_KEY` → `DASHSCOPE_API_KEY` |
| `audio`     | `AUDIO_MODEL_API_KEY` → `IMAGE_MODEL_API_KEY` → `DASHSCOPE_API_KEY` |

These may be removed in a future major version.
