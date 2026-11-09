import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';
import { startServer } from '../src/server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'deliverables');
const rawOutput = resolve(root, 'artifacts/raw-video');
await mkdir(output, { recursive: true });
await mkdir(rawOutput, { recursive: true });
const server = await startServer(0);
const browser = await chromium.launch({ headless: true, slowMo: 180 });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true, recordVideo: { dir: rawOutput, size: { width: 1360, height: 900 } } });
const page = await context.newPage();
const startedAt = Date.now();
const stages = [];
const mark = text => stages.push({ seconds: (Date.now() - startedAt) / 1000, text });
let rawFilename;

try {
  mark('SockLock Variants: Insert example, кути подачі й бібліотека референсів. У цьому записі — локальні шаблони, не live AI.');
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.locator('#provider-select')).toBeEnabled();
  await page.locator('#provider-select').selectOption('local');
  await page.getByRole('button', { name: 'Insert example', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  mark('Вхід: аудиторія, біль, скрипт, offer і перевірені факти. Основний скрипт та пропозиція залишаються незмінними.');
  await page.locator('#pain').fill('');
  await page.locator('#pain').pressSequentially('matching loose socks after the wash', { delay: 45 });
  await page.locator('#script').focus();
  await page.locator('#offer').focus();
  await page.locator('#facts').focus();
  await page.locator('#provider-select').selectOption('local');
  mark('Обираємо п’ять кутів: тільки вони дозволені в наступних варіантах, максимум два варіанти на кут.');
  await page.getByRole('button', { name: 'Clear angle selection', exact: true }).click();
  for (const angle of ['Question', 'Story / POV', 'Product / benefit', 'Pattern interrupt', 'Complaint']) await page.getByRole('checkbox', { name: angle, exact: true }).check();
  await page.locator('#reference-library').evaluate(node => { node.open = true; });
  await page.getByRole('checkbox', { name: 'Use Laundry POV', exact: true }).check();
  mark('Референс додає приклад стилю до AI-промпту, не нові факти. Скрипти можна переглядати, редагувати й зберігати локально.');
  await page.getByRole('button', { name: 'View reference Laundry POV', exact: true }).click();
  await page.locator('#reference-script').focus();
  await page.getByRole('button', { name: 'Close reference', exact: true }).click();
  mark('Генеруємо 10 варіантів відкриття: хук, текст на екрані, перший кадр і пояснення зміни.');
  await page.getByRole('button', { name: 'Generate variants', exact: true }).click();
  await expect(page.locator('.variant-card')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Generate variants', exact: true })).toBeEnabled();
  await page.locator('#results-title').scrollIntoViewIfNeeded();
  await page.locator('[data-variant-id="V01"]').hover();
  await page.locator('[data-variant-id="V03"]').scrollIntoViewIfNeeded();
  await page.locator('[data-variant-id="V03"] .fact-chip').hover();

  mark('Ризикова правка: додаємо вигадану гарантію й безкоштовну доставку. Перевірка має заблокувати затвердження.');
  await page.getByRole('button', { name: 'Edit V01', exact: true }).click();
  await page.locator('#edit-hook').fill('');
  await page.locator('#edit-hook').pressSequentially('Guaranteed forever, free shipping only today!', { delay: 45 });
  await page.getByRole('button', { name: 'Save and recheck', exact: true }).click();
  await expect(page.locator('[data-variant-id="V01"] .status-tag')).toHaveText('Blocked');
  await expect(page.getByRole('button', { name: 'Approve V01', exact: true })).toBeDisabled();
  await page.locator('[data-variant-id="V01"] .issue-list').hover();

  mark('Виправляємо хук. Автоматичні перевірки допоміжні: факти, узгодженість та якість остаточно перевіряє людина.');
  await page.getByRole('button', { name: 'Edit V01', exact: true }).click();
  await page.locator('#edit-hook').fill('');
  await page.locator('#edit-hook').pressSequentially('One basket. Another loose sock to match.', { delay: 45 });
  await page.getByRole('button', { name: 'Save and recheck', exact: true }).click();
  await page.getByRole('button', { name: 'Approve V01', exact: true }).click();
  await page.getByRole('button', { name: 'Approve V03', exact: true }).click();
  await page.getByRole('button', { name: 'Approve V04', exact: true }).click();
  await page.locator('#approved-count').scrollIntoViewIfNeeded();
  await expect(page.locator('#approved-count')).toHaveText('3');

  mark('Експорт: лише 3 вручну затверджені чернетки. CSV містить відкриття, незмінний body, offer і статус рев’ю.');
  await page.locator('#export-format').selectOption('csv');
  const csvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export approved', exact: true }).click();
  const csvDownload = await csvDownloadPromise;
  await csvDownload.saveAs(resolve(output, 'demo-approved.csv'));
  await page.getByRole('button', { name: /Approved 3/, exact: true }).click();
  await expect(page.locator('.variant-card')).toHaveCount(3);

  mark('JSON також доступний. Workspace зберігає повну роботу локально; ключі не потрапляють у браузер або експорт.');
  await page.locator('#export-format').selectOption('json');
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export approved', exact: true }).click();
  await (await jsonDownloadPromise).saveAs(resolve(output, 'demo-approved.json'));
  const workspacePromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save workspace', exact: true }).click();
  await (await workspacePromise).saveAs(resolve(output, 'demo-workspace.json'));
  await page.getByRole('button', { name: /All 10/, exact: true }).click();

  mark('Наступний gate: час і якість проти ручної роботи та звичайного AI-чату. EGP — сценарій, не виміряний результат цього демо.');
  await page.locator('#batch-status').scrollIntoViewIfNeeded();
  await page.locator('#batch-status').hover();
  await page.screenshot({ path: resolve(output, 'demo-final.png'), animations: 'disabled' });
  rawFilename = await page.video().path();
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

function runFfmpeg(argumentsList) {
  const result = spawnSync(ffmpeg, argumentsList, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.stderr || result.error?.message || 'FFmpeg failed').slice(-5000));
  return result;
}

function durationOf(filename) {
  const result = runFfmpeg(['-hide_banner', '-loglevel', 'error', '-i', filename, '-f', 'null', '-', '-progress', 'pipe:1', '-nostats']);
  const progress = Object.fromEntries(result.stdout.trim().split(/\r?\n/).filter(line => line.includes('=')).map(line => line.split('=')));
  return Number(progress.out_time_us) / 1000000;
}

function timestamp(seconds) {
  const milliseconds = Math.max(0, Math.floor(seconds * 1000));
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
}

const rawDuration = durationOf(rawFilename);
const scale = Math.min(3, 140 / rawDuration);
const finalDuration = rawDuration * scale + 4;
const subtitles = stages.map((stage, index) => `${index + 1}\n${timestamp(stage.seconds * scale)} --> ${timestamp(index + 1 < stages.length ? stages[index + 1].seconds * scale : finalDuration)}\n${stage.text}\n`).join('\n');
await writeFile(resolve(output, 'demo.uk.srt'), subtitles, 'utf8');
const filters = `setpts=${scale}*PTS,tpad=stop_mode=clone:stop_duration=4,pad=iw:ih+150:0:0:color=0x182f23,subtitles=deliverables/demo.uk.srt:force_style='FontName=Arial,FontSize=8,PrimaryColour=&H00FFFFFF,Outline=0,Alignment=2,MarginV=7,MarginL=12,MarginR=12'`;
runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', rawFilename, '-vf', filters, '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve(output, 'demo.mp4')]);
const measuredDuration = durationOf(resolve(output, 'demo.mp4'));
assert.ok(measuredDuration > 10 && measuredDuration < 180, `Invalid demo duration: ${measuredDuration}`);
for (const [name, seconds] of [['demo-frame-start.png', Math.min(5, measuredDuration / 5)], ['demo-frame-review.png', measuredDuration * 0.6]]) {
  runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', resolve(output, 'demo.mp4'), '-frames:v', '1', resolve(output, name)]);
}
const firstHash = createHash('sha256').update(await readFile(resolve(output, 'demo-frame-start.png'))).digest('hex');
const secondHash = createHash('sha256').update(await readFile(resolve(output, 'demo-frame-review.png'))).digest('hex');
assert.notEqual(firstHash, secondHash, 'Recorded frames must change.');
const script = '# Відеодемонстрація SockLock Variants\n\nРеальний браузерний запис; локальна шаблонна генерація. Українські субтитри вбудовані в MP4. Без аудіо. Темп відтворення зменшено для читання; це не benchmark швидкості.\n\n' + stages.map(stage => `- **${timestamp(stage.seconds * scale).slice(0, 8)}** ${stage.text}`).join('\n') + '\n\nПісля демо: 24 задачі з двома дизайнерами, ручний метод / звичайний чат / утиліта. Цілі й stop gates описані в README. Відео не доводить рекламний ROMI або якість живої AI-моделі.\n';
await writeFile(resolve(output, 'demo-script.md'), script);
const report = { checkedAt: new Date().toISOString(), durationSeconds: measuredDuration, underThreeMinutes: measuredDuration < 180, recordedBrowserActions: true, ukrainianSubtitlesBurnedIn: true, audio: false, playbackScale: scale, liveClaudeTested: false, liveFoundryTested: false, differentFrames: firstHash !== secondHash };
await writeFile(resolve(output, 'video-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));