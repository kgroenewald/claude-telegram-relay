/**
 * Actions Module
 *
 * Human-in-the-loop action confirmation via Telegram inline buttons.
 * Claude proposes actions using [ACTION: ...] tags; the relay intercepts them,
 * renders Yes/No buttons, and executes the action only after user approval.
 *
 * Supported action types:
 *   [ACTION: confirm | text: <question>]
 *   [ACTION: save_fact | text: <description> | data: <fact to store>]
 *   [ACTION: save_goal | text: <description> | data: <goal text>]
 *   [ACTION: send_message | text: <description> | data: <exact message to send>]
 */

import { InlineKeyboard } from "grammy";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ActionType =
  | "confirm"
  | "save_goal"
  | "save_fact"
  | "send_message";

export interface ParsedAction {
  type: ActionType;
  text: string; // human-readable label shown in message
  data: string; // payload for execution (falls back to text if omitted)
}

export interface PendingAction {
  action: ParsedAction;
  chatId: number;
  createdAt: number;
}

const ACTION_REGEX =
  /\[ACTION:\s*(\w+)\s*(?:\|\s*text:\s*([^|\]]+?))?\s*(?:\|\s*data:\s*([^\]]+?))?\s*\]/gi;

/**
 * Parse Claude's response for [ACTION: ...] tags.
 * Strips ALL tags from the clean response; returns only the first action.
 */
export function parseActionIntents(response: string): {
  clean: string;
  action: ParsedAction | null;
} {
  let firstAction: ParsedAction | null = null;
  let clean = response;

  for (const match of response.matchAll(ACTION_REGEX)) {
    const type = match[1].toLowerCase() as ActionType;
    const text = match[2]?.trim() || "";
    const data = match[3]?.trim() || text;

    if (!firstAction && isValidActionType(type)) {
      firstAction = { type, text, data };
    }

    clean = clean.replace(match[0], "");
  }

  return { clean: clean.trim(), action: firstAction };
}

function isValidActionType(type: string): type is ActionType {
  return ["confirm", "save_goal", "save_fact", "send_message"].includes(type);
}

/**
 * Build a grammY InlineKeyboard for a given action.
 * Callback data is `action:yes` / `action:no` — message_id is the Map key in relay.
 */
export function buildInlineKeyboard(action: ParsedAction): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  switch (action.type) {
    case "save_fact":
    case "save_goal":
      keyboard.text("✅ Save", "action:yes").text("❌ Skip", "action:no");
      break;
    case "send_message":
      keyboard.text("✅ Send it", "action:yes").text("❌ Cancel", "action:no");
      break;
    case "confirm":
    default:
      keyboard.text("✅ Yes", "action:yes").text("❌ No", "action:no");
  }

  return keyboard;
}

/**
 * Execute an approved (or rejected) action.
 * Returns a short result string to edit into the original message.
 */
export async function executeAction(
  supabase: SupabaseClient | null,
  botToken: string,
  chatId: number,
  action: ParsedAction,
  approved: boolean
): Promise<string> {
  if (!approved) return "❌ Skipped.";

  switch (action.type) {
    case "save_fact": {
      if (!supabase) return "⚠️ Memory not available (Supabase not configured).";
      const { error } = await supabase
        .from("memory")
        .insert({ type: "fact", content: action.data });
      if (error) {
        console.error("save_fact error:", error);
        return "⚠️ Failed to save fact.";
      }
      return "✅ Saved to memory.";
    }

    case "save_goal": {
      if (!supabase) return "⚠️ Memory not available (Supabase not configured).";
      const { error } = await supabase
        .from("memory")
        .insert({ type: "goal", content: action.data });
      if (error) {
        console.error("save_goal error:", error);
        return "⚠️ Failed to save goal.";
      }
      return "✅ Goal saved.";
    }

    case "send_message": {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: action.data }),
          }
        );
        if (!res.ok) return "⚠️ Failed to send message.";
        return "✅ Message sent.";
      } catch {
        return "⚠️ Failed to send message.";
      }
    }

    case "confirm":
    default:
      return "✅ Done.";
  }
}

/**
 * Remove expired entries from the pendingActions Map.
 */
export function cleanupExpiredActions(
  map: Map<number, PendingAction>,
  expiryMs: number
): void {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (now - entry.createdAt > expiryMs) {
      map.delete(key);
    }
  }
}
