const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const URLS_FILE = path.join(__dirname, "germania-mint-bars-urls.txt");

function readUrls(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

function main() {
  const urls = readUrls(URLS_FILE);
  if (!urls.length) {
    console.error("Нет URL в", URLS_FILE);
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    process.stdout.write(`[${i + 1}/${urls.length}] ${url}\n`);
    const res = spawnSync("node", [path.join(__dirname, "fetch-germania-mint-bar.js"), url], {
      stdio: "inherit",
      env: process.env,
    });
    if (res.status === 0) ok += 1;
    else fail += 1;
  }

  console.log(`\nГотово: OK=${ok}, FAIL=${fail}`);
  if (fail > 0) process.exit(2);
}

main();

