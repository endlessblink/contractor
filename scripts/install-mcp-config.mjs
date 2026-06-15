#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_SERVER_PATH = resolve(import.meta.dirname, '..', 'src', 'server.mjs');

function timestampForBackup(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function readJsonConfig(path) {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    const error = new Error(`Invalid JSON in MCP config: ${path}`);
    error.code = 'INVALID_MCP_CONFIG';
    throw error;
  }
}

function writeJsonConfig(path, config, backupSuffix) {
  const existed = existsSync(path);
  const targetPath = existed ? realpathSync(path) : path;
  mkdirSync(dirname(targetPath), { recursive: true });

  if (existed) {
    copyFileSync(targetPath, `${path}.backup-${backupSuffix}`);
  }

  const tempPath = `${targetPath}.tmp-${process.pid}`;
  writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, targetPath);
}

export function mergeMcpServerConfig(config, contractorEntry) {
  const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const existingServers = source.mcpServers
    && typeof source.mcpServers === 'object'
    && !Array.isArray(source.mcpServers)
    ? source.mcpServers
    : {};

  return {
    ...source,
    mcpServers: {
      ...existingServers,
      contractor: contractorEntry,
    },
  };
}

export function detectClaudeConfigPaths({
  homeDir = homedir(),
  platform = process.platform,
  env = process.env,
} = {}) {
  const candidates = [
    join(homeDir, '.claude.json'),
    join(homeDir, '.config', 'Claude', 'claude_desktop_config.json'),
    join(homeDir, '.config', 'claude-desktop', 'mcp.json'),
    join(homeDir, '.config', 'claude', 'mcp.json'),
  ];

  if (platform === 'darwin') {
    candidates.push(join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
  }
  if (platform === 'win32' && env.APPDATA) {
    candidates.push(join(env.APPDATA, 'Claude', 'claude_desktop_config.json'));
  }

  const existing = [...new Set(candidates)].filter(existsSync);
  return existing.length > 0 ? existing : [join(homeDir, '.claude.json')];
}

function defaultRunCommand(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function installMcpConfig({
  homeDir = homedir(),
  serverPath = DEFAULT_SERVER_PATH,
  nodePath = process.execPath,
  executablePath,
  dryRun = false,
  now = new Date(),
  platform = process.platform,
  env = process.env,
  runCommand = defaultRunCommand,
} = {}) {
  const resolvedServerPath = resolve(serverPath);
  const command = executablePath ? resolve(executablePath) : nodePath;
  const commandArgs = executablePath ? ['--mcp'] : [resolvedServerPath, '--mcp'];
  const entry = { command, args: commandArgs };
  const codexArgs = ['mcp', 'add', 'contractor', '--', command, ...commandArgs];
  const backupSuffix = timestampForBackup(now);
  const claudePaths = detectClaudeConfigPaths({ homeDir, platform, env });
  const antigravityPath = join(homeDir, '.gemini', 'antigravity', 'mcp_config.json');
  const report = {
    dryRun,
    codex: {
      action: dryRun ? 'would-update' : 'pending',
      command: ['codex', ...codexArgs],
    },
    claude: [],
    antigravity: {
      path: antigravityPath,
      action: dryRun ? 'would-update' : 'pending',
    },
  };

  for (const path of claudePaths) {
    const merged = mergeMcpServerConfig(readJsonConfig(path), entry);
    if (!dryRun) {
      writeJsonConfig(path, merged, backupSuffix);
    }
    report.claude.push({
      path,
      action: dryRun ? 'would-update' : 'updated',
      backup: !dryRun && existsSync(`${path}.backup-${backupSuffix}`)
        ? `${path}.backup-${backupSuffix}`
        : undefined,
    });
  }

  const antigravity = mergeMcpServerConfig(readJsonConfig(antigravityPath), entry);
  if (!dryRun) {
    writeJsonConfig(antigravityPath, antigravity, backupSuffix);
    report.antigravity.action = 'updated';
    if (existsSync(`${antigravityPath}.backup-${backupSuffix}`)) {
      report.antigravity.backup = `${antigravityPath}.backup-${backupSuffix}`;
    }

    const commandResult = await runCommand('codex', codexArgs);
    if (commandResult?.status !== 0) {
      const error = new Error('Failed to register Contractor MCP server with Codex');
      error.code = 'CODEX_MCP_ADD_FAILED';
      throw error;
    }
    report.codex.action = 'updated';
  }

  return report;
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--server-path=')) {
      options.serverPath = arg.slice('--server-path='.length);
    } else if (arg.startsWith('--node-path=')) {
      options.nodePath = arg.slice('--node-path='.length);
    } else if (arg.startsWith('--executable=')) {
      options.executablePath = arg.slice('--executable='.length);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log([
    'Usage: node scripts/install-mcp-config.mjs [options]',
    '',
    'Options:',
    '  --dry-run             Show target files and command without changing them',
    '  --server-path=<path>  Override the Contractor MCP server entry point',
    '  --node-path=<path>    Override the Node.js executable',
    '  --executable=<path>   Register the packaged executable with --mcp',
    '  -h, --help            Show this help',
  ].join('\n'));
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const report = await installMcpConfig(options);
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (error) {
    console.error(`Contractor MCP config install failed: ${error?.message || 'unknown error'}`);
    process.exitCode = 1;
  }
}
