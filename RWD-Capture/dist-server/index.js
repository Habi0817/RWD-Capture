import { parseTargets } from './targets.js';
import express from 'express';
import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { defaults, schema, deviceOptions } from './config.js';
const root = process.cwd(), data = path.join(root, 'data'), captures = path.join(root, 'captures'), configPath = path.join(root, 'screenshot.config.json');
await fs.mkdir(data, { recursive: true });
await fs.mkdir(captures, { recursive: true });
try {
    await fs.access(configPath);
}
catch {
    await fs.writeFile(configPath, JSON.stringify(defaults, null, 2));
}
async function config() { return schema.parse(JSON.parse(await fs.readFile(configPath, 'utf8'))); }
const app = express();
app.use(express.json({ limit: '2mb' }));
// Local UI is the only permitted mutation source; reject cross-site form and fetch requests.
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const hosts = ['127.0.0.1', 'localhost'].map(host => host + ':' + req.socket.localPort);
    if (!hosts.includes(req.headers.host || '') || (origin && !hosts.some(host => origin === 'http://' + host))) {
        res.status(403).json({ error: '僅允許本機介面存取' });
        return;
    }
    next();
});
app.get('/api/config', async (_q, s) => s.json(await config()));
app.put('/api/config', async (q, s) => { const c = schema.parse(q.body); await fs.writeFile(configPath, JSON.stringify(c, null, 2)); s.json(c); });
function url(value) { const u = new URL(String(value)); if (!['http:', 'https:'].includes(u.protocol))
    throw Error('僅支援 HTTP／HTTPS 網址'); return u.href; }
function launch(p, headed = false) { return chromium.launch({ headless: !headed, ...(p.browserExecutablePath ? { executablePath: p.browserExecutablePath } : { channel: p.browserChannel }) }); }
const auth = new Map();
const statePath = (name) => path.join(data, `${name}.json`);
app.get('/api/auth', async (_q, s) => { const c = await config(); s.json(await Promise.all(c.profiles.map(async (p) => ({ name: p.name, saved: await fs.access(statePath(p.name)).then(() => true, () => false), open: auth.has(p.name) })))); });
app.post('/api/auth/:name/open', async (q, s) => { const p = (await config()).profiles.find(p => p.name === q.params.name); if (!p)
    throw Error('找不到瀏覽器設定'); if (auth.has(p.name))
    throw Error('登入視窗已開啟'); const browser = await launch(p, true); try {
    const context = await browser.newContext();
    const page = await context.newPage();
    auth.set(p.name, { browser, context });
    await page.goto(url(q.body.url), { waitUntil: 'domcontentloaded' });
    s.json({ ok: true });
}
catch (e) {
    auth.delete(p.name);
    await browser.close();
    throw e;
} });
app.post('/api/auth/:name/save', async (q, s) => {
    const name = q.params.name;
    const a = auth.get(name);
    if (!a)
        throw Error('請先開啟登入視窗');
    const sessions = {};
    for (const page of a.context.pages()) {
        try {
            const v = await page.evaluate(() => ({ origin: location.origin, values: { ...sessionStorage } }));
            sessions[v.origin] = v.values;
        }
        catch { }
    }
    await fs.writeFile(statePath(name), JSON.stringify({ storage: await a.context.storageState({ indexedDB: true }), sessions }));
    await a.browser.close();
    auth.delete(name);
    s.json({ ok: true });
});
app.delete('/api/auth/:name', async (q, s) => { if (!(await config()).profiles.some(p => p.name === q.params.name))
    throw Error('設定不存在'); await auth.get(q.params.name)?.browser.close(); auth.delete(q.params.name); await fs.rm(statePath(q.params.name), { force: true }); s.json({ ok: true }); });
const jobs = new Map(), running = new Map();
const writes = new Map();
async function persist(j) { const snapshot = JSON.stringify(j, null, 2); const next = (writes.get(j.id) ?? Promise.resolve()).catch(() => { }).then(async () => { const file = path.join(captures, j.id, 'manifest.json'); await fs.writeFile(file + '.tmp', snapshot); await fs.rename(file + '.tmp', file); }); writes.set(j.id, next); await next; }
async function prepare(context, j, p) { if (!j.useAuth)
    return; const state = JSON.parse(await fs.readFile(statePath(p), 'utf8')); await context.addInitScript(sessions => { const values = sessions[location.origin]; if (values)
    for (const [k, v] of Object.entries(values))
        sessionStorage.setItem(k, String(v)); }, state.sessions); }
async function capture(j, item) {
    const p = j.config.profiles.find(p => p.name === item.profile), r = j.config.resolutions.find(r => r.name === item.resolution);
    for (let attempt = 1; attempt <= 2; attempt++) {
        if (isStopping(j))
            return;
        let b;
        try {
            item.attempt = attempt;
            item.status = '載入網頁';
            item.warnings = [];
            b = await launch(p, j.config.settings.headed);
            running.get(j.id).add(b);
            if (isStopping(j))
                return;
            const saved = j.useAuth ? JSON.parse(await fs.readFile(statePath(p.name), 'utf8')).storage : undefined;
            const options = deviceOptions(p, r);
            const context = await b.newContext({ ...options, storageState: saved });
            await prepare(context, j, p.name);
            const page = await context.newPage();
            page.setDefaultTimeout(30000);
            const response = await page.goto(item.url ?? j.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            if (response && response.status() >= 400)
                throw Error(`HTTP ${response.status()}`);
            if (j.config.settings.readySelector)
                await page.locator(j.config.settings.readySelector).first().waitFor();
            item.status = '捲動與載入圖片';
            const scroll = await page.evaluate(async () => { const start = Date.now(); let stable = 0; for (let i = 0; i < 100 && Date.now() - start < 60000; i++) {
                const before = document.documentElement.scrollHeight;
                window.scrollBy(0, innerHeight * .8);
                await new Promise(r => setTimeout(r, 250));
                if (scrollY + innerHeight >= document.documentElement.scrollHeight - 2 && before === document.documentElement.scrollHeight)
                    stable++;
                else
                    stable = 0;
                if (stable >= 3)
                    return true;
            } return false; });
            if (!scroll)
                item.warnings.push('捲動已達上限，可能有尚未載入的內容');
            const warnings = await page.evaluate(async () => { const notes = []; const timeout = (p) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(Error('timeout')), 15000))]); await Promise.all(Array.from(document.images).map(async (img) => { try {
                if (!img.complete)
                    await timeout(new Promise((resolve, reject) => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', reject, { once: true }); }));
                await timeout(img.decode());
            }
            catch {
                notes.push(`圖片載入失敗：${(img.currentSrc || img.src).slice(0, 180)}`);
            } })); const backgrounds = new Set(); for (const el of document.querySelectorAll('*')) {
                const bg = getComputedStyle(el).backgroundImage;
                for (const match of bg.matchAll(/url\(["']?(.*?)["']?\)/g))
                    backgrounds.add(match[1]);
            } await Promise.all([...backgrounds].map(async (src) => { try {
                const img = new Image();
                img.src = src;
                await timeout(img.decode());
            }
            catch {
                notes.push('背景圖片未完成：' + src.slice(0, 180));
            } })); try {
                await timeout(document.fonts.ready);
            }
            catch {
                notes.push('字型等待逾時');
            } window.scrollTo(0, 0); return notes; });
            item.warnings.push(...warnings);
            await page.waitForTimeout(j.config.settings.extraWaitMs);
            item.status = '擷取畫面';
            const folder = j.urls && j.urls.length > 1
                ? path.posix.join('url-' + String(j.urls.indexOf(item.url) + 1).padStart(3, '0'), p.name)
                : p.name;
            const dir = path.join(captures, j.id, folder);
            await fs.mkdir(dir, { recursive: true });
            const filename = `${r.name}_${r.width}x${r.height}.png`;
            const buffer = await page.screenshot({ path: path.join(dir, filename), fullPage: true, animations: 'disabled', caret: 'hide', timeout: 60000 });
            item.file = `${folder}/${filename}`;
            item.meta = { browserVersion: b.version(), browserChannel: p.browserChannel ?? 'chromium', executablePath: p.browserExecutablePath ?? null, finalUrl: page.url(), ...options, userAgent: await page.evaluate(() => navigator.userAgent), imageWidth: buffer.readUInt32BE(16), imageHeight: buffer.readUInt32BE(20), capturedAt: new Date().toISOString() };
            item.error = undefined;
            item.status = '完成';
            return;
        }
        catch (e) {
            if (isStopping(j))
                return;
            item.error = String(e);
            item.status = '失敗';
        }
        finally {
            if (b) {
                running.get(j.id)?.delete(b);
                await b.close().catch(() => { });
            }
        }
    }
}
function isStopping(job) {
    return job.status === 'cancelling' || job.status === 'cancelled';
}
async function run(job) {
    running.set(job.id, new Set());
    job.status = 'running';
    const queue = job.items.filter(item => item.status !== '完成');
    for (const item of queue) {
        item.status = '等待中';
        delete item.error;
    }
    let next = 0;
    async function worker() {
        while (!isStopping(job) && next < queue.length) {
            const item = queue[next++];
            await capture(job, item);
            await persist(job);
        }
    }
    try {
        const results = await Promise.allSettled([worker(), worker()]);
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected')
            throw failure.reason;
        if (isStopping(job)) {
            for (const item of queue) {
                if (!['完成', '失敗'].includes(item.status))
                    item.status = '已取消';
            }
            job.status = 'cancelled';
        }
        else {
            job.status = queue.some(item => item.status === '失敗') ? 'partial' : 'completed';
        }
    }
    catch (err) {
        job.status = 'failed';
        for (const item of queue.filter(item => item.status !== '完成')) {
            item.status = '失敗';
            item.error = String(err);
        }
    }
    finally {
        try {
            await persist(job);
        }
        finally {
            running.delete(job.id);
        }
    }
}
let starting = false;
async function startBatch(makeJob) {
    if (starting || running.size)
        throw Error('請先完成或取消目前工作');
    starting = true;
    try {
        const job = await makeJob();
        jobs.set(job.id, job);
        void run(job).catch(console.error);
        return job;
    }
    finally {
        starting = false;
    }
}
app.post('/api/jobs', async (req, res) => {
    const job = await startBatch(async () => {
        const input = req.body;
        const urls = parseTargets(input.urls ?? [input.url]);
        const c = await config();
        c.profiles = c.profiles.filter(p => input.profiles?.includes(p.name));
        c.resolutions = c.resolutions.filter(r => input.resolutions?.includes(r.name));
        if (!c.profiles.length || !c.resolutions.length)
            throw Error('至少選一個瀏覽器和尺寸');
        if (input.useAuth) {
            for (const p of c.profiles)
                await fs.access(statePath(p.name));
        }
        const created = new Date().toISOString();
        const id = created.replace(/[:.]/g, '-') + '_' + randomUUID().slice(0, 8);
        const items = [];
        for (const r of c.resolutions) {
            for (const p of c.profiles) {
                for (const target of urls) {
                    items.push({ url: target, profile: p.name, resolution: r.name, status: '等待中', attempt: 0, warnings: [] });
                }
            }
        }
        const job = { id, url: urls[0], urls, created, config: c, items, useAuth: !!input.useAuth, status: 'queued' };
        await fs.mkdir(path.join(captures, id));
        await persist(job);
        return job;
    });
    res.json(job);
});
app.get('/api/jobs', async (_q, s) => { const result = []; for (const dir of await fs.readdir(captures)) {
    try {
        const j = jobs.get(dir) ?? JSON.parse(await fs.readFile(path.join(captures, dir, 'manifest.json'), 'utf8'));
        if (!jobs.has(dir) && ['running', 'queued', 'cancelling'].includes(j.status))
            j.status = 'interrupted';
        result.push(j);
    }
    catch { }
} s.json(result.sort((a, b) => b.created.localeCompare(a.created))); });
app.get('/api/jobs/:id/events', (q, s) => { s.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }); s.flushHeaders(); const tick = () => s.write(`data: ${JSON.stringify(jobs.get(q.params.id) ?? null)}\n\n`); tick(); const timer = setInterval(tick, 600); q.on('close', () => clearInterval(timer)); });
app.post('/api/jobs/:id/cancel', async (q, s) => { const j = jobs.get(q.params.id); if (j && running.has(j.id)) {
    j.status = 'cancelling';
    await Promise.all([...running.get(j.id)].map(b => b.close().catch(() => { })));
} s.json({ ok: true }); });
app.post('/api/jobs/:id/retry', async (req, res) => {
    const id = path.basename(req.params.id);
    res.json(await startBatch(async () => jobs.get(id) ??
        JSON.parse(await fs.readFile(path.join(captures, id, 'manifest.json'), 'utf8'))));
});
app.post('/api/jobs/:id/folder', async (q, s) => { const target = path.join(captures, path.basename(q.params.id)); await fs.access(path.join(target, 'manifest.json')); execFile('explorer.exe', [target]); s.json({ ok: true }); });
app.post('/api/jobs/:id/export', async (q, s) => { const id = path.basename(q.params.id); if (running.has(id))
    throw Error('請等待工作完成後再匯出'); const source = path.join(captures, id); await fs.access(path.join(source, 'manifest.json')); if (typeof q.body.folder !== 'string' || !path.isAbsolute(q.body.folder))
    throw Error('請輸入完整的本機資料夾路徑'); const target = path.join(path.resolve(q.body.folder), id); if (target.startsWith(source + path.sep) || target === source)
    throw Error('請選擇其他輸出資料夾'); await fs.mkdir(q.body.folder, { recursive: true }); await fs.mkdir(target); await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false }); s.json({ path: target }); });
app.use('/captures', express.static(captures, { dotfiles: 'deny', index: false }));
if (process.env.NODE_ENV === 'development') {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
}
else
    app.use(express.static(path.join(root, 'dist')));
app.use((err, _q, s, _n) => { console.error(err); s.status(400).json({ error: err.message ?? String(err) }); });
const server = app.listen(Number(process.env.RWD_CAPTURE_PORT ?? 4317), '127.0.0.1');
server.on('listening', () => {
    const address = server.address();
    if (!address || typeof address === 'string')
        return;
    const origin = 'http://127.0.0.1:' + address.port;
    console.log('RWD Capture: ' + origin);
    if (!process.env.NO_OPEN)
        execFile('cmd.exe', ['/c', 'start', '', origin]);
});
async function shutdown() { for (const a of auth.values())
    await a.browser.close().catch(() => { }); for (const bs of running.values())
    for (const b of bs)
        await b.close().catch(() => { }); server.close(); process.exit(); }
;
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
