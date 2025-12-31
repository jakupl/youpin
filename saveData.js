
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_KEY = process.env.BUFF_API_KEY || "8R4voOJHFLcxte3GhBMNKjSmkpQRO7k8bsR6TypaOS5O-cKdzK";
const BUFF_API_URL = process.env.BUFF_API_URL || `https://skins-table.com/api_v2/items?apikey=${API_KEY}&app=730&site=YOUPIN898`;

const outDirDocs = path.join(process.cwd(), 'docs');
const outFileDocs = path.join(outDirDocs, 'youpinPriceList.json');

const tmpDir = path.join(process.cwd(), 'gh-pages-temp');
const outFileGhPages = path.join(tmpDir, 'youpinPriceList.json');

const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
const GIT_CLONE_URL = GITHUB_REPOSITORY && GITHUB_TOKEN
  ? `https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git`
  : null;

function log(...args) { console.log('[saveData]', ...args); }

async function fetchData(url) {
  log('Pobieram dane z:', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Błąd HTTP: ${res.status}`);
  return res.json();
}

function transformData(raw) {
  const transformed = { items: {} };

  for (const [name, values] of Object.entries(raw.items || {})) {
    const price = values.p;
    const stock = values.c;

    const priceConverted = (typeof price === 'number') ? +(price / 7).toFixed(2) : null;

    if (typeof stock === 'number' && stock >= 1 && priceConverted !== null) {
      transformed.items[name] = {
        price: priceConverted,
        stock: stock
      };
    }
  }

  transformed.generated_at = new Date().toISOString();
  return transformed;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeDocsFile(obj) {
  ensureDir(outDirDocs);
  fs.writeFileSync(outFileDocs, JSON.stringify(obj, null, 2), 'utf8');
  log('Zapisano ->', outFileDocs);
}

function rmDirRecursive(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: 'inherit', ...opts });
  } catch (err) {
    throw new Error(`Command failed: ${cmd}\n${err.message}`);
  }
}

function publishToGhPages(localFilePath) {
  if (!GIT_CLONE_URL || !GITHUB_REPOSITORY) {
    log('Brak GITHUB_TOKEN lub GITHUB_REPOSITORY — pomijam publikację do gh-pages.');
    return;
  }

  // usuń stare temp
  rmDirRecursive(tmpDir);
  ensureDir(tmpDir);

  const cloneCmd = `git clone --depth 1 --branch gh-pages "${GIT_CLONE_URL}" "${tmpDir}"`;
  let branchExists = true;
  try {
    log('Klonuję gałąź gh-pages do tymczasowego katalogu...');
    safeExec(cloneCmd);
  } catch (err) {
    branchExists = false;
    log('Gałąź gh-pages nie istnieje — utworzę nowy branch w katalogu tymczasowym.');
    safeExec(`git init "${tmpDir}"`);
    safeExec(`git -C "${tmpDir}" remote add origin "${GIT_CLONE_URL}"`);
    safeExec(`git -C "${tmpDir}" checkout --orphan gh-pages`);
  }

  fs.copyFileSync(localFilePath, outFileGhPages);
  log('Skopiowano plik do gałęzi gh-pages (tymczasowo).');

  try {
    safeExec(`git -C "${tmpDir}" add -A`);
    let diffOutput;
    try {
      diffOutput = execSync(`git -C "${tmpDir}" diff --staged --quiet && echo "NO_CHANGES" || echo "HAS_CHANGES"`, { encoding: 'utf8' }).trim();
    } catch (e) {
      diffOutput = 'HAS_CHANGES';
    }

    if (diffOutput === 'NO_CHANGES') {
      log('Brak zmian do wypchnięcia na gh-pages.');
    } else {
      safeExec(`git -C "${tmpDir}" config user.name "github-actions[bot]"`);
      safeExec(`git -C "${tmpDir}" config user.email "41898282+github-actions[bot]@users.noreply.github.com"`);
      safeExec(`git -C "${tmpDir}" commit -m "chore: update youpinPriceList.json [ci skip]"`);
      if (branchExists) {
        log('Wypychanie zmian do gh-pages...');
        safeExec(`git -C "${tmpDir}" push origin gh-pages`);
      } else {
        log('Tworzę i wypycham gałąź gh-pages (pierwszy push)...');
        safeExec(`git -C "${tmpDir}" push -u origin gh-pages`);
      }
      log('Publikacja do gh-pages zakończona.');
    }
  } catch (err) {
    throw new Error('Błąd podczas commita/push: ' + err.message);
  } finally {
  }
}

(async function main() {
  try {
    const raw = await fetchData(BUFF_API_URL);
    const transformed = transformData(raw);

    writeDocsFile(transformed);

    try {
      publishToGhPages(outFileDocs);
    } catch (err) {
      console.error('[saveData] Błąd publikacji do gh-pages:', err.message);
    }

    log('Koniec.');
  } catch (err) {
    console.error('[saveData] Błąd:', err.message || err);
    process.exitCode = 1;
  }
})();

