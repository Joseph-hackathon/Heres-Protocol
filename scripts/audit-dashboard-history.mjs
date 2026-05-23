const rpcUrl =
  process.env.SOLANA_RPC_URL ||
  (process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
    ? `https://solana-devnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
    : '');
const programId = process.env.NEXT_PUBLIC_PROGRAM_ID || '26pDfWXnq9nm1Y5J6siwQsVfHXKxKo5vKvRMVCpqXms6';

if (!rpcUrl) {
  console.error('SOLANA_RPC_URL or NEXT_PUBLIC_ALCHEMY_API_KEY is required');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(body, attempt = 0) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }

  const isRateLimited =
    response.status === 429 ||
    json?.error?.code === -32429 ||
    /too many requests/i.test(json?.error?.message || '');

  if (isRateLimited && attempt < 12) {
    const delay = 1000 * 2 ** Math.min(attempt, 6);
    await sleep(delay);
    return rpc(body, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`RPC ${response.status}: ${text.slice(0, 200)}`);
  }

  if (Array.isArray(json)) {
    return json;
  }

  if (json?.error) {
    throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
  }

  return json;
}

async function fetchAllSignatures(maxPages = 30, pageSize = 100) {
  const signatures = [];
  let before;

  for (let page = 0; page < maxPages; page += 1) {
    const params = [{ limit: pageSize }];
    if (before) params[0].before = before;

    const payload = {
      jsonrpc: '2.0',
      id: page + 1,
      method: 'getSignaturesForAddress',
      params: [programId, params[0]],
    };

    const result = await rpc(payload);
    const batch = Array.isArray(result?.result) ? result.result : [];
    if (!batch.length) break;

    signatures.push(...batch);
    before = batch[batch.length - 1]?.signature;
    if (!before || batch.length < pageSize) break;
  }

  return signatures;
}

function classifyLogs(logs) {
  const text = (logs || []).join(' ');
  if (/Instruction: CreateCapsule/i.test(text)) return 'create';
  if (/Instruction: RecreateCapsule/i.test(text)) return 'recreate';
  if (/Instruction: DistributeAssets/i.test(text)) return 'distribute';
  if (/Instruction: ExecuteIntent/i.test(text)) return 'execute';
  if (/Instruction: DelegateCapsule/i.test(text)) return 'delegate';
  if (/Instruction: ScheduleExecuteIntent/i.test(text)) return 'schedule';
  if (/Instruction: UpdateActivity/i.test(text)) return 'update_activity';
  if (/Instruction: UpdateIntent/i.test(text)) return 'update_intent';
  if (/Instruction: DeactivateCapsule/i.test(text)) return 'deactivate';
  if (/CommitAndUndelegate|undelegating capsule/i.test(text)) return 'undelegate';
  return 'other';
}

function extractCreatedCapsule(logs) {
  for (const log of logs || []) {
    const match = log.match(/Intent Capsule created: ([1-9A-HJ-NP-Za-km-z]+)/i);
    if (match) return match[1];
  }
  return null;
}

function extractRecreatedCapsule(logs) {
  for (const log of logs || []) {
    const match = log.match(/capsule .*?([1-9A-HJ-NP-Za-km-z]{32,})/i);
    if (match) return match[1];
  }
  return null;
}

function extractTransferredLamports(logs) {
  let sum = 0;
  for (const log of logs || []) {
    const match = log.match(/Transferred (\d+) to beneficiary/i);
    if (match) sum += Number(match[1]);
  }
  return sum;
}

async function fetchTransactions(signatures) {
  const results = [];

  for (let i = 0; i < signatures.length; i += 1) {
    const entry = signatures[i];
    const payload = {
      jsonrpc: '2.0',
      id: i + 1,
      method: 'getTransaction',
      params: [
        entry.signature,
        {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
          encoding: 'json',
        },
      ],
    };

    const item = await rpc(payload);
    results.push(item);

    if ((i + 1) % 50 === 0) {
      console.error(`Fetched ${i + 1}/${signatures.length} transactions`);
    }

    await sleep(250);
  }

  return results;
}

const signatures = await fetchAllSignatures();
const transactions = await fetchTransactions(signatures);

const counts = {
  signatures: signatures.length,
  create: 0,
  recreate: 0,
  distribute: 0,
  execute: 0,
  delegate: 0,
  schedule: 0,
  update_activity: 0,
  update_intent: 0,
  deactivate: 0,
  undelegate: 0,
  other: 0,
  nullResult: 0,
  securedLamports: 0,
  executedLamports: 0,
};

const createdCapsules = new Set();
const samples = [];

for (const item of transactions) {
  const tx = item?.result;
  if (!tx) {
    counts.nullResult += 1;
    continue;
  }

  const logs = tx?.meta?.logMessages || [];
  const kind = classifyLogs(logs);
  counts[kind] += 1;

  if (kind === 'create') {
    const capsule = extractCreatedCapsule(logs);
    if (capsule) createdCapsules.add(capsule);
  }

  if (kind === 'recreate') {
    const capsule = extractRecreatedCapsule(logs);
    if (capsule) createdCapsules.add(capsule);
  }

  for (const log of logs) {
    const secured = log.match(/Locked (\d+) lamports in vault/i);
    if (secured) counts.securedLamports += Number(secured[1]);
  }

  counts.executedLamports += extractTransferredLamports(logs);

  if (kind === 'other' && samples.length < 20) {
    samples.push({
      signature: tx?.transaction?.signatures?.[0] || null,
      firstLogs: logs.slice(0, 5),
    });
  }
}

console.log(
  JSON.stringify(
    {
      programId,
      counts,
      totalCreateLike: counts.create + counts.recreate,
      uniqueCreatedCapsules: createdCapsules.size,
      sampleOther: samples,
    },
    null,
    2
  )
);
