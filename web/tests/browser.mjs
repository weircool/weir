import { chromium } from "playwright-core";
import { expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { keccak256, toBytes, formatUnits } from "viem";
import { serve } from "./server.mjs";
import {
  installMock,
  newState,
  CLIENT,
  RECIPIENT,
  OTHER,
  TOKEN,
  imd,
  weir,
  manifest,
} from "./mock-chain.mjs";

const out = fileURLToPath(
  new URL("../../test/scratch/browser/", import.meta.url),
);
await mkdir(out, { recursive: true });
const { server, url } = await serve();
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const results = [];
let failures = 0;
async function scenario(name, run, options = {}) {
  if (
    process.env.WEIR_TEST_MATCH &&
    !name.includes(process.env.WEIR_TEST_MATCH)
  )
    return;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...options,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const state = newState();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installMock(page, state);
  try {
    await run(page, state);
    expect(errors).toEqual([]);
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (e) {
    failures++;
    results.push({
      name,
      passed: false,
      error: e.message,
      browserErrors: errors,
    });
    console.error(`FAIL ${name}: ${e.message}`);
    await page.screenshot({
      path: `${out}/failure-${failures}.png`,
      fullPage: true,
    });
  } finally {
    await context.close();
  }
}
async function open(page, route = "/") {
  await page.goto(`${url}#${route}`);
  await expect(page.locator("main h1")).toBeVisible();
}
async function connect(page) {
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Test browser wallet", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".wallet-button")).toContainText("…");
}
async function action(page, label, confirm = false) {
  await page.getByRole("button", { name: label, exact: true }).click();
  if (confirm)
    await page
      .getByRole("dialog")
      .getByRole("button", { name: label, exact: true })
      .click();
  await expect(
    page.getByRole("button", { name: new RegExp(`${label} ·`) }),
  ).toHaveCount(0);
}
async function navigate(page, route) {
  await page.evaluate((hash) => {
    location.hash = hash;
  }, route);
  await expect(page.locator("main h1")).toBeVisible();
}
async function overflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
await scenario(
  "Static subpath, metadata, mobile first screen and all page reflow",
  async (page) => {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await open(page);
      await overflow(page);
      const create = page.locator(".eligibility a");
      const rect = await create.boundingBox();
      expect(rect.y + rect.height).toBeLessThan(844);
      await expect(page.locator(".wallet-button")).toBeInViewport();
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: `${out}/home-${width}.png`,
          fullPage: true,
        });
      for (const route of ["/create", "/streams", "/records", "/stream/1"]) {
        await navigate(page, route);
        await overflow(page);
      }
    }
    for (const selector of [
      "title",
      'link[rel="icon"]',
      'meta[name="description"]',
      'meta[property="og:title"]',
      'meta[property="og:image"]',
    ])
      await expect(page.locator(selector)).toHaveCount(1);
    const img = await page.request.get(new URL("share.png", url).href);
    expect(img.status()).toBe(200);
  },
);
await scenario(
  "EIP-6963 discovery, exact add-chain fallback and connected eligibility",
  async (page, state) => {
    await open(page);
    await connect(page);
    await expect(page.getByText("Eligible", { exact: true })).toBeVisible();
    expect(
      state.requests.find((r) => r.method === "wallet_addEthereumChain").params,
    ).toEqual([manifest.walletAddChain]);
    expect(
      state.requests.filter((r) => r.method === "wallet_switchEthereumChain"),
    ).toHaveLength(2);
    await expect(
      page.getByText("2.5% of stake", { exact: true }),
    ).toBeVisible();
    await page.locator(".wallet-button").click();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.locator(".wallet-button")).toContainText(
      "Connect wallet",
    );
  },
);
await scenario(
  "Wallet sheet keyboard trap, Escape and focus restoration",
  async (page) => {
    await open(page);
    const button = page.locator(".wallet-button");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => !!document.activeElement.closest("dialog")),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(button).toBeFocused();
    await page.locator(".skip-link").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
    expect(new URL(page.url()).hash).toBe("#/");
  },
);
await scenario(
  "Phone wallet picker exposes all four app links and Coinbase Smart Wallet",
  async (page) => {
    await page.addInitScript(() => {
      delete window.ethereum;
    });
    await open(page);
    await page.locator(".wallet-button").click();
    for (const name of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"])
      await expect(
        page.getByRole("link", { name: `Open in ${name}` }),
      ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Coinbase Smart Wallet", exact: true }),
    ).toBeVisible();
    const rabby = new URL(
      await page
        .getByRole("link", { name: "Open in Rabby" })
        .getAttribute("href"),
    );
    expect(rabby.searchParams.get("_cmd")).toBe("open-dapp");
    expect(rabby.searchParams.get("dapp")).toBe(page.url());
    await overflow(page);
    await page.screenshot({ path: `${out}/phone-wallets.png` });
  },
  {
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  },
);
await scenario(
  "Rejected network switch remains visible and blocks writes",
  async (page, state) => {
    state.rejectSwitch = true;
    await open(page);
    await page.locator(".wallet-button").click();
    await page
      .getByRole("button", { name: "Test browser wallet", exact: true })
      .click();
    await expect(
      page.getByText(/Request declined in your wallet/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await expect(page.locator(".wallet-button")).toContainText(
      "Switch to Robinhood Chain",
    );
    await navigate(page, "/stream/1");
    await expect(
      page.getByRole("button", { name: "Pause stream", exact: true }),
    ).toBeDisabled();
    expect(
      state.requests.some((r) => r.method === "wallet_addEthereumChain"),
    ).toBe(false);
    state.rejectSwitch = false;
    await page.locator(".wallet-button").click();
    await expect(page.locator(".wallet-button")).toContainText("…");
    await expect(
      page.getByRole("button", { name: "Pause stream", exact: true }),
    ).toBeEnabled();
  },
);
await scenario(
  "Create 6-decimal stream: terms hash, approval, pending and encoded amount",
  async (page, state) => {
    await open(page, "/create");
    await connect(page);
    await page.getByLabel("Recipient address").fill(RECIPIENT);
    await page.getByLabel("Token address").fill(TOKEN);
    await expect(page.locator(".token-info")).toContainText(
      "USDC · 6 decimals",
    );
    await page.getByLabel(/^Rate per second/).fill("0.000001");
    await page.getByLabel(/^Initial deposit/).fill("10.123456");
    await page.getByLabel("Terms URI").fill("https://example.org/terms");
    await page
      .getByLabel("Paste the exact terms text")
      .fill("Deliver the agreed work.");
    await expect(page.getByLabel("Terms hash (keccak256)")).toHaveValue(
      keccak256(toBytes("Deliver the agreed work.")),
    );
    await page
      .getByRole("button", { name: "Review stream", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Review your stream" }),
    ).toBeVisible();
    state.delay = 500;
    await page
      .getByRole("button", { name: "Approve USDC", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /Approve USDC ·/ }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Create stream", exact: true }),
    ).toBeEnabled();
    expect(state.transactions.at(-1).args[0].toLowerCase()).toBe(weir);
    expect(state.transactions.at(-1).args[1]).toBe(10123456n);
    await page
      .getByRole("button", { name: "Create stream", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Stream #4", exact: true }),
    ).toBeVisible();
    const tx = state.transactions.find((t) => t.fn === "createStream");
    expect(tx.args[2]).toBe(1n);
    expect(tx.args[3]).toBe(10123456n);
  },
);
await scenario(
  "Terms file bytes and invalid address/precision stop creation",
  async (page) => {
    await open(page, "/create");
    await connect(page);
    await page
      .getByLabel("Or choose the terms file")
      .setInputFiles({
        name: "terms.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Exact file bytes\r\n"),
      });
    await expect(page.getByLabel("Terms hash (keccak256)")).toHaveValue(
      keccak256(toBytes("Exact file bytes\r\n")),
    );
    await page
      .getByRole("button", { name: "Review stream", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("valid, nonzero");
    await expect(page.getByLabel("Recipient address")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByLabel("Recipient address")).toBeFocused();
    await page.getByLabel("Recipient address").fill(RECIPIENT);
    await page.getByLabel("Token address").fill(TOKEN);
    await expect(page.locator(".token-info")).toContainText("6 decimals");
    await page.getByLabel(/^Rate per second/).fill("0.0000001");
    await page.getByLabel(/^Initial deposit/).fill("1");
    await page.getByLabel("Terms URI").fill("https://example.org/terms");
    await page
      .getByRole("button", { name: "Review stream", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("at most 6 decimal");
  },
);
await scenario(
  "Court sponsorship stages IMD approval, shows rejection, then confirms",
  async (page, state) => {
    await open(page);
    await connect(page);
    await page.getByRole("button", { name: /Sponsor the court fund/ }).click();
    await page.getByLabel("Sponsorship (IMD)").fill("2");
    state.rejectNext = true;
    await page
      .getByRole("button", { name: "Approve IMD", exact: true })
      .click();
    await expect(
      page.getByText(/Request declined in your wallet/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Approve IMD", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Sponsor", exact: true }),
    ).toBeEnabled();
    await action(page, "Sponsor");
    expect(state.fund).toBe(2n * 10n ** 18n);
    await expect(page.locator(".fund-value")).toContainText("2 IMD");
  },
);
await scenario(
  "Client: deposit, pause, restart, adjust, refund, max refund and void",
  async (page, state) => {
    await open(page, "/stream/1");
    await connect(page);
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeEnabled();
    await action(page, "Pause");
    expect(state.streams.get(1n).rate).toBe(0n);
    // Rates are entered per day or week; 1.728 USDC/day is 20 units/second.
    await page.getByLabel("Rate (USDC)").fill("1.728");
    await action(page, "Restart at this rate");
    expect(state.streams.get(1n).rate).toBe(20n);
    await page.getByLabel("New rate (USDC)").fill("18.144");
    await page.getByRole("radio", { name: "per week" }).click();
    await action(page, "Change the rate");
    expect(state.streams.get(1n).rate).toBe(30n);
    await page.getByLabel("Deposit (USDC)").fill("5");
    await action(page, "Approve USDC");
    await expect(
      page.getByRole("button", { name: "Deposit", exact: true }),
    ).toBeEnabled();
    await action(page, "Deposit");
    expect(state.streams.get(1n).balance).toBe(105000000n);
    await page.getByLabel("Refund amount (USDC)").fill("1");
    await action(page, "Refund amount");
    await action(page, "Refund max", true);
    expect(state.streams.get(1n).balance).toBe(20000000n);
    await action(page, "Stop and take back the rest", true);
    await expect(page.locator(".badge")).toHaveText("Closed");
  },
);
await scenario(
  "Recipient: accept, withdraw amount, withdraw max and claim deferred payout",
  async (page, state) => {
    state.account = RECIPIENT;
    state.claimable = 1000000n;
    await open(page, "/stream/1");
    await connect(page);
    await expect(
      page.getByRole("heading", { name: "Client controls" }),
    ).toHaveCount(0);
    await action(page, "Accept terms", true);
    expect(state.accepted.has(1n)).toBe(true);
    await page.getByLabel("Withdrawal amount (USDC)").fill("1.25");
    await action(page, "Withdraw amount");
    expect(state.streams.get(1n).withdrawn).toBe(6250000n);
    await action(page, "Withdraw max");
    expect(state.streams.get(1n).withdrawn).toBe(20000000n);
    await action(page, "Claim USDC payout");
    expect(state.claimable).toBe(0n);
  },
);
await scenario(
  "Dispute exact preview, staged token and IMD approvals, bounded bond",
  async (page, state) => {
    await open(page, "/stream/1");
    await connect(page);
    await page.getByRole("button", { name: "Review a dispute" }).click();
    await page.getByLabel("Dispute note").fill("The work is incomplete.");
    await page
      .getByRole("button", { name: "Review dispute", exact: true })
      .click();
    await expect(page.locator(".question")).toContainText(
      "The work is incomplete.",
    );
    await expect(page.locator(".dispute-review")).toContainText(
      "You, the caller",
    );
    await expect(
      page.getByRole("button", { name: "Raise dispute", exact: true }),
    ).toBeDisabled();
    state.delay = 400;
    await page
      .getByRole("button", { name: "Approve USDC", exact: true })
      .click();
    await expect(page.getByLabel("Dispute note")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Approve USDC", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Dispute note")).toBeEnabled();
    await action(page, "Approve IMD");
    await expect(
      page.getByRole("button", { name: "Raise dispute", exact: true }),
    ).toBeEnabled();
    await action(page, "Raise dispute");
    expect(state.transactions.at(-1).args).toEqual([
      1n,
      "The work is incomplete.",
      2375000n,
    ]);
    await expect(page.locator(".title-row .badge")).toHaveText("Disputed");
    await expect(
      page.getByRole("button", { name: "Expire dispute", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("link", { name: "View oracle request", exact: false }),
    ).toHaveAttribute(
      "href",
      "https://explorer.imd.fun/jobs/12345678-1234-4abc-8def-123456789abc",
    );
  },
);
await scenario(
  "IMD stream merges bond and fee into a single exact allowance",
  async (page, state) => {
    const s = state.streams.get(1n);
    s.token = imd;
    s.balance = 100n * 10n ** 18n;
    s.withdrawn = 0n;
    s.snapDebt = 20n * 10n ** 18n;
    await open(page, "/stream/1");
    await connect(page);
    await page.getByRole("button", { name: "Review a dispute" }).click();
    await page.getByLabel("Dispute note").fill("Please review delivery.");
    await page
      .getByRole("button", { name: "Review dispute", exact: true })
      .click();
    await expect(page.locator(".dispute-approval")).toHaveCount(1);
    await action(page, "Approve IMD");
    expect(state.transactions.at(-1).args[1]).toBe(3n * 10n ** 18n);
    await expect(
      page.getByRole("button", { name: "Raise dispute", exact: true }),
    ).toBeEnabled();
  },
);
await scenario(
  "Fund-paid dispute skips fee approval and rechecks a changed payer",
  async (page, state) => {
    state.fund = 10n ** 18n;
    await open(page, "/stream/1");
    await connect(page);
    await page.getByRole("button", { name: "Review a dispute" }).click();
    await page
      .getByRole("button", { name: "Review dispute", exact: true })
      .click();
    await expect(page.locator(".dispute-review")).toContainText(
      "The court fund",
    );
    await expect(
      page.getByRole("button", { name: "Approve IMD", exact: true }),
    ).toHaveCount(0);
    await action(page, "Approve USDC");
    state.fund = 0n;
    await page
      .getByRole("button", { name: "Raise dispute", exact: true })
      .click();
    await expect(page.getByText(/fee payer changed/)).toBeVisible();
    expect(state.transactions.some((t) => t.fn === "dispute")).toBe(false);
  },
);
await scenario(
  "Anyone can enforce or expire strictly after timeout",
  async (page, state) => {
    state.account = OTHER;
    await open(page, "/stream/2");
    await connect(page);
    await expect(
      page.getByRole("button", { name: "Expire dispute", exact: true }),
    ).toBeEnabled();
    await action(page, "Expire dispute", true);
    await expect(page.locator(".title-row .badge")).toHaveText("Paused");
    await navigate(page, "/stream/3");
    await action(page, "Enforce ruling", true);
    await expect(page.locator(".title-row .badge")).toHaveText("Active");
  },
);
await scenario(
  "Custom contract error prevents signature and remains actionable",
  async (page, state) => {
    await open(page, "/stream/1");
    await connect(page);
    state.forcedError = "HoldRequired";
    await page
      .getByRole("button", { name: "Pause stream", exact: true })
      .click();
    await expect(
      page.getByText(/Hold the required WEIR balance/),
    ).toBeVisible();
    expect(state.transactions).toHaveLength(0);
  },
);
await scenario(
  "StreamCreated lists both roles, live values and address records",
  async (page, state) => {
    await open(page, "/streams");
    await connect(page);
    await expect(
      page.getByRole("link", { name: "Stream #1", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".stream-row").first()).toContainText("USDC");
    await page
      .getByRole("button", { name: "As recipient", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "No recipient streams in these blocks",
      }),
    ).toBeVisible();
    await navigate(page, "/records");
    await page.getByLabel("Wallet address").fill(RECIPIENT);
    await page
      .getByRole("button", { name: "Look up records", exact: true })
      .click();
    await expect(page.locator(".record-grid")).toContainText("Client wins");
    await expect(page.locator(".record-grid dd").first()).toHaveText("2");
    state.account = RECIPIENT;
    await page.evaluate(
      (a) => window.weirMockEmit("accountsChanged", [a]),
      RECIPIENT,
    );
    await navigate(page, "/streams");
    await page
      .getByRole("button", { name: "As recipient", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Stream #1", exact: true }),
    ).toBeVisible();
  },
);
await scenario(
  "Missing code disables signing, including with a connected wallet",
  async (page, state) => {
    state.code = "0x";
    await open(page, "/stream/1");
    await connect(page);
    await expect(page.locator(".verification-error")).toContainText(
      "No deployed code",
    );
    await expect(
      page.getByRole("button", { name: "Pause stream", exact: true }),
    ).toHaveCount(0);
    expect(state.transactions).toHaveLength(0);
  },
);
await scenario(
  "Long connected values, mobile dialog, reduced motion and reflow",
  async (page, state) => {
    state.holdings = 1n << 200n;
    await open(page);
    await connect(page);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await overflow(page);
      await navigate(page, "/stream/1");
      await overflow(page);
      await page.screenshot({
        path: `${out}/stream-${width}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Review a dispute" }).click();
      await page.getByLabel("Dispute note").fill("é".repeat(141));
      await expect(
        page.getByRole("button", { name: "Review dispute", exact: true }),
      ).toBeDisabled();
      await overflow(page);
      await page.keyboard.press("Escape");
      await navigate(page, "/");
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector("button")).transitionDuration,
      ),
    ).toBe("0s");
  },
);
async function fillCreate(page) {
  await page.getByLabel("Who are you paying?").fill(RECIPIENT);
  await page.getByLabel(/^Total/).fill("25");
  await page
    .getByLabel("What are they delivering, by when?")
    .fill("Deliver the agreed work by Friday.");
}
async function approveAndCreate(page) {
  await page.getByRole("button", { name: "Approve USDC", exact: true }).click();
  await page.getByRole("button", { name: "Create stream", exact: true }).click();
}
await scenario(
  "Hold: on by default, create then pause, client starts once accepted",
  async (page, state) => {
    await open(page, "/create");
    await connect(page);
    await fillCreate(page);
    await expect(page.getByLabel("Hold until they accept")).toBeChecked();
    await page.getByRole("button", { name: "Check it over", exact: true }).click();
    await expect(page.locator(".review-surface")).toContainText(
      "When they accept and you start it",
    );
    await expect(page.locator(".review-surface")).toContainText("Three wallet steps");
    await approveAndCreate(page);
    await expect(
      page.getByRole("heading", { name: "Stream created and on hold" }),
    ).toBeVisible();
    expect(state.transactions.slice(-2).map((t) => t.fn)).toEqual([
      "createStream",
      "pause",
    ]);
    expect(state.transactions.at(-1).args[0]).toBe(4n);
    const s = state.streams.get(4n);
    expect(s.rate).toBe(0n);
    expect(s.pausedRate > 0n).toBe(true);
    await page.getByRole("link", { name: "Open stream #4" }).click();
    await expect(
      page.getByRole("heading", { name: "Stream #4", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".badge")).toHaveText("Paused");
    await expect(
      page.getByText("On hold. Nothing streams until you start it."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start streaming", exact: true }),
    ).toHaveCount(0);
    // The recipient accepts (simulated on the mock chain); the client refreshes and starts.
    state.accepted.set(4n, 1n);
    await page.getByRole("button", { name: "Refresh now", exact: true }).click();
    await expect(page.getByText("The recipient accepted the terms")).toBeVisible();
    await action(page, "Start streaming");
    expect(state.transactions.at(-1).fn).toBe("restart");
    expect(state.transactions.at(-1).args).toEqual([4n, s.pausedRate]);
    await expect(page.locator(".badge")).toHaveText("Active");
  },
);
await scenario(
  "Hold: the recipient of a held stream is told to accept",
  async (page, state) => {
    const s = state.streams.get(1n);
    s.pausedRate = s.rate;
    s.rate = 0n;
    state.account = RECIPIENT;
    await open(page, "/stream/1");
    await connect(page);
    await expect(
      page.getByText("The client is holding this stream until you accept the terms."),
    ).toBeVisible();
    await action(page, "Accept terms", true);
    await expect(page.getByText("The client is holding this stream")).toHaveCount(0);
  },
);
await scenario(
  "Hold: switched off, create goes straight to the stream with no pause",
  async (page, state) => {
    await open(page, "/create");
    await connect(page);
    await fillCreate(page);
    await page.getByLabel("Hold until they accept").uncheck();
    await page.getByRole("button", { name: "Check it over", exact: true }).click();
    await expect(page.locator(".review-surface")).toContainText("Right away");
    await approveAndCreate(page);
    await expect(
      page.getByRole("heading", { name: "Stream #4", exact: true }),
    ).toBeVisible();
    expect(state.transactions.map((t) => t.fn)).not.toContain("pause");
    await expect(page.locator(".badge")).toHaveText("Active");
  },
);
await browser.close();
await new Promise((r) => server.close(r));
const evidence = {
  manifestSha256: createHash("sha256").update(await readFile(new URL('../../dist/imd-deployment.json', import.meta.url))).digest('hex'),
  testedAt: new Date().toISOString(),
  mode: "Production export, local static subpath, mocked EIP-1193 wallet and JSON-RPC; no funded transactions",
  passed: results.filter((r) => r.passed).length,
  failed: failures,
  results,
};
await mkdir(new URL("../../docs/validation/", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL("../../docs/validation/browser-tests.json", import.meta.url),
  JSON.stringify(evidence, null, 2) + "\n",
);
if (failures) process.exitCode = 1;
