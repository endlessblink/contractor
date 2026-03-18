# Contractor

Self-hosted document generator for quotes, contracts, and work orders. Built for Hebrew RTL with full English support. AI-powered document drafting with multi-provider support.

## Features

- Generate professional DOCX documents (quotes, contracts, work orders)
- Full Hebrew RTL support with proper bidirectional text handling
- AI-assisted document drafting via chat interface
- Multi-provider AI: Anthropic (Claude), OpenAI (GPT), OpenRouter
- Claude Code OAuth support (zero API key needed)
- Reference document analysis — learn clause patterns from existing documents
- Clause database with 110+ Hebrew business/legal clauses
- Project management — organize documents by client/project
- Setup wizard for first-run configuration

## Quick Start

```bash
git clone https://github.com/endlessblink/contractor.git
cd contractor
npm install
npm start
```

Open `http://localhost:6831` in your browser. The setup wizard will guide you through initial configuration.

## AI Provider Setup

Contractor supports three AI providers. Configure in Settings (gear icon).

### Anthropic (Default)

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. Enter it in Settings → AI Provider → API Key
3. Recommended model: `claude-haiku-4-5-20251001`

### Claude Code OAuth (Zero Config)

If you have [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed:

1. Run `claude login` in your terminal
2. In Settings, check "Use Claude Code OAuth"
3. No API key needed

### OpenAI

1. Get an API key from [platform.openai.com](https://platform.openai.com)
2. Select "OpenAI" as provider in Settings
3. Recommended model: `gpt-4o-mini`

### OpenRouter

1. Get an API key from [openrouter.ai](https://openrouter.ai)
2. Select "OpenRouter" as provider in Settings
3. Use any model slug, e.g. `anthropic/claude-3.5-sonnet`

## Project Structure

```
src/
  server.mjs          — Express backend (API + static files)
  generate-quote.mjs  — DOCX document generator
  ai-provider.mjs     — Multi-provider AI abstraction
  data-layer.mjs      — Data access utilities
public/
  index.html           — Single-page frontend
assets/
  logo.png             — Your logo (used in document footer)
  fonts/               — Heebo font files for DOCX
knowledge/
  clauses-db.json      — Hebrew business clause database
data/
  user-profile.json    — Your settings (auto-created on first run)
```

## Configuration

All settings are stored in `data/user-profile.json` and can be edited via the Settings modal in the UI.

| Field | Description |
|-------|-------------|
| name / nameEn | Your name (Hebrew / English) |
| company | Company name |
| title / titleEn | Professional title |
| email, phone, website | Contact details for document footer |
| logoPath | Path to logo file |
| aiProvider | `anthropic`, `openai`, or `openrouter` |
| aiModel | Model identifier |
| aiApiKey | Provider API key |
| useClaudeOAuth | Use Claude Code OAuth instead of API key |

## License

MIT
