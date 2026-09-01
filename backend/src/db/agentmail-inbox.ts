import "dotenv/config";

/**
 * Finds — or creates — the AgentMail inbox to send from, and prints the value
 * to paste into AGENTMAIL_INBOX_ID.
 *
 *   npm run agentmail-inbox                    # use/create any inbox
 *   npm run agentmail-inbox -- pelsungfinance  # create pelsungfinance@agentmail.to
 *
 * Pass a name to choose the address (username@agentmail.to). Without one, an
 * existing inbox is used, or a random one is created. If the name you ask for
 * is taken, AgentMail rejects it — pick another.
 *
 * Self-contained on purpose: it reads AGENTMAIL_API_KEY straight from
 * backend/.env and calls AgentMail itself, so it does not depend on any other
 * file in the project and cannot break if something is misplaced.
 *
 * AgentMail sends mail *from* an inbox it owns (a free @agentmail.to address),
 * never from your own mailbox — so "AGENTMAIL_INBOX_ID=<your gmail>" or a blank
 * "@agentmail.to" can never work. This creates a real inbox and gives you its
 * id. No domain and no payment are involved.
 */

// AgentMail's docs disagree on whether the base carries a /v0 segment, so try
// both. Override with AGENTMAIL_BASE_URL (comma-separated to try several).
const BASES = process.env.AGENTMAIL_BASE_URL?.trim()
  ? process.env.AGENTMAIL_BASE_URL.split(",").map((b) => b.trim().replace(/\/+$/, "")).filter(Boolean)
  : ["https://api.agentmail.to/v0", "https://api.agentmail.to"];

type Inbox = { inbox_id?: string; id?: string; address?: string };

async function call(method: "GET" | "POST", apiKey: string, payload?: object): Promise<{ ok: boolean; status: number; body: any; base: string }> {
  let last = { ok: false, status: 0, body: {} as any, base: BASES[0] };
  for (const base of BASES) {
    let res: Response;
    try {
      res = await fetch(`${base}/inboxes`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify(payload ?? {}) } : {}),
      });
    } catch (error) {
      throw new Error(`Could not reach AgentMail at ${base}. Check your internet connection.`);
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, status: res.status, body, base };
    last = { ok: false, status: res.status, body, base };
    if (res.status !== 404) break; // 404 => try the other base; anything else is real
  }
  return last;
}

function inboxIdOf(inbox: Inbox): string | undefined {
  return inbox.inbox_id ?? inbox.id ?? inbox.address;
}

async function main(): Promise<void> {
  const apiKey = process.env.AGENTMAIL_API_KEY?.trim();
  if (!apiKey) {
    console.error("AGENTMAIL_API_KEY is not set in backend/.env. Add it, then run this again.");
    process.exitCode = 1;
    return;
  }

  // The address you want the local part of, e.g. "pelsungfinance". Just the
  // username — the "@agentmail.to" is added by AgentMail.
  const wantedName = process.argv[2]?.trim().replace(/@.*$/, "").toLowerCase();

  // 1. List existing inboxes.
  const list = await call("GET", apiKey);
  if (!list.ok) {
    if (list.status === 401 || list.status === 403) {
      console.error("AgentMail rejected the API key. Check AGENTMAIL_API_KEY in backend/.env.");
    } else {
      console.error(`AgentMail returned ${list.status}. ${JSON.stringify(list.body)}`);
    }
    process.exitCode = 1;
    return;
  }

  let inboxes: Inbox[] = Array.isArray(list.body) ? list.body : (list.body.inboxes ?? []);

  // If a name was asked for and it already exists, use it.
  const existing = wantedName
    ? inboxes.find((i) => (inboxIdOf(i) ?? "").toLowerCase().startsWith(`${wantedName}@`))
    : undefined;

  // 2. Create an inbox when: a specific name is wanted and not present, or none exist.
  if ((wantedName && !existing) || inboxes.length === 0) {
    console.log(wantedName ? `Creating ${wantedName}@agentmail.to…\n` : "No inboxes found — creating one…\n");
    const created = await call("POST", apiKey, wantedName ? { username: wantedName } : undefined);
    if (!created.ok) {
      if (created.status === 409 || created.status === 422) {
        console.error(`AgentMail would not create "${wantedName}@agentmail.to" — the name is probably taken. Try another, e.g. pelsung-finance or pelsungfin.`);
      } else {
        console.error(`Could not create an inbox. AgentMail returned ${created.status}. ${JSON.stringify(created.body)}`);
      }
      process.exitCode = 1;
      return;
    }
    inboxes = [created.body as Inbox, ...inboxes];
  } else if (existing) {
    inboxes = [existing, ...inboxes.filter((i) => i !== existing)];
  }

  // 3. Print each, and the line to paste.
  console.log("Your AgentMail inboxes:\n");
  for (const inbox of inboxes) {
    console.log(`  inbox_id : ${inboxIdOf(inbox)}`);
    if (inbox.address && inbox.address !== inboxIdOf(inbox)) console.log(`  address  : ${inbox.address}`);
    console.log("");
  }

  const pick = inboxIdOf(inboxes[0]);
  console.log("-".repeat(60));
  console.log("Put this line in backend/.env AND in Render -> Environment:\n");
  console.log(`  AGENTMAIL_INBOX_ID=${pick}\n`);
  console.log("Then:  npm run test-email -- you@example.com");
}

main().then(() => process.exit(process.exitCode ?? 0));