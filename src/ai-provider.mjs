import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', 'data');

/**
 * Get the current AI provider configuration.
 * Priority: user-profile.json fields > Claude Code OAuth fallback
 */
export function getProviderConfig() {
  // 1. Try user-profile.json
  let profile = {};
  try {
    profile = JSON.parse(readFileSync(join(DATA_DIR, 'user-profile.json'), 'utf-8'));
  } catch { /* no profile yet */ }

  const provider = profile.aiProvider || 'anthropic';
  const model = profile.aiModel || 'claude-sonnet-4-6';
  // Priority: env var > profile setting
  const apiKey = process.env.ANTHROPIC_API_KEY || profile.aiApiKey || '';
  const useClaudeOAuth = profile.useClaudeOAuth !== undefined ? profile.useClaudeOAuth : !apiKey;

  // 2. If API key is provided (env or settings), use it directly (skip OAuth)
  if (apiKey) {
    return { provider, model, apiKey, accessToken: null, useClaudeOAuth: false, configured: true };
  }

  // 3. If anthropic + no API key, try Claude Code OAuth
  if (provider === 'anthropic') {
    try {
      const credPath = join(homedir(), '.claude', '.credentials.json');
      const raw = readFileSync(credPath, 'utf-8');
      const data = JSON.parse(raw);
      const oauth = data?.claudeAiOauth;
      if (oauth?.accessToken) {
        return {
          provider: 'anthropic',
          model,
          apiKey: null,
          accessToken: oauth.accessToken,
          useClaudeOAuth: true,
          configured: true,
        };
      }
    } catch { /* no Claude Code credentials */ }
  }

  // 3. Regular API key config
  const configured = !!apiKey;
  return { provider, model, apiKey, accessToken: null, useClaudeOAuth: false, configured };
}

/**
 * Build headers for the configured provider
 */
function buildHeaders(config) {
  if (config.provider === 'anthropic') {
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (config.useClaudeOAuth && config.accessToken) {
      headers['Authorization'] = `Bearer ${config.accessToken}`;
      headers['anthropic-beta'] = 'oauth-2025-04-20,claude-code-20250219';
    } else {
      headers['x-api-key'] = config.apiKey;
    }
    return headers;
  }

  if (config.provider === 'openai') {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    };
  }

  if (config.provider === 'openrouter') {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'HTTP-Referer': 'https://github.com/user/office-work',
      'X-Title': 'Office Work Document Generator',
    };
  }

  throw new Error(`Unknown provider: ${config.provider}`);
}

/**
 * Get the API endpoint URL for the configured provider
 */
function getEndpoint(config) {
  if (config.provider === 'anthropic') {
    // OAuth tokens require ?beta=true query param
    return config.useClaudeOAuth
      ? 'https://api.anthropic.com/v1/messages?beta=true'
      : 'https://api.anthropic.com/v1/messages';
  }
  if (config.provider === 'openai') return 'https://api.openai.com/v1/chat/completions';
  if (config.provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
  throw new Error(`Unknown provider: ${config.provider}`);
}

/**
 * Build the request body in the provider's format
 */
function buildBody(config, { system, messages, maxTokens, stream = false }) {
  if (config.provider === 'anthropic') {
    return {
      model: config.model,
      max_tokens: maxTokens || 4096,
      system,
      messages,
      stream,
    };
  }

  // OpenAI / OpenRouter format
  const openaiMessages = [];
  if (system) {
    openaiMessages.push({ role: 'system', content: system });
  }
  for (const msg of messages) {
    openaiMessages.push({ role: msg.role, content: msg.content });
  }

  return {
    model: config.model,
    max_tokens: maxTokens || 4096,
    messages: openaiMessages,
    stream,
  };
}

/**
 * Extract text from a non-streaming response
 */
function extractText(config, data) {
  if (config.provider === 'anthropic') {
    return data?.content?.[0]?.text || '';
  }
  // OpenAI / OpenRouter
  return data?.choices?.[0]?.message?.content || '';
}

/**
 * Extract usage info from response
 */
function extractUsage(config, data) {
  if (config.provider === 'anthropic') {
    return {
      inputTokens: data?.usage?.input_tokens || 0,
      outputTokens: data?.usage?.output_tokens || 0,
    };
  }
  return {
    inputTokens: data?.usage?.prompt_tokens || 0,
    outputTokens: data?.usage?.completion_tokens || 0,
  };
}

/**
 * Non-streaming chat completion
 */
export async function chatCompletion({ system, messages, maxTokens, signal } = {}) {
  const config = getProviderConfig();
  if (!config.configured) {
    throw new Error('AI provider not configured. Please set up your AI provider in Settings.');
  }

  const reqHeaders = buildHeaders(config);
  const reqBody = buildBody(config, { system, messages, maxTokens });
  console.log('[chatCompletion] endpoint:', getEndpoint(config));
  console.log('[chatCompletion] headers:', JSON.stringify(Object.fromEntries(Object.entries(reqHeaders).map(([k,v]) => [k, k.toLowerCase().includes('auth') ? v.slice(0,20)+'...' : v]))));
  console.log('[chatCompletion] body model:', reqBody.model, 'max_tokens:', reqBody.max_tokens, 'messages:', reqBody.messages?.length, 'system length:', reqBody.system?.length || 0);

  const response = await fetch(getEndpoint(config), {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(reqBody),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`AI API error (${config.provider} / ${config.model}):`, response.status, errorBody);
    throw new Error(`AI API error ${response.status}: ${errorBody.slice(0, 200)}`);
  }

  const data = await response.json();
  return {
    text: extractText(config, data),
    usage: extractUsage(config, data),
  };
}

/**
 * Streaming chat completion — returns the raw Response for SSE forwarding
 * The caller is responsible for parsing the stream based on provider format.
 */
export async function chatCompletionStream({ system, messages, maxTokens } = {}) {
  const config = getProviderConfig();
  if (!config.configured) {
    throw new Error('AI provider not configured. Please set up your AI provider in Settings.');
  }

  const reqHeaders = buildHeaders(config);
  const reqBody = buildBody(config, { system, messages, maxTokens, stream: true });
  console.log('[chatCompletionStream] model:', reqBody.model, 'stream:', reqBody.stream, 'messages:', reqBody.messages?.length, 'system length:', reqBody.system?.length || 0);

  const response = await fetch(getEndpoint(config), {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(reqBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`AI API stream error (${config.provider} / ${config.model}):`, response.status, errorBody);
    throw new Error(`AI API error ${response.status}: ${errorBody.slice(0, 200)}`);
  }

  return { response, provider: config.provider };
}

/**
 * Parse an SSE stream and yield text chunks.
 * Handles both Anthropic and OpenAI/OpenRouter stream formats.
 */
export async function* parseSSEStream(response, provider) {
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
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);

        if (provider === 'anthropic') {
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            yield { type: 'text', text: parsed.delta.text };
          } else if (parsed.type === 'message_stop') {
            return;
          } else if (parsed.type === 'error') {
            yield { type: 'error', error: parsed.error?.message || 'Unknown error' };
            return;
          }
        } else {
          // OpenAI / OpenRouter format
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            yield { type: 'text', text: content };
          }
          if (parsed.choices?.[0]?.finish_reason) {
            return;
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  // Flush remaining buffer
  if (buffer.startsWith('data: ')) {
    const data = buffer.slice(6);
    try {
      const parsed = JSON.parse(data);
      if (provider === 'anthropic') {
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          yield { type: 'text', text: parsed.delta.text };
        }
      } else {
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          yield { type: 'text', text: content };
        }
      }
    } catch { /* ignore */ }
  }
}
