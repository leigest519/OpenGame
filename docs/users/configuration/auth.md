# Authentication

OpenGame supports two authentication methods. Pick the one that matches how you want to run the CLI:

- **Qwen OAuth (recommended)**: sign in with your `qwen.ai` account in a browser.
- **OpenAI-compatible API**: use an API key (OpenAI or any OpenAI-compatible provider / endpoint).

## Option 1: Qwen OAuth (recommended & free) 👍

Use this if you want the simplest setup and you’re using Qwen models.

- **How it works**: on first start, OpenGame opens a browser login page. After you finish, credentials are cached locally so you usually won’t need to log in again.
- **Requirements**: a `qwen.ai` account + internet access (at least for the first login).
- **Benefits**: no API key management, automatic credential refresh.
- **Cost & quota**: free, with a quota of **60 requests/minute** and **2,000 requests/day**.

Start the CLI and follow the browser flow:

```bash
opengame
```

## Option 2: OpenAI-compatible API (API key)

Use this if you want to use OpenAI models or any provider that exposes an OpenAI-compatible API (e.g. OpenAI, Azure OpenAI, OpenRouter, ModelScope, Alibaba Cloud Bailian, or a self-hosted compatible endpoint).

### Quick start (interactive, recommended for local use)

When you choose the OpenAI-compatible option in the CLI, it will prompt you for:

- **API key**
- **Base URL** (default: `https://api.openai.com/v1`)
- **Model** (default: `gpt-4o`)

> **Note:** the CLI may display the key in plain text for verification. Make sure your terminal is not being recorded or shared.

### Configure via command-line arguments

```bash
# API key only
qwen-code --openai-api-key "your-api-key-here"

# Custom base URL (OpenAI-compatible endpoint)
qwen-code --openai-api-key "your-api-key-here" --openai-base-url "https://your-endpoint.com/v1"

# Custom model
qwen-code --openai-api-key "your-api-key-here" --model "gpt-4o-mini"
```

### Configure via environment variables

You can set these in your shell profile, CI, or an `.env` file:

```bash
export OPENAI_API_KEY="your-api-key-here"
export OPENAI_BASE_URL="https://api.openai.com/v1"  # optional
export OPENAI_MODEL="gpt-4o"                        # optional
```

EvoLink exposes an OpenAI-compatible language API as well:

```bash
export OPENAI_API_KEY="your-evolink-api-key"
export OPENAI_BASE_URL="https://direct.evolink.ai/v1"
export OPENAI_MODEL="gpt-5.2"
```

#### Persisting env vars with `.env` / `.qwen/.env`

OpenGame will auto-load environment variables from the **first** `.env` file it finds (variables are **not merged** across multiple files).

Search order:

1. From the **current directory**, walking upward toward `/`:
   1. `.qwen/.env`
   2. `.env`
2. If nothing is found, it falls back to your **home directory**:
   - `~/.qwen/.env`
   - `~/.env`

`.qwen/.env` is recommended to keep OpenGame variables isolated from other tools. Some variables (like `DEBUG` and `DEBUG_MODE`) are excluded from project `.env` files to avoid interfering with qwen-code behavior.

Examples:

```bash
# Project-specific settings (recommended)
mkdir -p .qwen
cat >> .qwen/.env <<'EOF'
OPENAI_API_KEY="your-api-key"
OPENAI_BASE_URL="https://api-inference.modelscope.cn/v1"
OPENAI_MODEL="Qwen/Qwen3-Coder-480B-A35B-Instruct"
EOF
```

```bash
# User-wide settings (available everywhere)
mkdir -p ~/.qwen
cat >> ~/.qwen/.env <<'EOF'
OPENAI_API_KEY="your-api-key"
OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
OPENAI_MODEL="qwen3-coder-plus"
EOF
```

## Switch authentication method (without restarting)

In the OpenGame UI, run:

```bash
/auth
```

## Non-interactive / headless environments (CI, SSH, containers)

In a non-interactive terminal you typically **cannot** complete the OAuth browser login flow.
Use the OpenAI-compatible API method via environment variables:

- Set at least `OPENAI_API_KEY`.
- Optionally set `OPENAI_BASE_URL` and `OPENAI_MODEL`.

If none of these are set in a non-interactive session, OpenGame will exit with an error.

## Security notes

- Don’t commit API keys to version control.
- Prefer `.qwen/.env` for project-local secrets (and keep it out of git).
- Treat your terminal output as sensitive if it prints credentials for verification.
