import {
  consensusIdenticalAggregation,
  cre,
  decodeJson,
  type HTTPPayload,
  type HTTPSendRequester,
  json,
  Runner,
  type Runtime,
} from "@chainlink/cre-sdk";

export type Config = {
  callbackUrl: string;
  callbackAuthHeader?: string;
  providerMessagePrefix?: string;
  forceFailure?: boolean;
};

type DispatchPayload = {
  reminderId: string;
  idempotencyKey: string;
  capsuleAddress: string;
  owner: string;
  recipientEmail: string;
  assetSymbol: string;
  assetLabel: string;
  totalAmount?: string;
  beneficiaryCount: number;
  inactivityLabel: string;
  delayDays: number;
  createdAt: number;
  scheduledAt: number;
  reminderIntervalDays: number;
};

type CallbackPayload = {
  idempotencyKey: string;
  capsuleAddress: string;
  scheduledAt: number;
  status: "delivered" | "failed";
  providerMessageId?: string;
  error?: string;
};

type CallbackRequestInput = {
  callbackUrl: string;
  callbackAuthHeader?: string;
  callbackPayload: CallbackPayload;
};

function toBase64(input: string): string {
  const g = globalThis as { Buffer?: { from: (s: string) => { toString: (enc: string) => string } }; btoa?: (s: string) => string };
  if (g.Buffer) return g.Buffer.from(input).toString("base64");
  if (typeof g.btoa === "function") return g.btoa(input);
  throw new Error("No base64 encoder available in runtime");
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid payload: ${field} is required`);
  }
}

function assertNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid payload: ${field} must be a finite number`);
  }
}

function parseDispatchPayload(input: unknown): DispatchPayload {
  const payload = input as Partial<DispatchPayload>;
  assertString(payload.reminderId, "reminderId");
  assertString(payload.idempotencyKey, "idempotencyKey");
  assertString(payload.capsuleAddress, "capsuleAddress");
  assertString(payload.owner, "owner");
  assertString(payload.recipientEmail, "recipientEmail");
  assertString(payload.assetSymbol, "assetSymbol");
  assertString(payload.assetLabel, "assetLabel");
  assertNumber(payload.beneficiaryCount, "beneficiaryCount");
  assertString(payload.inactivityLabel, "inactivityLabel");
  assertNumber(payload.delayDays, "delayDays");
  assertNumber(payload.createdAt, "createdAt");
  assertNumber(payload.scheduledAt, "scheduledAt");
  assertNumber(payload.reminderIntervalDays, "reminderIntervalDays");

  return {
    reminderId: payload.reminderId,
    idempotencyKey: payload.idempotencyKey,
    capsuleAddress: payload.capsuleAddress,
    owner: payload.owner,
    recipientEmail: payload.recipientEmail,
    assetSymbol: payload.assetSymbol,
    assetLabel: payload.assetLabel,
    totalAmount: payload.totalAmount,
    beneficiaryCount: payload.beneficiaryCount,
    inactivityLabel: payload.inactivityLabel,
    delayDays: payload.delayDays,
    createdAt: payload.createdAt,
    scheduledAt: payload.scheduledAt,
    reminderIntervalDays: payload.reminderIntervalDays,
  };
}

const sendCallback = (sendRequester: HTTPSendRequester, input: CallbackRequestInput): string => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (input.callbackAuthHeader && input.callbackAuthHeader.trim().length > 0) {
    headers.Authorization = input.callbackAuthHeader.trim();
  }

  const req = {
    url: input.callbackUrl,
    method: "POST" as const,
    headers,
    body: toBase64(JSON.stringify(input.callbackPayload)),
  };

  const response = sendRequester.sendRequest(req).result();
  return JSON.stringify(json(response));
};

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const decoded = decodeJson(payload.input);
  const dispatch = parseDispatchPayload(decoded);

  runtime.log(
    `CRE reminder dispatch received | capsule=${dispatch.capsuleAddress} | reminder=${dispatch.reminderId} | idempotency=${dispatch.idempotencyKey}`
  );

  const providerMessagePrefix = runtime.config.providerMessagePrefix || "cre-reminder";
  const isFailure = runtime.config.forceFailure === true;

  const callbackPayload: CallbackPayload = {
    idempotencyKey: dispatch.idempotencyKey,
    capsuleAddress: dispatch.capsuleAddress,
    scheduledAt: dispatch.scheduledAt,
    status: isFailure ? "failed" : "delivered",
    providerMessageId: isFailure ? undefined : `${providerMessagePrefix}-${dispatch.idempotencyKey}`,
    error: isFailure ? "Simulated failure from CRE reminder workflow config" : undefined,
  };

  const httpClient = new cre.capabilities.HTTPClient();
  const callbackResultRaw = httpClient
    .sendRequest(runtime, sendCallback, consensusIdenticalAggregation<string>())({
      callbackUrl: runtime.config.callbackUrl,
      callbackAuthHeader: runtime.config.callbackAuthHeader,
      callbackPayload,
    })
    .result();

  const callbackResult = JSON.parse(callbackResultRaw) as Record<string, unknown>;

  runtime.log(
    `Reminder callback posted | capsule=${dispatch.capsuleAddress} | scheduledAt=${dispatch.scheduledAt} | status=${callbackPayload.status}`
  );

  return JSON.stringify(
    {
      ok: true,
      reminderId: dispatch.reminderId,
      idempotencyKey: dispatch.idempotencyKey,
      callbackStatus: callbackPayload.status,
      callbackResult,
    },
    null,
    2
  );
};

const initWorkflow = (_config: Config) => {
  const http = new cre.capabilities.HTTPCapability();
  return [cre.handler(http.trigger({}), onHttpTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
