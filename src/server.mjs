import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_SYSTEM_PROMPT = `אתה עוזר ליצירת מסמכים עסקיים בעברית — הצעות מחיר, חוזים והזמנות עבודה.
אתה עובד עם נועם נאומובסקי (Noam Naumovsky Productions).
תמיד ענה בעברית אלא אם התבקשת אחרת.`;

/**
 * Read the Claude Code OAuth credentials from ~/.claude/.credentials.json.
 * Returns { accessToken, expiresAt } or null if not found.
 */
function getClaudeCredentials() {
  try {
    const credPath = join(homedir(), '.claude', '.credentials.json');
    const raw = readFileSync(credPath, 'utf-8');
    const data = JSON.parse(raw);
    const oauth = data?.claudeAiOauth;
    if (oauth?.accessToken) {
      return oauth;
    }
    return null;
  } catch {
    return null;
  }
}

app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

app.post('/api/chat', async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const creds = getClaudeCredentials();
  if (!creds) {
    return res.status(401).json({
      error: 'No Claude Code credentials found. Please log in with the Claude Code CLI first: claude login',
    });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${creds.accessToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: system || DEFAULT_SYSTEM_PROMPT,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Anthropic API error:', response.status, errorBody);
      res.write(`data: ${JSON.stringify({ type: 'error', error: `API error: ${response.status}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              res.write(`data: ${JSON.stringify({ type: 'text', text: parsed.delta.text })}\n\n`);
            } else if (parsed.type === 'message_stop') {
              res.write('data: [DONE]\n\n');
            } else if (parsed.type === 'error') {
              res.write(`data: ${JSON.stringify({ type: 'error', error: parsed.error?.message || 'Unknown error' })}\n\n`);
              res.write('data: [DONE]\n\n');
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    }

    // Flush any remaining buffer
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6);
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          res.write(`data: ${JSON.stringify({ type: 'text', text: parsed.delta.text })}\n\n`);
        }
      } catch {
        // Skip
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Stream error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
  console.log('Using Claude Code OAuth credentials from ~/.claude/.credentials.json');
});
