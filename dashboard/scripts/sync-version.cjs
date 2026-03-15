const fs = require("fs");
const path = require("path");

const dashboardRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const versionPath = path.join(repoRoot, "VERSION");
const tauriConfPath = path.join(dashboardRoot, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(dashboardRoot, "src-tauri", "Cargo.toml");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function readVersion() {
  const version = readText(versionPath).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Nieprawidlowy format wersji w VERSION: "${version}"`);
  }
  return version;
}

function syncTauriConfig(version) {
  const raw = readText(tauriConfPath);
  const eol = detectEol(raw);
  const config = JSON.parse(raw);

  if (config.version === version) {
    return false;
  }

  config.version = version;
  const serialized = JSON.stringify(config, null, 2).replace(/\n/g, eol);
  fs.writeFileSync(tauriConfPath, `${serialized}${eol}`);
  return true;
}

function syncPackageJson(version) {
  const pkgPath = path.join(dashboardRoot, "package.json");
  const raw = readText(pkgPath);
  const eol = detectEol(raw);
  const pkg = JSON.parse(raw);

  if (pkg.version === version) {
    return false;
  }

  pkg.version = version;
  const serialized = JSON.stringify(pkg, null, 2).replace(/\n/g, eol);
  fs.writeFileSync(pkgPath, `${serialized}${eol}`);
  return true;
}

function syncCargoToml(version) {
  const raw = readText(cargoTomlPath);
  const packageBlockMatch = raw.match(/\[package\][\s\S]*?(?=\r?\n\[|$)/);

  if (!packageBlockMatch) {
    throw new Error("Nie znaleziono sekcji [package] w dashboard/src-tauri/Cargo.toml");
  }

  const packageBlock = packageBlockMatch[0];
  const currentVersionMatch = packageBlock.match(/^version\s*=\s*"([^"]*)"/m);

  if (!currentVersionMatch) {
    throw new Error("Nie znaleziono pola version w sekcji [package] dashboard/src-tauri/Cargo.toml");
  }

  if (currentVersionMatch[1] === version) {
    return false;
  }

  const updatedPackageBlock = packageBlock.replace(
    /^version\s*=\s*"[^"]*"/m,
    `version = "${version}"`
  );
  const updated = raw.replace(packageBlock, updatedPackageBlock);
  fs.writeFileSync(cargoTomlPath, updated);
  return true;
}

function main() {
  const version = readVersion();
  const pkgChanged = syncPackageJson(version);
  const tauriChanged = syncTauriConfig(version);
  const cargoChanged = syncCargoToml(version);

  if (pkgChanged || tauriChanged || cargoChanged) {
    console.log(`Zsynchronizowano wersje dashboardu do ${version}`);
  } else {
    console.log(`Wersja dashboardu jest juz zsynchronizowana (${version})`);
  }
}

main();
