#!/bin/bash
# Doc Maker — First-time setup

echo "🔧 Doc Maker — Setup"
echo ""

# 1. Install dependencies
echo "📦 Installing dependencies..."
npm install --silent

# 2. Create .env if not exists
if [ ! -f .env ]; then
  echo ""
  echo "🔑 AI Provider Setup"
  echo "Choose your AI provider:"
  echo "  1) Anthropic (Claude) — recommended"
  echo "  2) OpenAI (GPT)"
  echo "  3) OpenRouter"
  echo "  4) Skip (configure later in Settings)"
  read -p "Choice [1-4]: " choice

  case $choice in
    1)
      read -p "Enter your Anthropic API key: " key
      echo "ANTHROPIC_API_KEY=$key" > .env
      ;;
    2)
      read -p "Enter your OpenAI API key: " key
      echo "OPENAI_API_KEY=$key" > .env
      ;;
    3)
      read -p "Enter your OpenRouter API key: " key
      echo "OPENROUTER_API_KEY=$key" > .env
      ;;
    4)
      echo "# Configure in Settings panel" > .env
      ;;
    *)
      echo "# Configure in Settings panel" > .env
      ;;
  esac
  echo "✅ .env created"
else
  echo "✅ .env already exists"
fi

# 3. Create data directories
mkdir -p data output knowledge

# 4. Initialize clause DB from sample if needed
if [ ! -f knowledge/clauses-db.json ] && [ -f knowledge/clauses-db.sample.json ]; then
  cp knowledge/clauses-db.sample.json knowledge/clauses-db.json
  echo "✅ Clause database initialized from sample (12 clauses)"
  echo "   Scan your own contracts to grow your knowledge base!"
fi

# 5. Build skills pipeline
echo "🔨 Building skills pipeline..."
npm run build:skills 2>/dev/null || true

echo ""
echo "✅ Setup complete!"
echo ""
echo "Start the app:"
echo "  npm start"
echo ""
echo "Then open http://localhost:6831 in your browser"
