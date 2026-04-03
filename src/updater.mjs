import { createWriteStream, existsSync, renameSync, chmodSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';

const GITHUB_REPO = 'endlessblink/contractor';
export const CURRENT_VERSION = '1.5.5';

function getPlatformSuffix() {
  const { platform, arch } = process;
  if (platform === 'darwin') return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  if (platform === 'win32') return 'win-x64.exe';
  return 'linux-x64';
}

/** Check GitHub for a newer release. Returns { current, latest, url, asset } or null if up to date. */
export async function checkUpdateAvailable() {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    { headers: { 'User-Agent': 'contractor-updater' }, signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error('GitHub API returned HTTP ' + res.status);

  const release = await res.json();
  const latest = release.tag_name?.replace(/^v/, '');
  if (!latest || latest === CURRENT_VERSION) return null; // up to date

  const suffix = getPlatformSuffix();
  const asset = release.assets?.find(a => a.name.includes(suffix));
  const url = 'https://github.com/' + GITHUB_REPO + '/releases/tag/v' + latest;

  return { current: CURRENT_VERSION, latest, url, asset: asset || null };
}

/** Download the update binary, replace the current exe, and restart. */
export async function downloadAndInstall(asset) {
  if (!asset || !asset.browser_download_url) {
    throw new Error('No download URL available for this platform');
  }

  console.log('📥 Downloading update (' + ((asset.size || 0) / 1024 / 1024).toFixed(0) + ' MB)...');
  const dlRes = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(300000) });
  if (!dlRes.ok) throw new Error('Download failed (HTTP ' + dlRes.status + ')');

  const totalBytes = parseInt(dlRes.headers.get('content-length') || asset.size || 0);
  const tmpPath = process.execPath + '.new';
  const writer = createWriteStream(tmpPath);
  let downloaded = 0;
  let lastPct = -1;
  const startTime = Date.now();

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

  console.log('✅ Update installed! Restarting...');
  setTimeout(() => {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'ping -n 3 127.0.0.1 >nul && start "" "' + process.execPath + '"'], { detached: true, stdio: 'ignore' });
    } else {
      spawn(process.execPath, [], { detached: true, stdio: 'ignore' });
    }
    process.exit(0);
  }, 1000);
}

/** Legacy wrapper — check + auto-download (used at startup in packaged builds). */
export async function checkForUpdate(silent = false) {
  if (typeof process.pkg === 'undefined') return;
  try {
    const info = await checkUpdateAvailable();
    if (!info) { console.log('✓ Up to date (v' + CURRENT_VERSION + ')'); return; }
    console.log('\n🆕 Update available: v' + info.current + ' → v' + info.latest);
    if (!info.asset) {
      console.log('⚠️  No binary for your platform. Download manually: ' + info.url);
      return;
    }
    await downloadAndInstall(info.asset);
  } catch (err) {
    if (!silent) console.log('⚠️  Update check failed: ' + (err.message || err));
  }
}
