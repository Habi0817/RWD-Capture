// Run after npm run build, with Chrome and Edge installed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

let origin: string;
const root = process.cwd();
const directory = await mkdtemp(path.join(tmpdir(), 'rwd-batch-'));
const pending = new Map<string, ServerResponse>();
let synchronized = false;
let failSecond = true;
const fixture = createServer((req, res) => {
  const route = req.url!;
  if (!['/first', '/second'].includes(route)) { res.writeHead(404).end(); return; }
  const reply = (name: string, response: ServerResponse) => {
    response.writeHead(name === '/second' && failSecond ? 503 : 200, {'Content-Type':'text/html'});
    response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><h1>' + name + '</h1>');
  };
  if (synchronized) { reply(route, res); return; }
  pending.set(route, res);
  if (pending.size === 2) {
    synchronized = true;
    for (const [name, response] of pending) reply(name, response);
    pending.clear();
  }
});
await cp(path.join(root, 'dist'), path.join(directory, 'dist'), {recursive:true});
fixture.listen(0, '127.0.0.1');
await once(fixture, 'listening');
const address = fixture.address();
assert.ok(address && typeof address !== 'string');
const urls = ['/first','/second'].map(route => 'http://127.0.0.1:' + address.port + route);
const service = spawn(process.execPath, [path.join(root, 'dist-server/index.js')], {
  cwd: directory, windowsHide:true, env:{...process.env, NO_OPEN:'1', RWD_CAPTURE_PORT:'0'}, stdio:['ignore','pipe','pipe']
});
const exited = once(service, 'exit');
async function api(route: string, body?: unknown) {
  const response = await fetch(origin + '/api/' + route, body === undefined ? {} : {
    method: 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
async function waitFor(id: string, status: string) {
  for (let i = 0; i < 150; i++) {
    const job = (await api('jobs')).find((entry: any) => entry.id === id);
    if (job?.status === status) return job;
    await delay(200);
  }
  throw Error('Timed out waiting for ' + status);
}
try {
  const [message] = await Promise.race([once(service.stdout!, 'data'), exited.then(()=>{throw Error('Service did not start')})]);
  const match = String(message).match(/http:\/\/127\.0\.0\.1:\d+/);
  assert.ok(match, 'Missing local service URL');
  origin = match[0];
  const browser = await chromium.launch({channel:'chrome'});
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    await page.getByRole('button', {name:'進階設定'}).click();
    const settings = page.locator('.settings textarea');
    const config = JSON.parse(await settings.inputValue());
    config.name = '響應式截圖工作台';
    config.profiles[0].name = '谷歌瀏覽器';
    config.resolutions.find((r: {name:string}) => r.name === 'mobile-375').name = '手機 375';
    await settings.fill(JSON.stringify(config));
    const saveResult = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/api/config'));
    await page.getByRole('button', {name:'驗證並儲存 JSON'}).click();
    const saved = await saveResult;
    assert.equal(saved.status(), 200, await saved.text());
    assert.equal((await saved.json()).name, config.name);
    await page.waitForFunction(() => document.title === '響應式截圖工作台');
    await page.reload();
    await page.getByText('響應式截圖工作台', {exact:false}).first().waitFor();
    await page.getByLabel('目標網址（每行一個）').fill([urls[0], '', urls[1], urls[0]].join('\n'));
    await page.locator('input[value="msedge"]').uncheck();
    await page.getByRole('button',{name:'清空',exact:true}).click();
    await page.locator('input[value="手機 375"]').check();
    await page.getByText('2 張',{exact:true}).waitFor();
    const posted = page.waitForResponse(r=>r.url()===origin+'/api/jobs' && r.request().method()==='POST');
    await page.getByRole('button',{name:/開始擷取/}).click();
    const job = await (await posted).json();
    const first = await waitFor(job.id, 'partial');
    assert.ok(synchronized);
    assert.deepEqual(first.urls, urls);
    assert.equal(first.items.length, 2);
    assert.equal(first.items[0].status,'完成');
    assert.equal(first.items[1].status,'失敗');
    const timestamp = first.items[0].meta.capturedAt;
    failSecond = false;
    await page.getByRole('button',{name:'重試未完成項目'}).click();
    const completed = await waitFor(job.id, 'completed');
    assert.equal(completed.items[0].meta.capturedAt,timestamp);
    assert.notEqual(completed.items[0].file,completed.items[1].file);
    for (const item of completed.items) {
      assert.equal(item.url,item.meta.finalUrl);
      assert.ok(item.file.endsWith('/谷歌瀏覽器/手機 375_375x667.png'));
      const served = await fetch(origin + '/captures/' + job.id + '/' + item.file);
      assert.equal(served.status, 200);
      const png = await readFile(path.join(directory,'captures',job.id,item.file));
      assert.equal(png.readUInt32BE(16),750);
    }
    await page.getByRole('combobox').selectOption(urls[1]);
    await page.locator('img[src*="url-002/"]').waitFor();
    const legacy = await api('jobs',{url:urls[0],profiles:['msedge'],resolutions:['手機 375']});
    const single = await waitFor(legacy.id,'completed');
    assert.match(single.items[0].file,/^msedge\//);
    console.log('PASS: concurrent URLs, partial failure, isolated retry, Vue results, legacy single URL on Edge');
  } finally { await browser.close(); }
} finally {
  if (service.exitCode === null) service.kill();
  await exited;
  fixture.closeAllConnections();
  fixture.close();
  if (path.dirname(directory) === path.resolve(tmpdir()) && path.basename(directory).startsWith('rwd-batch-')) {
    await rm(directory, {recursive:true, force:true});
  }
}
