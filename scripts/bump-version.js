import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJsonPath = path.resolve(__dirname, '../package.json');
const tauriConfPath = path.resolve(__dirname, '../src-tauri/tauri.conf.json');
const cargoTomlPath = path.resolve(__dirname, '../src-tauri/Cargo.toml');

if (!fs.existsSync(packageJsonPath)) {
  console.error(`Could not find package.json at ${packageJsonPath}`);
  process.exit(1);
}

if (!fs.existsSync(tauriConfPath)) {
  console.error(`Could not find tauri.conf.json at ${tauriConfPath}`);
  process.exit(1);
}

if (!fs.existsSync(cargoTomlPath)) {
  console.error(`Could not find Cargo.toml at ${cargoTomlPath}`);
  process.exit(1);
}

// Read files
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
let cargoToml = fs.readFileSync(cargoTomlPath, 'utf-8');

const currentVersion = packageJson.version;
const bumpType = process.argv[2] || 'patch';

const versionParts = currentVersion.split('.').map(Number);
if (versionParts.length !== 3 || versionParts.some(isNaN)) {
  console.error(`Invalid current version in package.json: ${currentVersion}`);
  process.exit(1);
}

let [major, minor, patch] = versionParts;

if (bumpType === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bumpType === 'minor') {
  minor += 1;
  patch = 0;
} else if (bumpType === 'patch') {
  patch += 1;
} else {
  // If the user specified a direct version string (e.g. 1.2.3)
  const directVersionParts = bumpType.split('.').map(Number);
  if (directVersionParts.length === 3 && !directVersionParts.some(isNaN)) {
    [major, minor, patch] = directVersionParts;
  } else {
    console.error(`Unknown bump type or invalid version: ${bumpType}. Use 'major', 'minor', 'patch', or a specific version like '1.2.3'.`);
    process.exit(1);
  }
}

const newVersion = `${major}.${minor}.${patch}`;

// Update package.json
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');

// Update tauri.conf.json
tauriConf.version = newVersion;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf-8');

// Update Cargo.toml
cargoToml = cargoToml.replace(/^version\s*=\s*".*"/m, `version = "${newVersion}"`);
fs.writeFileSync(cargoTomlPath, cargoToml, 'utf-8');

console.log(`Version bumped from ${currentVersion} to ${newVersion} successfully in package.json, tauri.conf.json, and Cargo.toml.`);

try {
  console.log('Staging version changes...');
  execSync('git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml', { stdio: 'inherit' });

  console.log(`Committing version bump to v${newVersion}...`);
  execSync(`git commit -m "chore: bump version to v${newVersion}"`, { stdio: 'inherit' });

  console.log(`Creating tag v${newVersion}...`);
  execSync(`git tag -a v${newVersion} -m "Version ${newVersion}"`, { stdio: 'inherit' });

  console.log('Pushing commit to remote main branch...');
  execSync('git push origin main', { stdio: 'inherit' });

  console.log(`Pushing tag v${newVersion} to remote...`);
  execSync(`git push origin v${newVersion}`, { stdio: 'inherit' });

  console.log('Successfully bumped, tagged, and pushed to GitHub. Release workflow should trigger automatically.');
} catch (error) {
  console.error('Git automation failed:', error.message);
  process.exit(1);
}
