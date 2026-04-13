const fs = require('fs');
const path = require('path');

const srcBinDir = path.join(__dirname, '..', 'src', 'bin');
const platformWinDir = path.join(__dirname, '..', 'src', 'platform', 'windows', 'bin');

const windowsFiles = [
  '*.exe',
  '*.dll',
  '*.cmd',
  'goose-npm/**/*',
  'python-runtime',
  'ms-playwright',
  'ocr-runtime',
];
const commonFiles = ['*.db', '*.log', '.gitkeep'];

function matchesPattern(filename, patterns) {
  return patterns.some((pattern) => {
    if (pattern.includes('**')) {
      const basePattern = pattern.split('/**')[0];
      return filename.startsWith(basePattern);
    }

    if (pattern.startsWith('*.')) {
      return filename.endsWith(pattern.slice(1));
    }

    if (pattern.includes('*')) {
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
      return regex.test(filename);
    }

    return filename === pattern;
  });
}

function removeEntry(entryPath) {
  fs.rmSync(entryPath, { recursive: true, force: true });
}

function cleanBinDirectory(targetPlatform) {
  console.log(`Cleaning src/bin for ${targetPlatform} build`);

  if (!fs.existsSync(srcBinDir)) {
    console.log('src/bin does not exist yet, skipping cleanup');
    return;
  }

  const entries = fs.readdirSync(srcBinDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(srcBinDir, entry.name);

    if (targetPlatform === 'win32') {
      const keepEntry =
        matchesPattern(entry.name, windowsFiles) || matchesPattern(entry.name, commonFiles);

      if (keepEntry) {
        continue;
      }

      if (entry.isDirectory()) {
        console.log(`Removing non-Windows directory: ${entry.name}`);
        removeEntry(entryPath);
        continue;
      }

      if (!path.extname(entry.name) && entry.name !== '.gitkeep') {
        try {
          const stats = fs.statSync(entryPath);
          if ((stats.mode & 0o111) !== 0) {
            console.log(`Removing non-Windows executable: ${entry.name}`);
            removeEntry(entryPath);
          }
        } catch (error) {
          console.warn(`Could not inspect ${entry.name}: ${error.message}`);
        }
      }
      continue;
    }

    if (matchesPattern(entry.name, windowsFiles)) {
      console.log(`Removing Windows-only entry: ${entry.name}`);
      removeEntry(entryPath);
    }
  }
}

function copyWindowsPlatformFiles() {
  if (!fs.existsSync(platformWinDir)) {
    console.log('No src/platform/windows/bin directory found, skipping Windows shim copy');
    return;
  }

  fs.mkdirSync(srcBinDir, { recursive: true });

  const entries = fs.readdirSync(platformWinDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'README.md' || entry.name === '.gitignore') {
      continue;
    }

    const srcPath = path.join(platformWinDir, entry.name);
    const destPath = path.join(srcBinDir, entry.name);

    if (entry.isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true, force: true });
      console.log(`Copied Windows directory: ${entry.name}`);
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`Copied Windows file: ${entry.name}`);
    }
  }
}

function preparePlatformBinaries(targetPlatform) {
  console.log(`Preparing binaries for ${targetPlatform}`);

  if (targetPlatform === 'win32') {
    copyWindowsPlatformFiles();
  }

  cleanBinDirectory(targetPlatform);

  if (!fs.existsSync(srcBinDir)) {
    fs.mkdirSync(srcBinDir, { recursive: true });
  }

  console.log('Platform binary preparation complete');
}

if (require.main === module) {
  const targetPlatform = process.argv[2] || process.env.ELECTRON_PLATFORM || process.platform;
  preparePlatformBinaries(targetPlatform);
}

module.exports = { preparePlatformBinaries };
