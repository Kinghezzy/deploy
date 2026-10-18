/**
 * SynapsVault — Step 2: Fund testnet accounts via Friendbot
 *
 * Usage:
 *   node scripts/02-fund-accounts.js G... G... G...
 *   (pass as many public keys as you like)
 *
 * Friendbot gives each account 10,000 XLM on testnet — free.
 *
 * Every key is validated before Friendbot is contacted, an account that is
 * already funded counts as success, and the script exits non-zero when any
 * account could not be funded — so the step can be chained with `&&`.
 */

import { StrKey } from "@stellar/stellar-sdk";

const FRIENDBOT = "https://friendbot.stellar.org";

function short(key) {
  return `${key.slice(0, 10)}…`;
}

/**
 * Reads a response body without assuming JSON: Friendbot answers some
 * failures with HTML or plain text, and `res.json()` throws on those.
 * Returns the parsed JSON, or the raw text when the body is not JSON.
 */
async function readBody(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Friendbot reports an already-funded account as a 400 with this detail. */
function isAlreadyFunded(body) {
  const detail = typeof body === "string" ? body : body?.detail;
  return typeof detail === "string" && /already funded/i.test(detail);
}

/**
 * Funds one account.
 * Returns true when the account holds testnet XLM afterwards (freshly
 * funded or already funded), false on any failure.
 */
async function fund(publicKey) {
  const url = `${FRIENDBOT}?addr=${encodeURIComponent(publicKey)}`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error(`❌ Failed ${short(publicKey)}  ${err.message}`);
    return false;
  }

  const body = await readBody(res);

  if (res.ok) {
    console.log(`✅ Funded ${short(publicKey)}  tx: ${body.id ?? body.hash}`);
    return true;
  }

  if (isAlreadyFunded(body)) {
    console.log(`✅ ${short(publicKey)}  already funded`);
    return true;
  }

  const detail =
    typeof body === "string" ? body.slice(0, 120) : (body.detail ?? JSON.stringify(body));
  console.error(`❌ Failed ${short(publicKey)}  ${detail}`);
  return false;
}

const keys = process.argv.slice(2);
if (keys.length === 0) {
  console.error("Usage: node scripts/02-fund-accounts.js G... G... G...");
  process.exit(1);
}

const invalid = keys.filter((k) => !StrKey.isValidEd25519PublicKey(k));
if (invalid.length > 0) {
  console.error(`Not valid ed25519 public keys: ${invalid.join(", ")}`);
  process.exit(1);
}

console.log(`\nFunding ${keys.length} account(s) on Stellar testnet…\n`);

let failed = 0;
for (const k of keys) {
  if (!(await fund(k))) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} of ${keys.length} account(s) could not be funded.`);
  process.exit(1);
}

console.log("\nNext → build + deploy contracts:");
console.log("  bash scripts/03-deploy-contracts.sh\n");
