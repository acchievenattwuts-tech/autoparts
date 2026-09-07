/* Run after npm run build: node scripts/test-print-pagination.cjs
 * Uses an isolated headless Chromium profile and synthetic documents only.
 * Set PRINT_TEST_BROWSER to a Chrome/Edge executable on other machines.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { build } = require("esbuild");

const repo = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "autoparts-print-pagination-"));
const browserPath = process.env.PRINT_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  let browser, socket, server;
  try {
    assert.ok(fs.existsSync(browserPath), "Set PRINT_TEST_BROWSER to a Chromium executable");
    const bundle = await build({ entryPoints: [path.join(__dirname, "fixtures/print-pagination.jsx")], bundle: true, write: false, platform: "browser", jsx: "automatic", tsconfig: path.join(repo, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "local-image", setup(builder) {
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react'; export default function Image({fill,unoptimized,priority,...props}) { return React.createElement('img',props); }", resolveDir: repo }));
    } }] });
    const cssDir = path.join(repo, ".next/static/css");
    assert.ok(fs.existsSync(cssDir), "Run npm run build first to produce the actual application CSS");
    const css = fs.readdirSync(cssDir).filter((name) => name.endsWith(".css")).map((name) => fs.readFileSync(path.join(cssDir, name), "utf8")).join("\n") + "\n" + fs.readFileSync(path.join(repo, "components/shared/print-pagination.css"), "utf8");
    server = http.createServer((request, response) => {
      const route = new URL(request.url, "http://localhost").pathname;
      if (route === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (route === "/style.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
      else if (route.startsWith("/media/")) {
        const file = path.join(repo, ".next/static/media", path.basename(route));
        response.end(fs.existsSync(file) ? fs.readFileSync(file) : "");
      } else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end('<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${temporary}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
    const portFile = path.join(temporary, "DevToolsActivePort");
    for (let tries = 0; !fs.existsSync(portFile) && tries < 100; tries++) await pause(100);
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve) => { socket.onopen = resolve; });
    let sequence = 0;
    const pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const job = pending.get(message.id); pending.delete(message.id); clearTimeout(job.timer);
      if (message.error) job.reject(message.error); else job.resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => reject(new Error(`Timed out: ${method}`)), 30000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
    };
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 1300, deviceScaleFactor: 1, mobile: false });
    const cases = ["mode=sale&rows=1", "mode=sale&rows=0", "mode=sale&rows=60&verify=1", "mode=cash&rows=60", "mode=quotation&rows=60", "mode=receipt&rows=60", "mode=advance&rows=60", "mode=refund&rows=60", "mode=claim&rows=1", "mode=report&rows=90", "mode=sale&rows=2&long=1", "mode=sale&rows=60&dark=1", "mode=sale&rows=30&copyRoot=1", "mode=sale&rows=30&copyRoot=1&copies=1", "mode=sale&rows=60&external=1"];
    for (const query of cases) {
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?${query}` });
      await pause(300);
      await evaluate(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{const roots=[...document.querySelectorAll('[data-print-paginated]')];if(roots.some(r=>r.dataset.printError)){clearInterval(timer);reject(Error(roots.find(r=>r.dataset.printError).dataset.printError));}else if(roots.length&&roots.every(r=>r.dataset.printReady)){clearInterval(timer);resolve(true);}else if(tries++>150){clearInterval(timer);reject(Error('Not ready'));}},100);})`);
      const before = await evaluate(`(() => {const roots=[...document.querySelectorAll('[data-print-paginated]')];return roots.map(root=>({pages:root.querySelectorAll('.print-pagination-pages .print-paper').length,source:root.querySelector('.print-pagination-source').textContent,body:[...root.querySelectorAll('.print-pagination-pages .print-paper-body')].map(b=>b.textContent).join(''),shown:getComputedStyle(root).display!=='none'}));})()`);
      if (query.includes("copyRoot")) assert.equal(before[1].shown, false, "Copy must stay hidden in screen preview");
      const args = new URLSearchParams(query);
      if (args.get("mode") !== "claim") {
        const codes = before[0].body.match(/ITEM-\d+/g) ?? [];
        assert.equal(codes.length, Number(args.get("rows")), "Every item occurs exactly once");
        assert.equal(new Set(codes).size, codes.length, "No duplicated rows");
      }
      if (args.has("long")) {
        const descriptions = await evaluate(`(() => { const texts = selector => [...document.querySelectorAll(selector)].map(row=>row.cells[2]?.textContent??'').join('');return {before:texts('.print-pagination-source > table tbody tr'),after:texts('.print-pagination-pages .print-paper-body tbody tr')};})()`);
        assert.equal(descriptions.after, descriptions.before, "Long row fragments preserve every character");
      }
      await send("Emulation.setEmulatedMedia", { media: "print" });
      await evaluate("window.dispatchEvent(new Event('beforeprint'))");
      const layout = await evaluate(`(() => {const roots=[...document.querySelectorAll('[data-print-paginated]')].filter(r=>getComputedStyle(r).display!=='none');const pages=roots.flatMap(r=>[...r.querySelectorAll('.print-pagination-pages .print-paper')]);return {error:roots.map(r=>r.dataset.printError).filter(Boolean),count:pages.length,overflow:pages.some(p=>{const b=p.querySelector('.print-paper-body').getBoundingClientRect(),f=p.querySelector('.print-paper-footer').getBoundingClientRect();return b.bottom>f.top-1||f.bottom>p.getBoundingClientRect().bottom-1;}),labels:pages.every(p=>p.querySelector('[data-print-page-label]')?.textContent.includes('/'))};})()`);
      assert.deepEqual(layout.error, []); assert.equal(layout.overflow, false); assert.equal(layout.labels, true);
      const pdf = Buffer.from((await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false })).data, "base64");
      const physicalPages = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
      assert.equal(physicalPages, layout.count, "No blank or footer-only physical pages");
      fs.writeFileSync(path.join(temporary, `${args.get("mode")}-${cases.indexOf(query)}.pdf`), pdf);
      await send("Emulation.setEmulatedMedia", { media: "" });
      console.log(`PASS ${query}: ${physicalPages} pages`);
    }
    console.log(`PDF evidence: ${temporary}`);
    await send("Browser.close").catch(() => undefined);
  } finally { socket?.close(); server?.close(); browser?.kill(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
