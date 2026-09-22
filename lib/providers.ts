export const providers = ["vercel", "typesafe", "local"] as const;
export type Provider = (typeof providers)[number];

/** This fork runs locally by default; the hosted providers stay available but opt-in. */
export function resolveProvider(value: unknown): Provider {
  return value === "typesafe" ? "typesafe" : value === "vercel" ? "vercel" : "local";
}

/** Local inference runs on this machine, so there is no account and no key to store. */
export function providerNeedsKey(provider: Provider): boolean {
  return provider !== "local";
}

export function providerLabel(provider: Provider): string {
  return provider === "typesafe"
    ? "TypeSafe AI"
    : provider === "local"
      ? "a Laya server on this computer"
      : "Vercel AI Gateway";
}

export function providerKeyLabel(provider: Provider): string {
  return provider === "typesafe"
    ? "TypeSafe / Jev"
    : provider === "local"
      ? "Local Laya"
      : "Vercel AI Gateway";
}

export function smokeCredentials(env: Record<string, string | undefined>): {
  provider: Provider;
  key: string;
} {
  const gateway = env.AI_GATEWAY_API_KEY?.trim();
  const jev = env.JEV_KEY?.trim();
  const typesafe = env.TYPESAFE_API_KEY?.trim();
  const local = env.LAYA_LOCAL?.trim();
  if (local && (gateway || jev || typesafe))
    throw new Error("Set LAYA_LOCAL on its own: it selects local inference and needs no key.");
  if (local) return { provider: "local", key: "" };
  if (gateway && (jev || typesafe))
    throw new Error(
      "Set only one provider's credentials: JEV_KEY / TYPESAFE_API_KEY or AI_GATEWAY_API_KEY, not both.",
    );
  if (jev && typesafe && jev !== typesafe)
    throw new Error("JEV_KEY and TYPESAFE_API_KEY differ. Set only one TypeSafe key.");
  const direct = jev || typesafe;
  if (direct) return { provider: "typesafe", key: direct };
  if (gateway) return { provider: "vercel", key: gateway };
  throw new Error(
    "Set LAYA_LOCAL=1 for a local Laya server, JEV_KEY or TYPESAFE_API_KEY for TypeSafe AI, or AI_GATEWAY_API_KEY for Vercel. Never pass keys as command-line arguments.",
  );
}
