import { createWriteStream, existsSync, renameSync, chmodSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';

const GITHUB_REPO = 'endlessblink/contractor';
export const CURRENT_VERSION = '1.2.4';

function getPlatformSuffix() {
  const { platform, arch } = process;
  if (platform === 'darwin') return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  if (platform === 'win32') return 'win-x64.exe';
  return 'linux-x64';
}

export async function checkForUpdate(silent = false) {
  if (typeof process.pkg === 'undefined') return;
  try {
    console.log('Checking for updates...');
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { 'User-Agent': 'contractor-updater' }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) {
      if (!silent) console.log('⚠️  Could not check for updates (HTTP ' + res.status + ')');
      return;
    }

    const release = await res.json();
    const latest = release.tag_name?.replace(/^v/, '');
    if (!latest || latest === CURRENT_VERSION) {
      console.log('✓ Up to date (v' + CURRENT_VERSION + ')');
      return;
    }

    console.log('\n🆕 Update available: v' + CURRENT_VERSION + ' → v' + latest);
    const suffix = getPlatformSuffix();
    const asset = release.assets?.find(a => a.name.includes(suffix));
    if (!asset) {
      console.log('⚠️  No binary available for your platform (' + suffix + ')');
      console.log('   Download manually: https://github.com/' + GITHUB_REPO + '/releases/tag/v' + latest);
      return;
    }

    const totalMB = asset.size ? (asset.size / 1024 / 1024).toFixed(0) : '?';
    console.log('📥 Downloading v' + latest + ' (' + totalMB + ' MB)...');
    console.log('   From: ' + asset.browser_download_url);

    const dlRes = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(300000) });
    if (!dlRes.ok) {
      console.log('❌ Download failed (HTTP ' + dlRes.status + ')');
      console.log('   Download manually: https://github.com/' + GITHUB_REPO + '/releases/tag/v' + latest);
      return;
    }

    const totalBytes = parseInt(dlRes.headers.get('content-length') || asset.size || 0);
    const tmpPath = process.execPath + '.new';
    const writer = createWriteStream(tmpPath);
    let downloaded = 0;
    let lastPct = -1;
    const startTime = Date.now();

    // Use ReadableStream reader (works in pkg where .on('data') doesn't)
    const reader = dlRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
      downloaded += value.length;
      if (totalBytes > 0) {
        const pct = Math.floor((downloaded / totalBytes) * 100);
        if (pct !== lastPct && (pct % 5 === 0 || pct === 100)) {
          const bar = '\u2588'.repeat(Math.floor(pct / 5)) + '\u2591'.repeat(20 - Math.floor(pct / 5));
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? (downloaded / 1024 / 1024 / elapsed).toFixed(1) : '?';
          process.stdout.write('\r   [' + bar + '] ' + pct + '% (' + (downloaded / 1024 / 1024).toFixed(1) + '/' + (totalBytes / 1024 / 1024).toFixed(1) + ' MB, ' + speed + ' MB/s)');
          lastPct = pct;
        }
      } else {
        if (downloaded % (5 * 1024 * 1024) < 65536) {
          process.stdout.write('\r   Downloaded ' + (downloaded / 1024 / 1024).toFixed(1) + ' MB...');
        }
      }
    }
    await new Promise((resolve, reject) => {
      writer.end();
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    process.stdout.write('\n');

    console.log('📦 Installing update...');
    const backupPath = process.execPath + '.old';
    if (existsSync(backupPath)) { try { unlinkSync(backupPath); } catch {} }
    renameSync(process.execPath, backupPath);
    renameSync(tmpPath, process.execPath);
    try { chmodSync(process.execPath, 0o755); } catch {}

    console.log('✅ Updated to v' + latest + '! Restarting in 3 seconds...');
    setTimeout(() => {
      // Auto-restart: use platform-specific approach
      if (process.platform === 'win32') {
        spawn('cmd', ['/c', 'timeout', '/t', '2', '/nobreak', '>', 'nul', '&&', 'start', '""', process.execPath], { detached: true, stdio: 'ignore', shell: true });
      } else {
        spawn(process.execPath, [], { detached: true, stdio: 'ignore' });
      }
      process.exit(0);
    }, 1000);
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      console.log('⚠️  Update check timed out. Continuing with current version.');
    } else {
      console.log('⚠️  Update failed: ' + (err.message || err));
      console.log('   The app will continue running with v' + CURRENT_VERSION);
      console.log('   Download manually: https://github.com/' + GITHUB_REPO + '/releases');
    }
  }
}
