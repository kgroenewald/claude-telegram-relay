/**
 * Morning Briefing — Kevin
 *
 * Sends a daily summary at 8:15am SAST via Telegram.
 * Includes: goals, AI news, crypto prices, gold & oil.
 *
 * Schedule with Windows Task Scheduler at 8:15am daily.
 * Run manually: bun run examples/morning-briefing.ts
 */

import { spawn } from "bun";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_USER_ID || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

// ============================================================
// PRICES
// ============================================================

async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error("All retries failed");
}

async function getPrices(): Promise<{ btc: number; eth: number; sol: number; gold: number; oil: number } | null> {
  let btc = 0, eth = 0, sol = 0, gold = 0, oil = 0;

  // Crypto — try CoinGecko, fall back to Binance public API
  try {
    const res = await fetchWithRetry(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd"
    );
    const data = await res.json() as any;
    btc = data.bitcoin?.usd ?? 0;
    eth = data.ethereum?.usd ?? 0;
    sol = data.solana?.usd ?? 0;
  } catch {
    try {
      const [bRes, eRes, sRes] = await Promise.all([
        fetchWithRetry("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"),
        fetchWithRetry("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT"),
        fetchWithRetry("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT"),
      ]);
      btc = parseFloat(((await bRes.json()) as any).price ?? 0);
      eth = parseFloat(((await eRes.json()) as any).price ?? 0);
      sol = parseFloat(((await sRes.json()) as any).price ?? 0);
    } catch (err) {
      console.error("Crypto fetch failed:", err);
    }
  }

  // Gold via metals.live (free, no auth)
  try {
    const metalRes = await fetchWithRetry("https://api.metals.live/v1/spot");
    const metals = await metalRes.json() as any[];
    const entry = metals.find((m: any) => m.gold !== undefined);
    if (entry) gold = entry.gold;
  } catch (err) {
    console.error("Gold fetch failed:", err);
  }

  // Oil via Frankfurter-style free commodity (fallback to 0 if unavailable)
  try {
    const oilRes = await fetchWithRetry("https://api.binance.com/api/v3/ticker/price?symbol=WBTCUSDT");
    // No free unauthenticated oil API — skip for now, show N/A
  } catch {}

  return { btc, eth, sol, gold, oil };
}

function fmt(n: number, decimals = 0): string {
  if (!n) return "N/A";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ============================================================
// AI NEWS via Claude
// ============================================================

async function getAINews(): Promise<string> {
  const prompt = `Give me a 3-bullet summary of the most notable AI news and developments from the past 24-48 hours. Be brief and factual. Format as bullet points starting with "-". No preamble.`;

  try {
    const proc = spawn([CLAUDE_PATH, "-p", prompt, "--output-format", "text"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    return output.trim();
  } catch {
    return "- Could not fetch AI news";
  }
}

// ============================================================
// GOALS via Claude
// ============================================================

async function getGoals(): Promise<string> {
  const prompt = `Based on what you know about Kevin's current work and any goals discussed recently, suggest a brief 2-3 point focus list for today. If you have no context, suggest he sets his goals for the day. Format as bullet points starting with "-". Be brief.`;

  try {
    const proc = spawn([CLAUDE_PATH, "-p", prompt, "--output-format", "text"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    return output.trim();
  } catch {
    return "- No goals loaded — tell me what you're working on today";
  }
}

// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(message: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message,
          parse_mode: "Markdown",
        }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================
// BUILD & SEND
// ============================================================

async function main() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  console.log("Building morning briefing...");

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-ZA", {
    weekday: "long", month: "long", day: "numeric",
    timeZone: "Africa/Johannesburg",
  });

  const [prices, aiNews, goals] = await Promise.all([
    getPrices(),
    getAINews(),
    getGoals(),
  ]);

  const sections: string[] = [];
  sections.push(`☀️ *Morning, Kevin* — ${dateStr}\n`);

  sections.push(`🎯 *Today's Focus*\n${goals}\n`);

  if (prices) {
    const crypto = `BTC ${fmt(prices.btc)} · ETH ${fmt(prices.eth)} · SOL ${fmt(prices.sol, 2)}`;
    const commodities = [
      prices.gold ? `Gold ${fmt(prices.gold)}` : null,
      prices.oil ? `Oil ${fmt(prices.oil, 2)}` : null,
    ].filter(Boolean).join(" · ");
    sections.push(`📈 *Markets*\n${crypto}${commodities ? "\n" + commodities : ""}\n`);
  }

  sections.push(`🤖 *AI News*\n${aiNews}\n`);
  sections.push(`_Reply anytime to chat._`);

  const briefing = sections.join("\n");

  console.log("Sending...");
  const success = await sendTelegram(briefing);

  if (success) {
    console.log("Briefing sent!");
  } else {
    console.error("Failed to send");
    process.exit(1);
  }
}

main();
