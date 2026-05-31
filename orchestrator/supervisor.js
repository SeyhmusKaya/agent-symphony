// Denetimli orkestrator yeniden baslatici.
// restart_self bunu spawn eder. Yeni surum ayaga kalkmazsa son saglam
// git surumune geri doner ve tekrar baslatir.
// Kullanim: node supervisor.js <port> <repoRoot> <lastGoodSha> <nodeExec> <argvJson>

const { spawn, execSync } = require("node:child_process");
const net = require("node:net");

const [, , portStr, repoRoot, lastGoodSha, nodeExec, argvJson] = process.argv;
const port = Number(portStr);
const childArgs = JSON.parse(argvJson);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portUp() {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    const done = (val) => {
      sock.destroy();
      resolve(val);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => resolve(false));
    sock.setTimeout(2000, () => done(false));
  });
}

function startOrchestrator() {
  const child = spawn(nodeExec, childArgs, {
    detached: true,
    stdio: "ignore",
    cwd: repoRoot,
    windowsHide: true,
  });
  child.unref();
}

async function waitUp(tries) {
  for (let i = 0; i < tries; i++) {
    await sleep(3000);
    if (await portUp()) return true;
  }
  return false;
}

(async () => {
  await sleep(5000); // eski surec cikip lock'u biraksin

  startOrchestrator();
  if (await waitUp(15)) {
    process.exit(0); // 45s icinde ayakta — basarili
  }

  // Yeni surum ayaga kalkmadi — son saglam surume geri don.
  if (lastGoodSha && lastGoodSha !== "none") {
    try {
      execSync(`git reset --hard ${lastGoodSha}`, { cwd: repoRoot });
    } catch {
      /* yoksay */
    }
    await sleep(2000);
    startOrchestrator();
    await waitUp(15);
  }
  process.exit(0);
})();
