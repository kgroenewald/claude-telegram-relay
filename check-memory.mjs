import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config();
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const msgs = await s.from("messages").select("id,role,content,created_at").order("created_at", { ascending: false }).limit(5);
console.log("Recent messages:", msgs.data?.length, "err:", msgs.error?.message);
msgs.data?.forEach(m => console.log(` [${m.role}] ${m.content?.slice(0,80)}`));

const embedCheck = await s.functions.invoke("embed", { body: { table: "messages", id: "test" } });
console.log("Embed fn response:", embedCheck.error?.message || JSON.stringify(embedCheck.data)?.slice(0,200));

const searchCheck = await s.functions.invoke("search", { body: { query: "test", match_count: 1, table: "messages" } });
console.log("Search fn response:", searchCheck.error?.message || JSON.stringify(searchCheck.data)?.slice(0,200));
