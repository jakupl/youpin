// saveData.js
// Node 18+ (Actions runner: Node 20) - używa global fetch
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_KEY = process.env.BUFF_API_KEY || "8R4voOJHFLcxte3GhBMNKjSmkpQRO7k8bsR6TypaOS5O-cKdzK";
const BUFF_API_URL = process.env.BUFF_API_URL || `https://skins-table.com/api_v2/items?apikey=${API_KEY}&app=730&site=YOUPIN898`;

const outDirDocs = path.join(process.cwd(), 'docs');
const outFileDocs = path.join(outDirDocs, 'youpinPriceList.json');

// target for gh-pages branch (root file)
const tmpDir = path.join(process.cwd(), 'gh-pages-temp');
const outFileGhPages = path.join(tmpDir, 'youpinPriceList.json');

const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY; // e.g. "jakupl/youpin"
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Actions provides this automatically
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

  // data.items expected shape like w twoim przykładzie
  for (const [name, values] of Object.entries(raw.items || {})) {
    const price = values.p;
    const stock = values.c;

    // konwersja kursu - zachowuję /7.1 jak w Twoim kodzie
    const priceConverted = (typeof price === 'number') ? +(price / 7.1).toFixed(2) : null;

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
    // rethrow with message to allow upstream handling
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
    // gałąź może nie istnieć — utworzymy ją lokalnie
    branchExists = false;
    log('Gałąź gh-pages nie istnieje — utworzę nowy branch w katalogu tymczasowym.');
    safeExec(`git init "${tmpDir}"`);
    // ustaw remote
    safeExec(`git -C "${tmpDir}" remote add origin "${GIT_CLONE_URL}"`);
    // stwórz pustą gałąź gh-pages
    safeExec(`git -C "${tmpDir}" checkout --orphan gh-pages`);
  }

  // skopiuj plik do tmpDir (nadpisz)
  fs.copyFileSync(localFilePath, outFileGhPages);
  log('Skopiowano plik do gałęzi gh-pages (tymczasowo).');

  // commit tylko gdy zmiany
  try {
    safeExec(`git -C "${tmpDir}" add -A`);
    // sprawdź czy są zmiany do commita
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
    // cleanup
    // rmDirRecursive(tmpDir); // opcjonalnie pozostawić do debugu
  }
}

(async function main() {
  try {
    const raw = await fetchData(BUFF_API_URL);
    const transformed = transformData(raw);

    // Zapisz także w docs/ (żeby Twój istniejący krok commitowania mógł zadziałać)
    writeDocsFile(transformed);

    // Publikuj do gh-pages (jeśli token jest dostępny)
    try {
      publishToGhPages(outFileDocs);
    } catch (err) {
      console.error('[saveData] Błąd publikacji do gh-pages:', err.message);
      // nie przerywamy całego procesu — zapis do docs już mamy
    }

    log('Koniec.');
  } catch (err) {
    console.error('[saveData] Błąd:', err.message || err);
    process.exitCode = 1;
  }
})();
