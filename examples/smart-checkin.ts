/**
 * Smart Check-in — Kevin
 *
 * Runs every 30 minutes (9am–6pm SAST).
 * Claude decides whether to reach out based on goals and time of day.
 *
 * Schedule with Windows Task Scheduler.
 * Run manually: bun run examples/smart-checkin.ts
 */

import { spawn } from "bun";
import { readFile, writeFile } from "fs/promises";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_USER_ID || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const STATE_FILE = process.env.CHECKIN_STATE_FILE || "C:/Users/keving/.claude-relay/checkin-state.json";

// ============================================================
// STATE
// ============================================================

interface CheckinState {
  lastCheckinTime: string;
  lastMessageTime: string;
}

async function loadState(): Promise<CheckinState> {
  try {
    const content = await readFile(STATE_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return { lastCheckinTime: "", lastMessageTime: new Date().toISOString() };
  }
}

async function saveState(state: CheckinState): Promise<void> {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
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
        body: JSON.stringify({ chat_id: CHAT_ID, text: message }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================
// CLAUDE DECISION
// ============================================================

async function askClaude(): Promise<{ shouldCheckin: boolean; message: string }> {
  const state = await loadState();

  const now = new Date();
  const sastHour = now.getUTCHours() + 2; // SAST = UTC+2
  const timeStr = now.toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg" });

  const lastCheckin = state.lastCheckinTime
    ? `${Math.round((now.getTime() - new Date(state.lastCheckinTime).getTime()) / 60000)} minutes ago`
    : "never";

  const prompt = `You are a smart assistant for Kevin, a software engineer in Cape Town.

CONTEXT:
- Current SAST time: ${timeStr}
- Last check-in: ${lastCheckin}
- Kevin's morning drop-off is at 7:30am, briefing arrives at 8:15am

RULES:
1. Max 2-3 check-ins per day — don't be annoying
2. Only check in if there's a real reason (end of day wrap-up, mid-day nudge if silent for 3+ hours, etc.)
3. Keep it brief and casual — Kevin is a dev, not a client
4. Between 12pm-1pm is a good nudge window if no recent activity
5. After 5pm is a good time to suggest wrapping up
6. If last check-in was less than 2 hours ago, almost certainly say NO
7. If nothing interesting to say, say NO

RESPOND IN THIS EXACT FORMAT:
DECISION: YES or NO
MESSAGE: [your message if YES, or "none" if NO]
REASON: [one line why]`;

  try {
    const proc = spawn([CLAUDE_PATH, "-p", prompt, "--output-format", "text"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();

    const decisionMatch = output.match(/DECISION:\s*(YES|NO)/i);
    const messageMatch = output.match(/MESSAGE:\s*(.+?)(?=\nREASON:|$)/is);
    const reasonMatch = output.match(/REASON:\s*(.+)/is);

    const shouldCheckin = decisionMatch?.[1]?.toUpperCase() === "YES";
    const message = messageMatch?.[1]?.trim() || "";
    const reason = reasonMatch?.[1]?.trim() || "";

    console.log(`Decision: ${shouldCheckin ? "YES" : "NO"} — ${reason}`);
    return { shouldCheckin, message };
  } catch (err) {
    console.error("Claude error:", err);
    return { shouldCheckin: false, message: "" };
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  // Only run 9am–6pm SAST
  const sastHour = new Date().getUTCHours() + 2;
  if (sastHour < 9 || sastHour >= 18) {
    console.log(`Outside active hours (SAST ${sastHour}:xx) — skipping`);
    process.exit(0);
  }

  console.log("Running smart check-in...");
  const { shouldCheckin, message } = await askClaude();

  if (shouldCheckin && message && message.toLowerCase() !== "none") {
    const success = await sendTelegram(message);
    if (success) {
      const state = await loadState();
      state.lastCheckinTime = new Date().toISOString();
      await saveState(state);
      console.log("Check-in sent!");
    } else {
      console.error("Failed to send");
    }
  } else {
    console.log("No check-in needed");
  }
}

main();
