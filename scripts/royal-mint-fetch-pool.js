/**
 * Параллельный запуск fetch-royal-mint-coin-test.js (несколько Chromium сразу).
 * Логи помечаются префиксом [i/n#wK], чтобы не путать вывод воркеров.
 *
 * Осторожно: много параллельных браузеров = нагрузка на CPU/RAM и риск лимитов на стороне RM.
 * По умолчанию в скриптах очереди: 2. Разумный максимум обычно 4.
 */
const { spawn } = require("child_process");

function attachPrefixedLines(stream, prefix, out) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      out.write(prefix + buf.slice(0, idx) + "\n");
      buf = buf.slice(idx + 1);
    }
  });
  return () => {
    if (buf.length) out.write(prefix + buf + (buf.endsWith("\n") ? "" : "\n"));
    buf = "";
  };
}

function runOneFetch({ root, fetchScript, url, noImages, jobLabel }) {
  return new Promise((resolve) => {
    const args = [fetchScript];
    if (noImages) args.push("--no-images");
    args.push(url);
    const pfx = `[${jobLabel}] `;
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    const flushOut = attachPrefixedLines(child.stdout, pfx, process.stdout);
    const flushErr = attachPrefixedLines(child.stderr, pfx, process.stderr);
    child.on("error", (e) => {
      flushOut();
      flushErr();
      process.stderr.write(pfx + "spawn error: " + e.message + "\n");
      resolve(false);
    });
    child.on("close", (code) => {
      flushOut();
      flushErr();
      resolve(code === 0);
    });
  });
}

/**
 * @param {{ urls: string[], root: string, fetchScript: string, noImages: boolean, concurrency: number }} opts
 * @returns {Promise<{ success: number, fail: number }>}
 */
async function runRoyalMintFetchPool(opts) {
  const { urls, root, fetchScript, noImages } = opts;
  let conc = Number(opts.concurrency);
  if (!Number.isFinite(conc) || conc < 1) conc = 1;
  if (conc > 12) conc = 12;

  const n = urls.length;
  if (n === 0) return { success: 0, fail: 0 };

  let next = 0;
  let success = 0;
  let fail = 0;
  const workers = Math.min(conc, n);

  async function worker(workerId) {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= n) break;
      const url = urls[i];
      const label = `${i + 1}/${n}#w${workerId}`;
      process.stdout.write(`\n——— старт ${label} ———\n${url}\n`);
      const ok = await runOneFetch({ root, fetchScript, url, noImages, jobLabel: label });
      if (ok) success += 1;
      else fail += 1;
    }
  }

  await Promise.all(Array.from({ length: workers }, (_, k) => worker(k + 1)));
  return { success, fail };
}

module.exports = { runRoyalMintFetchPool, runOneFetch };
