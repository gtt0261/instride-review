const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, realpathSync, rmSync } = require('node:fs');
const { basename, dirname, join } = require('node:path');
const { tmpdir } = require('node:os');
const { once } = require('node:events');
const { chromium } = require('playwright');

const root = join(__dirname, '..');
const candidates = JSON.parse(readFileSync(join(root, 'evaluation-candidates.json'))).cases;
const evidence = JSON.parse(readFileSync(join(root, 'review-media.json'))).cases;
const python = process.env.REVIEW_PYTHON || 'python';
const remote = process.argv[2];
const screenshots = process.env.REVIEW_SCREENSHOTS;

function waitForServer(proc) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Local review server startup timed out.')), 10000);
    proc.once('error', reject);
    proc.once('exit', code => reject(Error('Local review server exited with ' + code)));
    proc.stdout.once('data', data => {
      clearTimeout(timer);
      const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) resolve(match[0]);
      else reject(Error('Unexpected startup output: ' + data));
    });
  });
}

function collection(reviews) {
  return JSON.parse(execFileSync(python, ['scripts/review_webui.py', '--reviews', reviews, 'eligible'],
    { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' }));
}

async function waitForPlay(page, width) {
  await page.waitForFunction(w => {
    const film = document.getElementById('film');
    return film.videoWidth === w && film.currentTime > .15;
  }, width, { timeout: 25000 });
}

async function playback(page, base) {
  const requests = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto(base);
  await page.locator('#case-content').waitFor();
  await page.waitForFunction(() => document.getElementById('film').poster.includes('/preview/start.webp'));
  await page.waitForTimeout(250);
  assert(!requests.some(path => /\.(mp4|jpg)$/.test(path)), 'No video or original still should preload');
  assert(!requests.some(path => /\/(audit|run)\.json$/.test(path)), 'Audit evidence should open on demand');

  await page.locator('#quality').selectOption('540');
  for (const entry of candidates) {
    await page.locator('#case-select').selectOption(entry.id);
    await page.locator('#case-content').waitFor();
    assert.equal(await page.locator('h1').textContent(), entry.instruction);
    assert.equal(await page.locator('#target-part').textContent(), entry.target_part);
    await page.locator('#start-playback').click();
    await waitForPlay(page, 960);
    await page.locator('#film').evaluate(film => {
      film.pause();
      film.currentTime = 2;
    });
    await page.waitForFunction(() => document.getElementById('clock').textContent.includes('Frame 48 /'));
    await page.locator('[data-key="stop"]').click();
    const preview = await page.locator('#hero').evaluate(async image => {
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    });
    assert.deepEqual(preview, [1120, 630]);
    assert.match(await page.locator('#clock').textContent(), new RegExp(
      'Frame ' + evidence[entry.id].key_frames.stop + ' /'));
    assert.match(await page.locator('#original').getAttribute('href'), /stop\.jpg\?v=/);
  }
  assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation').length), 1);
  assert.equal(new URL(page.url()).searchParams.get('case'), 'station-terminal');
  await page.goBack();
  await page.locator('#case-content').waitFor();
  assert.equal(await page.locator('#case-select').inputValue(), 'pool-door');
  await page.locator('#copy').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), page.url());
  console.log('Six scenes: deferred media, 540p playback, seeking, STOP frames, same-page switching and share links passed.');
}

async function changeQuality(page) {
  await page.locator('#quality').selectOption('540');
  await page.locator('#start-playback').click();
  await waitForPlay(page, 960);
  await page.locator('#film').evaluate(film => {
    film.pause();
    film.currentTime = 3.25;
  });
  await page.waitForFunction(() => document.getElementById('clock').textContent.includes('Frame 78 /'));
  await page.locator('#quality').selectOption('1080');
  await page.waitForFunction(() => {
    const film = document.getElementById('film');
    return film.videoWidth === 1920 && film.paused && Math.abs(film.currentTime - 3.25) < .08;
  });
  assert.match(await page.locator('#original').getAttribute('href'), /expert\.mp4\?v=/);
  await page.locator('#film').evaluate(film => film.play());
  await page.waitForFunction(() => document.getElementById('film').currentTime > 3.65);
  await page.locator('#quality').selectOption('540');
  await page.waitForFunction(() => {
    const film = document.getElementById('film');
    return film.videoWidth === 960 && !film.paused && film.currentTime > 3.6;
  });
  console.log('Resolution switching preserved the playhead and paused/playing state.');
}

async function autoFallback(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', {
        value: { effectiveType: '4g', downlink: 10, saveData: false },
      });
    });
    let highRequested = false;
    await page.route('**/run/expert.mp4?*', async route => {
      highRequested = true;
      await new Promise(resolve => setTimeout(resolve, 3300));
      await route.abort().catch(() => {});
    });
    await page.goto(base);
    await page.locator('#case-content').waitFor();
    await page.locator('#start-playback').click();
    await waitForPlay(page, 960);
    assert(highRequested, 'Auto should attempt 1080p with the reported fast connection');
    assert.match(await page.locator('#mode').textContent(), /Auto · 540p/);
  } finally {
    await context.close();
  }
  console.log('Auto fell back to 540p when the initial 1080p stream stalled.');
}

async function review(page, base, reviews) {
  const url = new URL(base);
  url.searchParams.set('case', 'pool-door');
  await page.goto(url.href);
  await page.locator('#case-content').waitFor();
  await page.locator('[data-key="stop"]').click();
  await page.locator('#who').fill('Smoke Reviewer');
  await page.locator('#decision').selectOption('approve');
  await page.locator('#save').click();
  await page.getByText('Confirm both the target and the reachable area before approving.').waitFor();
  await page.locator('#verify-target').check();
  await page.locator('#verify-area').check();

  await page.locator('#block').click();
  const map = page.locator('#map');
  const box = await map.boundingBox();
  await map.click({ position: { x: box.width * .28, y: box.height * .43 } });
  await map.click({ position: { x: box.width * .48, y: box.height * .56 } });
  await page.getByText('Proposed no-stop zone marked.').waitFor();
  await page.locator('#save').click();
  await page.getByText('Submit proposed geometry as a change request', { exact: false }).waitFor();

  await page.locator('#decision').selectOption('request_changes');
  await page.locator('#save').click();
  await page.getByText('Explain what needs to change.').waitFor();
  await page.locator('#note').fill('Check the proposed exclusion against the pool deck.');
  if (reviews) {
    await page.locator('#save').click();
    await page.getByText('Review saved.', { exact: true }).waitFor();
    assert.equal(collection(reviews).eligible.length, 0);
  } else {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save').click()]);
    const request = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(request.decision, 'request_changes');
    assert.equal(request.proposed_no_stop_zones_xyxy_u.length, 1);
    assert.equal(request.source_revision, evidence['pool-door'].source_revision);
  }

  await page.locator('#restore').click();
  await page.locator('#decision').selectOption('approve');
  await page.locator('#note').fill('');
  const visibleState = reviews ? 'Approved for pilot' : 'Approved on this device';
  if (reviews) {
    await page.locator('#save').click();
    await page.getByText(visibleState, { exact: true }).waitFor();
    await page.locator('#save').click();
    await page.getByText('Review saved.', { exact: true }).waitFor();
    const [admitted] = collection(reviews).eligible;
    assert.equal(admitted.case_id, 'pool-door');
    const journal = readFileSync(join(reviews, 'pool-door', 'decisions.jsonl'), 'utf8').trim().split('\n');
    assert.equal(journal.length, 2);
    assert.equal(JSON.parse(journal[1]).evidence_locator.frame_index, evidence['pool-door'].key_frames.stop);
    assert.equal((await page.request.get(new URL('/reviews/pool-door/decisions.jsonl', base).href)).status(), 404);
  } else {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save').click()]);
    const approval = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(approval.decision, 'approve');
    assert.equal(approval.evidence_locator.frame_index, evidence['pool-door'].key_frames.stop);
  }

  await page.reload();
  await page.getByText(visibleState, { exact: true }).waitFor();
  await page.locator('[data-key="stop"]').click();
  await page.locator('#hero').evaluate(image => image.decode());
  if (screenshots) {
    await page.screenshot({ path: join(screenshots, 'harness-desktop.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 393, height: 852 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  if (screenshots) {
    await page.screenshot({ path: join(screenshots, 'harness-mobile.png'), fullPage: true });
  }
  console.log('Target/area checks, corrective geometry, revision-bound decisions and mobile layout passed.');
}

async function main() {
  const temp = realpathSync(tmpdir());
  const reviews = remote ? null : mkdtempSync(join(temp, 'instride-review-smoke-'));
  let server;
  let browser;
  try {
    if (reviews) {
      server = spawn(python, ['scripts/review_webui.py', '--reviews', reviews, 'serve', '--port', '0'],
        { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      server.stderr.on('data', data => { if (process.env.REVIEW_VERBOSE) process.stderr.write(data); });
    }
    const base = remote || await waitForServer(server);
    browser = await chromium.launch({ executablePath: process.env.REVIEW_BROWSER_EXE, headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 980 }, permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await playback(page, base);
    await page.goto(base);
    await page.locator('#case-content').waitFor();
    await changeQuality(page);
    await review(page, base, reviews);
    assert.deepEqual(errors, []);
    if (!remote) await autoFallback(browser, base);
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null) {
      const exit = once(server, 'exit');
      server.kill();
      await exit;
    }
    if (reviews && dirname(realpathSync(reviews)) === temp && basename(reviews).startsWith('instride-review-smoke-')) {
      rmSync(reviews, { recursive: true });
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
