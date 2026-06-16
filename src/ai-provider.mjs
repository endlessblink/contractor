import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { USER_DATA_DIR, IS_PKG, APP_DIR } from './app-paths.mjs';

const DATA_DIR = IS_PKG ? USER_DATA_DIR : join(APP_DIR, 'data');

// Claude Code CLI fingerprint — required so Claude Max OAuth isn't throttled to
// the "unknown-client" pool (empty-message 429). See global notes on Max OAuth.
const CLAUDE_CLI_VERSION = '1.0.119';
const CLAUDE_CODE_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude.";
const ANTHROPIC_OAUTH_BETA = 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14';

function loadProfile() {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, 'user-profile.json'), 'utf-8'));
  } catch { return {}; }
}

function readClaudeOAuth() {
  try {
    const data = JSON.parse(readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf-8'));
    const o = data?.claudeAiOauth;
    return o?.accessToken ? o : null;
  } catch { return null; }
}

function readCodexOAuth() {
  try {
    const data = JSON.parse(readFileSync(join(homedir(), '.codex', 'auth.json'), 'utf-8'));
    const t = data?.tokens;
    if (t?.access_token) return { accessToken: t.access_token, accountId: t.account_id, apiKey: data.OPENAI_API_KEY || null };
    if (data?.OPENAI_API_KEY) return { accessToken: null, accountId: null, apiKey: data.OPENAI_API_KEY };
    return null;
  } catch { return null; }
}

/**
 * Get the primary AI provider configuration (backward-compatible).
 * Priority: explicit API key (env or profile) > Claude Code OAuth.
 */
export function getProviderConfig() {
  const profile = loadProfile();
  const provider = profile.aiProvider || 'anthropic';
  const model = profile.aiModel || 'claude-sonnet-4-6';

  // Explicit CLI-login primaries — use the local subscription, no API key.
  if (provider === 'claude-cli') {
    const oauth = readClaudeOAuth();
    return oauth
      ? { provider: 'anthropic', model, apiKey: null, accessToken: oauth.accessToken, useClaudeOAuth: true, configured: true }
      : { provider: 'anthropic', model, apiKey: null, accessToken: null, useClaudeOAuth: false, configured: false };
  }
  if (provider === 'codex-cli') {
    const codex = readCodexOAuth();
    const cModel = profile.codexModel || 'gpt-5-codex';
    if (codex?.accessToken) {
      return { provider: 'codex', model: cModel, apiKey: null, accessToken: codex.accessToken, accountId: codex.accountId, useClaudeOAuth: false, configured: true };
    }
    if (codex?.apiKey) {
      return { provider: 'openai', model: profile.codexModel || 'gpt-5', apiKey: codex.apiKey, accessToken: null, useClaudeOAuth: false, configured: true };
    }
    return { provider: 'codex', model: cModel, apiKey: null, accessToken: null, useClaudeOAuth: false, configured: false };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || profile.aiApiKey || '';
  if (apiKey) {
    return { provider, model, apiKey, accessToken: null, useClaudeOAuth: false, configured: true };
  }
  if (provider === 'anthropic') {
    const oauth = readClaudeOAuth();
    if (oauth) {
      return { provider: 'anthropic', model, apiKey: null, accessToken: oauth.accessToken, useClaudeOAuth: true, configured: true };
    }
  }
  return { provider, model, apiKey, accessToken: null, useClaudeOAuth: false, configured: !!apiKey };
}

/**
 * Build the ordered list of attempts: primary, then (if enabled) Claude Max
 * OAuth and Codex/ChatGPT OAuth fallbacks. Each attempt is a self-contained
 * config consumed by the kind-specific request builders below.
 */
export function buildAttempts() {
  const profile = loadProfile();
  const fallbackEnabled = profile.aiFallback !== false; // default ON
  const primary = getProviderConfig();
  const attempts = [];

  // Primary
  if (primary.configured) {
    if (primary.provider === 'anthropic') {
      attempts.push(primary.useClaudeOAuth
        ? { kind: 'anthropic-oauth', model: primary.model, accessToken: primary.accessToken, label: 'Claude (OAuth)' }
        : { kind: 'anthropic-key', model: primary.model, apiKey: primary.apiKey, label: 'Anthropic (API key)' });
    } else if (primary.provider === 'codex') {
      attempts.push({ kind: 'codex-oauth', model: primary.model, accessToken: primary.accessToken, accountId: primary.accountId, label: 'Codex/ChatGPT (CLI)' });
    } else if (primary.provider === 'openrouter') {
      attempts.push({ kind: 'openrouter', model: primary.model, apiKey: primary.apiKey, label: 'OpenRouter' });
    } else { // openai
      attempts.push({ kind: 'openai', model: primary.model, apiKey: primary.apiKey, label: 'OpenAI (API key)' });
    }
  }

  if (!fallbackEnabled) return attempts;
  const has = (kind) => attempts.some(a => a.kind === kind);

  // Fallback 1: Claude Max OAuth (~/.claude/.credentials.json)
  const claude = readClaudeOAuth();
  if (claude && !has('anthropic-oauth')) {
    const model = /claude/i.test(profile.aiModel || '') ? profile.aiModel : 'claude-sonnet-4-6';
    attempts.push({ kind: 'anthropic-oauth', model, accessToken: claude.accessToken, label: 'Claude Max (OAuth fallback)' });
  }

  // Fallback 2: Codex / ChatGPT OAuth (~/.codex/auth.json)
  const codex = readCodexOAuth();
  if (codex) {
    if (codex.accessToken && !has('codex-oauth')) {
      attempts.push({ kind: 'codex-oauth', model: profile.codexModel || 'gpt-5-codex', accessToken: codex.accessToken, accountId: codex.accountId, label: 'Codex/ChatGPT (OAuth fallback)' });
    } else if (codex.apiKey && !has('openai')) {
      attempts.push({ kind: 'openai', model: profile.codexModel || 'gpt-5', apiKey: codex.apiKey, label: 'OpenAI (Codex API key fallback)' });
    }
  }

  return attempts;
}

/** Which parser format parseSSEStream should use for an attempt. */
function parseProviderFor(kind) {
  if (kind === 'codex-oauth') return 'codex';
  if (kind === 'openai' || kind === 'openrouter') return 'openai';
  return 'anthropic';
}

function endpointFor(a) {
  switch (a.kind) {
    case 'anthropic-oauth': return 'https://api.anthropic.com/v1/messages?beta=true';
    case 'anthropic-key': return 'https://api.anthropic.com/v1/messages';
    case 'openai': return 'https://api.openai.com/v1/chat/completions';
    case 'openrouter': return 'https://openrouter.ai/api/v1/chat/completions';
    case 'codex-oauth': return 'https://chatgpt.com/backend-api/codex/responses';
    default: throw new Error(`Unknown attempt kind: ${a.kind}`);
  }
}

function headersFor(a) {
  if (a.kind === 'anthropic-key') {
    return { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': a.apiKey };
  }
  if (a.kind === 'anthropic-oauth') {
    // CLI fingerprint so the Max subscription isn't throttled to the unknown-client pool.
    return {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'Authorization': `Bearer ${a.accessToken}`,
      'anthropic-beta': ANTHROPIC_OAUTH_BETA,
      'anthropic-dangerous-direct-browser-access': 'true',
      'User-Agent': `claude-cli/${CLAUDE_CLI_VERSION} (external, sdk-cli)`,
      'x-app': 'cli',
      'x-stainless-lang': 'js',
      'x-stainless-package-version': '0.60.0',
      'x-stainless-runtime': 'node',
      'x-stainless-os': 'Linux',
      'x-stainless-arch': 'x64',
    };
  }
  if (a.kind === 'openai') {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${a.apiKey}` };
  }
  if (a.kind === 'openrouter') {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${a.apiKey}`, 'HTTP-Referer': 'https://github.com/user/contractor', 'X-Title': 'Contractor Document Generator' };
  }
  if (a.kind === 'codex-oauth') {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${a.accessToken}`,
      'chatgpt-account-id': a.accountId || '',
      'OpenAI-Beta': 'responses=experimental',
      'originator': 'codex_cli_rs',
      'User-Agent': 'codex_cli_rs',
      'session_id': randomUUID(),
    };
  }
  throw new Error(`Unknown attempt kind: ${a.kind}`);
}

function toDataUrl(block) {
  const source = block?.source || {};
  if (source.type === 'base64' && source.data) {
    return `data:${source.media_type || 'image/png'};base64,${source.data}`;
  }
  if (block?.image_url?.url) return block.image_url.url;
  if (typeof block?.url === 'string') return block.url;
  return '';
}

function normalizeChatContentForOpenAI(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  return content.map(block => {
    if (block?.type === 'text') return { type: 'text', text: block.text || '' };
    if (block?.type === 'image') return { type: 'image_url', image_url: { url: toDataUrl(block) } };
    if (block?.type === 'image_url') return block;
    return { type: 'text', text: String(block?.text || '') };
  }).filter(block => block.type !== 'image_url' || block.image_url?.url);
}

function normalizeResponseContent(content, role) {
  if (typeof content === 'string') {
    return [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: content }];
  }
  if (!Array.isArray(content)) {
    return [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: String(content || '') }];
  }
  const textType = role === 'assistant' ? 'output_text' : 'input_text';
  return content.map(block => {
    if (block?.type === 'text') return { type: textType, text: block.text || '' };
    if (block?.type === 'image' || block?.type === 'image_url') return { type: 'input_image', image_url: toDataUrl(block) };
    return { type: textType, text: String(block?.text || '') };
  }).filter(block => block.type !== 'input_image' || block.image_url);
}

function bodyFor(a, { system, messages, maxTokens, stream }) {
  if (a.kind === 'anthropic-key') {
    return { model: a.model, max_tokens: maxTokens || 4096, system, messages, stream };
  }
  if (a.kind === 'anthropic-oauth') {
    // First system block MUST be byte-exact; our prompt goes in a second block.
    const systemBlocks = [{ type: 'text', text: CLAUDE_CODE_SYSTEM }];
    if (system) systemBlocks.push({ type: 'text', text: system });
    return { model: a.model, max_tokens: maxTokens || 4096, system: systemBlocks, messages, stream };
  }
  if (a.kind === 'openai' || a.kind === 'openrouter') {
    const msgs = [];
    if (system) msgs.push({ role: 'system', content: system });
    for (const m of messages) msgs.push({ role: m.role, content: normalizeChatContentForOpenAI(m.content) });
    return { model: a.model, max_tokens: maxTokens || 4096, messages: msgs, stream };
  }
  if (a.kind === 'codex-oauth') {
    // OpenAI Responses API (ChatGPT backend).
    const input = messages.map(m => ({
      type: 'message',
      role: m.role,
      content: normalizeResponseContent(m.content, m.role),
    }));
    return { model: a.model, instructions: system || '', input, stream, store: false };
  }
  throw new Error(`Unknown attempt kind: ${a.kind}`);
}

function extractTextFor(a, data) {
  if (a.kind === 'anthropic-key' || a.kind === 'anthropic-oauth') {
    return data?.content?.[0]?.text || '';
  }
  if (a.kind === 'codex-oauth') {
    const out = data?.output || [];
    let text = '';
    for (const item of out) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) if (c?.type === 'output_text') text += c.text || '';
      }
    }
    return text || data?.output_text || '';
  }
  return data?.choices?.[0]?.message?.content || '';
}

function extractUsageFor(a, data) {
  if (a.kind === 'anthropic-key' || a.kind === 'anthropic-oauth') {
    return { inputTokens: data?.usage?.input_tokens || 0, outputTokens: data?.usage?.output_tokens || 0 };
  }
  if (a.kind === 'codex-oauth') {
    return { inputTokens: data?.usage?.input_tokens || 0, outputTokens: data?.usage?.output_tokens || 0 };
  }
  return { inputTokens: data?.usage?.prompt_tokens || 0, outputTokens: data?.usage?.completion_tokens || 0 };
}

/**
 * Should we fall through to the next provider on this failure?
 * Retryable: auth (401/403), rate limit (429), server errors (5xx), and the
 * out-of-credit/quota 400. NOT genuine bad-request 400s.
 */
function isRetryable(status, body = '') {
  if (status === 401 || status === 403 || status === 429) return true;
  if (status >= 500) return true;
  if (status === 400 && /credit|quota|insufficient|balance|billing/i.test(body)) return true;
  return false;
}

/**
 * Non-streaming chat completion with automatic provider fallback.
 */
export async function chatCompletion({ system, messages, maxTokens, signal } = {}) {
  const attempts = buildAttempts();
  if (attempts.length === 0) {
    throw new Error('AI provider not configured. Please set up your AI provider in Settings.');
  }

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    try {
      const response = await fetch(endpointFor(a), {
        method: 'POST',
        headers: headersFor(a),
        body: JSON.stringify(bodyFor(a, { system, messages, maxTokens, stream: false })),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[chatCompletion] ${a.label} failed: ${response.status} ${errorBody.slice(0, 160)}`);
        if (i < attempts.length - 1 && isRetryable(response.status, errorBody)) {
          console.log(`[chatCompletion] falling back to: ${attempts[i + 1].label}`);
          lastErr = new Error(`AI API error ${response.status}: ${errorBody.slice(0, 200)}`);
          continue;
        }
        throw new Error(`AI API error ${response.status}: ${errorBody.slice(0, 200)}`);
      }
      const data = await response.json();
      if (i > 0) console.log(`[chatCompletion] succeeded via fallback: ${a.label}`);
      return { text: extractTextFor(a, data), usage: extractUsageFor(a, data), providerUsed: a.label };
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      lastErr = err;
      if (i < attempts.length - 1) { console.log(`[chatCompletion] ${a.label} threw, trying next: ${err.message}`); continue; }
    }
  }
  throw lastErr || new Error('All AI providers failed.');
}

/**
 * Streaming chat completion with fallback at connection time. Returns the raw
 * Response plus the parser format for parseSSEStream.
 */
export async function chatCompletionStream({ system, messages, maxTokens } = {}) {
  const attempts = buildAttempts();
  if (attempts.length === 0) {
    throw new Error('AI provider not configured. Please set up your AI provider in Settings.');
  }

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    try {
      const response = await fetch(endpointFor(a), {
        method: 'POST',
        headers: headersFor(a),
        body: JSON.stringify(bodyFor(a, { system, messages, maxTokens, stream: true })),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[chatCompletionStream] ${a.label} failed: ${response.status} ${errorBody.slice(0, 160)}`);
        if (i < attempts.length - 1 && isRetryable(response.status, errorBody)) {
          console.log(`[chatCompletionStream] falling back to: ${attempts[i + 1].label}`);
          lastErr = new Error(`AI API error ${response.status}: ${errorBody.slice(0, 200)}`);
          continue;
        }
        throw new Error(`AI API error ${response.status}: ${errorBody.slice(0, 200)}`);
      }
      if (i > 0) console.log(`[chatCompletionStream] succeeded via fallback: ${a.label}`);
      return { response, provider: parseProviderFor(a.kind), providerUsed: a.label };
    } catch (err) {
      lastErr = err;
      if (i < attempts.length - 1) { console.log(`[chatCompletionStream] ${a.label} threw, trying next: ${err.message}`); continue; }
    }
  }
  throw lastErr || new Error('All AI providers failed.');
}

/**
 * Parse an SSE stream and yield text chunks. Handles Anthropic, OpenAI/
 * OpenRouter, and Codex (OpenAI Responses API) stream formats.
 */
export async function* parseSSEStream(response, provider) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Returns a directive: 'done' | { event, done? } | undefined
  const handle = (data) => {
    if (data === '[DONE]') return 'done';
    let parsed;
    try { parsed = JSON.parse(data); } catch { return undefined; }

    if (provider === 'anthropic') {
      if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
        return { event: { type: 'text', text: parsed.delta.text } };
      }
      if (parsed.type === 'message_stop') return 'done';
      if (parsed.type === 'error') return { event: { type: 'error', error: parsed.error?.message || 'Unknown error' }, done: true };
    } else if (provider === 'codex') {
      if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
        return { event: { type: 'text', text: parsed.delta } };
      }
      if (parsed.type === 'response.completed') return 'done';
      if (parsed.type === 'response.failed' || parsed.type === 'error') {
        return { event: { type: 'error', error: parsed.response?.error?.message || parsed.error?.message || 'Unknown error' }, done: true };
      }
    } else { // openai / openrouter
      const content = parsed.choices?.[0]?.delta?.content;
      if (content) return { event: { type: 'text', text: content } };
      if (parsed.choices?.[0]?.finish_reason) return 'done';
    }
    return undefined;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const out = handle(line.slice(6));
      if (out === 'done') return;
      if (out && out.event) { yield out.event; if (out.done) return; }
    }
  }

  if (buffer.startsWith('data: ')) {
    const out = handle(buffer.slice(6));
    if (out && out.event) yield out.event;
  }
}
