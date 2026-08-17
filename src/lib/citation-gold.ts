export type CitationGoldWhy =
  | "grounding_host"
  | "negative_mention"
  | "text_only_not_grounded"
  | "no_client_signal";

export type ResolvedGroundingUrl = {
  from: string;
  to: string | null;
  host: string | null;
};

export type ClientIdentity = {
  storeName: string;
  domain: string | null;
  productUrl: string;
  productName: string;
};

export type ClientCitationEvidence = {
  cited: boolean;
  why: CitationGoldWhy;
  llm_claimed_cited: boolean;
  negative_mention: boolean;
  prompt: "blind_shopper";
  client_hosts: string[];
  grounding_hosts: string[];
  resolved: ResolvedGroundingUrl[];
};

const NEGATIVE_MENTION =
  /não\s+(?:foi\s+)?encontrad[oa]s?|não\s+aparece|não\s+encontrei|não\s+localizad|not\s+found|could\s+not\s+find|wasn't\s+found|were\s+not\s+found/i;

export function normalizeHost(value: string): string | null {
  const raw = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
  const host = raw.split("/")[0]?.split(":")[0]?.trim() ?? "";
  if (!host || host === "unknown") return null;
  return host;
}

export function clientHostsFromIdentity(identity: ClientIdentity): string[] {
  const hosts = new Set<string>();
  const domain = identity.domain ? normalizeHost(identity.domain) : null;
  if (domain) hosts.add(domain);
  try {
    const productHost = normalizeHost(new URL(identity.productUrl).hostname);
    if (productHost) hosts.add(productHost);
  } catch {
    /* ignore invalid PDP */
  }
  return [...hosts];
}

export function hostMatchesClient(host: string, clientHosts: string[]): boolean {
  const needle = normalizeHost(host);
  if (!needle) return false;
  return clientHosts.some(
    (client) => needle === client || needle.endsWith(`.${client}`) || client.endsWith(`.${needle}`),
  );
}

function identityNeedles(identity: ClientIdentity): string[] {
  return [identity.storeName, identity.productName, identity.domain, identity.productUrl]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length >= 3);
}

export function hasNegativeClientMention(text: string, identity: ClientIdentity): boolean {
  const haystack = text.trim();
  if (!haystack || !NEGATIVE_MENTION.test(haystack)) return false;
  const lower = haystack.toLowerCase();
  return identityNeedles(identity).some((needle) => lower.includes(needle.toLowerCase()));
}

export function hasClientTextMention(text: string, identity: ClientIdentity): boolean {
  const lower = text.toLowerCase();
  return identityNeedles(identity).some((needle) => lower.includes(needle.toLowerCase()));
}

export function scoreClientCitation(input: {
  text: string;
  identity: ClientIdentity;
  resolved: ResolvedGroundingUrl[];
  llmClaimedCited: boolean;
}): ClientCitationEvidence {
  const clientHosts = clientHostsFromIdentity(input.identity);
  const groundingHosts = [
    ...new Set(
      input.resolved.map((row) => row.host).filter((host): host is string => Boolean(host)),
    ),
  ];
  const clientInGrounding = groundingHosts.some((host) => hostMatchesClient(host, clientHosts));
  const negative = hasNegativeClientMention(input.text, input.identity);
  const textMention = hasClientTextMention(input.text, input.identity);

  let cited = false;
  let why: CitationGoldWhy = "no_client_signal";
  if (clientInGrounding) {
    cited = true;
    why = "grounding_host";
  } else if (negative) {
    why = "negative_mention";
  } else if (textMention) {
    why = "text_only_not_grounded";
  }

  return {
    cited,
    why,
    llm_claimed_cited: input.llmClaimedCited,
    negative_mention: negative,
    prompt: "blind_shopper",
    client_hosts: clientHosts,
    grounding_hosts: groundingHosts,
    resolved: input.resolved,
  };
}
