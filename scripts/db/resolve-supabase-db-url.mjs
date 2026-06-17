import { appendFileSync } from "node:fs";

const SUPABASE_API_BASE_URL = "https://api.supabase.com";
const PASSWORD_PLACEHOLDER_REPLACE_PATTERN = /\[(?:your[-_])?password\]/gi;
const PASSWORD_PLACEHOLDER_TEST_PATTERN = /\[(?:your[-_])?password\]/i;
const PASSWORD_PLACEHOLDER_VALUES = new Set([
  "placeholder",
  "your-password",
  "your_password",
  "<your-password>",
  "<your_password>",
  "<password>",
]);

function requireEnv(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function parseConnectionString(connectionString) {
  if (!connectionString) {
    return null;
  }

  const url = parseDatabaseUrl(connectionString);
  const dbPort = Number(url.port || 5432);

  return {
    db_user: decodeURIComponent(url.username),
    db_host: url.hostname,
    db_port: dbPort,
    db_name: decodeURIComponent(url.pathname.replace(/^\//, "") || "postgres"),
    pool_mode: dbPort === 5432 ? "session" : "transaction",
  };
}

function parseDatabaseUrl(databaseUrl) {
  return new URL(databaseUrl.replace(PASSWORD_PLACEHOLDER_REPLACE_PATTERN, "placeholder"));
}

function normalizePoolerConfig(config) {
  const parsed = parseConnectionString(config.connection_string ?? config.connectionString);

  return {
    identifier: config.identifier ?? parsed?.identifier,
    database_type: config.database_type ?? parsed?.database_type ?? "PRIMARY",
    db_user: config.db_user ?? parsed?.db_user,
    db_host: config.db_host ?? parsed?.db_host,
    db_port: Number(config.db_port ?? parsed?.db_port),
    db_name: config.db_name ?? parsed?.db_name ?? "postgres",
    pool_mode: config.pool_mode ?? parsed?.pool_mode,
  };
}

function inferSessionPoolerConfig(config) {
  if (
    config.db_host?.endsWith(".pooler.supabase.com") &&
    config.pool_mode === "transaction" &&
    Number(config.db_port) === 6543
  ) {
    return {
      ...config,
      db_port: 5432,
      pool_mode: "session",
      inferred_from: "transaction_pooler_metadata",
    };
  }

  return null;
}

export function selectPoolerConfig(rawConfigs) {
  const configs = asArray(rawConfigs).map(normalizePoolerConfig);
  const primaryConfigs = configs.filter((config) => config.database_type === "PRIMARY");
  const candidates = primaryConfigs.length > 0 ? primaryConfigs : configs;

  const selected =
    candidates.find((config) => config.pool_mode === "session" && config.db_port === 5432) ??
    candidates.find((config) => config.db_port === 5432) ??
    candidates.find((config) => config.pool_mode === "session") ??
    candidates.map(inferSessionPoolerConfig).find(Boolean);

  if (!selected) {
    const availableConfigs = candidates
      .map((config) => `${config.database_type ?? "unknown"}:${config.pool_mode ?? "unknown"}:${config.db_port ?? "unknown"}`)
      .join(", ");
    throw new Error(
      [
        "No migration-safe Supabase pooler config found.",
        `Available pooler configs: ${availableConfigs || "none"}.`,
        "Set SUPABASE_DB_URL to the Session pooler URL on port 5432 (same host as transaction pooler, different port).",
        "Or enable Supabase IPv4 add-on if you must use the direct db.*.supabase.co host from GitHub Actions.",
      ].join(" "),
    );
  }

  for (const key of ["db_user", "db_host", "db_port", "db_name"]) {
    if (!selected[key]) {
      throw new Error(`Supabase pooler config missing ${key}.`);
    }
  }

  return selected;
}

function normalizePoolerUser(user, host, poolerIdentifier) {
  if (host.endsWith(".pooler.supabase.com") && !user.includes(".")) {
    return `${user}.${poolerIdentifier}`;
  }

  return user;
}

export function buildDatabaseUrl(config, password, projectRef) {
  const user = normalizePoolerUser(config.db_user, config.db_host, config.identifier ?? projectRef);
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  const encodedDatabase = encodeURIComponent(config.db_name);

  return `postgresql://${encodedUser}:${encodedPassword}@${config.db_host}:${config.db_port}/${encodedDatabase}?sslmode=require`;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isPasswordPlaceholder(value) {
  return PASSWORD_PLACEHOLDER_VALUES.has(safeDecodeURIComponent(value).toLowerCase());
}

function resolveExplicitDatabaseUrl(databaseUrl, password) {
  const url = parseDatabaseUrl(databaseUrl);
  const parsedPassword = url.password ? safeDecodeURIComponent(url.password) : "";
  const shouldInjectPassword =
    !parsedPassword || PASSWORD_PLACEHOLDER_TEST_PATTERN.test(databaseUrl) || isPasswordPlaceholder(parsedPassword);

  if (shouldInjectPassword) {
    if (!password) {
      throw new Error(
        "SUPABASE_DB_PASSWORD is required when SUPABASE_DB_URL has no real password or uses a password placeholder.",
      );
    }

    url.password = password;
    return {
      databaseUrl: url.toString(),
      passwordSource: "SUPABASE_DB_PASSWORD",
    };
  }

  return {
    databaseUrl: url.toString(),
    passwordSource: "SUPABASE_DB_URL",
  };
}

export function isDirectSupabaseDatabaseHost(hostname) {
  return /^db\.[a-z0-9-]+\.supabase\.co$/i.test(hostname);
}

function extractPasswordFromDatabaseUrl(databaseUrl) {
  const url = parseDatabaseUrl(databaseUrl);
  const parsedPassword = url.password ? safeDecodeURIComponent(url.password) : "";

  if (!parsedPassword || isPasswordPlaceholder(parsedPassword)) {
    return null;
  }

  return parsedPassword;
}

function inspectDatabaseUrl(databaseUrl) {
  const parsed = parseConnectionString(databaseUrl);

  if (!parsed) {
    throw new Error("SUPABASE_DB_URL is empty.");
  }

  if (isDirectSupabaseDatabaseHost(parsed.db_host)) {
    throw new Error(
      [
        "SUPABASE_DB_URL uses the direct database host (db.*.supabase.co).",
        "GitHub Actions runners cannot reach Supabase direct connections when they resolve to IPv6.",
        "Remove SUPABASE_DB_URL to auto-resolve the Session pooler, or set SUPABASE_DB_URL to the Session pooler URL on port 5432.",
      ].join(" "),
    );
  }

  if (parsed.db_host.endsWith(".pooler.supabase.com") && parsed.pool_mode !== "session") {
    const inferred = inferSessionPoolerConfig(parsed);

    if (inferred) {
      return {
        host: inferred.db_host,
        port: inferred.db_port,
        user: parsed.db_user,
        database: parsed.db_name,
        poolMode: "session",
        poolerIdentifier: parsed.db_user.includes(".") ? parsed.db_user.split(".").slice(1).join(".") : "n/a",
        inferredFrom: "transaction_pooler_url",
      };
    }

    throw new Error(
      [
        "SUPABASE_DB_URL points to the Supabase transaction pooler on port 6543.",
        "Use the same pooler host on port 5432 (Session mode) for migration deploy.",
      ].join(" "),
    );
  }

  return {
    host: parsed.db_host,
    port: parsed.db_port,
    user: parsed.db_user,
    database: parsed.db_name,
    poolMode: parsed.db_host.endsWith(".pooler.supabase.com") ? parsed.pool_mode : "direct",
    poolerIdentifier: parsed.db_user.includes(".") ? parsed.db_user.split(".").slice(1).join(".") : "n/a",
  };
}

async function fetchPoolerConfig({ accessToken, projectRef, fetchImpl = fetch }) {
  const response = await fetchImpl(`${SUPABASE_API_BASE_URL}/v1/projects/${projectRef}/config/database/pooler`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch Supabase pooler config: ${response.status} ${body}`);
  }

  return response.json();
}

function writeGitHubEnv(key, value) {
  if (!process.env.GITHUB_ENV) {
    return;
  }

  appendFileSync(process.env.GITHUB_ENV, `${key}=${value}\n`, "utf8");
}

async function resolveSessionPoolerDatabaseUrl({ accessToken, projectRef, password, fetchImpl, bypassedDirectHost }) {
  const poolerConfig = selectPoolerConfig(await fetchPoolerConfig({ accessToken, projectRef, fetchImpl }));

  if (poolerConfig.inferred_from === "transaction_pooler_metadata") {
    console.warn(
      [
        "Supabase Management API returned only transaction pooler metadata (port 6543).",
        `Using Session mode on ${poolerConfig.db_host}:5432 for migration deploy.`,
      ].join(" "),
    );
  }

  const databaseUrl = buildDatabaseUrl(poolerConfig, password, projectRef);

  return {
    databaseUrl,
    safeConfig: {
      host: poolerConfig.db_host,
      port: poolerConfig.db_port,
      user: normalizePoolerUser(poolerConfig.db_user, poolerConfig.db_host, poolerConfig.identifier ?? projectRef),
      database: poolerConfig.db_name,
      poolMode: poolerConfig.pool_mode ?? "unknown",
      poolerIdentifier: poolerConfig.identifier ?? projectRef,
      source: bypassedDirectHost
        ? "Supabase Management API (direct db host bypassed for GitHub Actions IPv4)"
        : "Supabase Management API",
      passwordSource: "SUPABASE_DB_PASSWORD",
    },
  };
}

export async function resolveSupabaseDbUrl({ env = process.env, fetchImpl = fetch } = {}) {
  const accessToken = requireEnv(env, "SUPABASE_ACCESS_TOKEN");
  const projectRef = requireEnv(env, "SUPABASE_PROJECT_REF");

  if (env.SUPABASE_DB_URL) {
    const { databaseUrl, passwordSource } = resolveExplicitDatabaseUrl(env.SUPABASE_DB_URL, env.SUPABASE_DB_PASSWORD);
    const parsed = parseConnectionString(databaseUrl);

    if (parsed && isDirectSupabaseDatabaseHost(parsed.db_host)) {
      const password =
        env.SUPABASE_DB_PASSWORD ??
        extractPasswordFromDatabaseUrl(databaseUrl) ??
        (() => {
          throw new Error(
            "SUPABASE_DB_PASSWORD is required when SUPABASE_DB_URL uses the direct database host so the Session pooler can be resolved for GitHub Actions.",
          );
        })();

      console.warn(
        [
          `SUPABASE_DB_URL uses direct host ${parsed.db_host}.`,
          "GitHub Actions cannot reach direct Supabase database hosts over IPv6.",
          "Resolving the Session pooler via Supabase Management API instead.",
        ].join(" "),
      );

      return resolveSessionPoolerDatabaseUrl({
        accessToken,
        projectRef,
        password,
        fetchImpl,
        bypassedDirectHost: parsed.db_host,
      });
    }

    const inspected = inspectDatabaseUrl(databaseUrl);

    if (inspected.inferredFrom === "transaction_pooler_url") {
      const url = parseDatabaseUrl(databaseUrl);
      url.port = "5432";
      console.warn(
        [
          "SUPABASE_DB_URL uses transaction pooler port 6543.",
          `Rewriting to Session mode on ${inspected.host}:5432 for migration deploy.`,
        ].join(" "),
      );

      return {
        databaseUrl: url.toString(),
        safeConfig: {
          ...inspected,
          port: 5432,
          source: "SUPABASE_DB_URL (session port inferred from transaction pooler URL)",
          passwordSource,
        },
      };
    }

    return {
      databaseUrl,
      safeConfig: {
        ...inspected,
        source: "SUPABASE_DB_URL",
        passwordSource,
      },
    };
  }

  const password = requireEnv(env, "SUPABASE_DB_PASSWORD");

  return resolveSessionPoolerDatabaseUrl({
    accessToken,
    projectRef,
    password,
    fetchImpl,
    bypassedDirectHost: null,
  });
}

async function main() {
  const { databaseUrl, safeConfig } = await resolveSupabaseDbUrl();

  if (process.env.SUPABASE_DB_PASSWORD) {
    console.log(`::add-mask::${process.env.SUPABASE_DB_PASSWORD}`);
    console.log(`::add-mask::${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}`);
  }
  console.log(`::add-mask::${databaseUrl}`);
  writeGitHubEnv("SUPABASE_DB_URL", databaseUrl);

  console.log("Resolved Supabase database connection for migration deploy:");
  console.log(`- host: ${safeConfig.host}`);
  console.log(`- port: ${safeConfig.port}`);
  console.log(`- user: ${safeConfig.user}`);
  console.log(`- database: ${safeConfig.database}`);
  console.log(`- pool mode: ${safeConfig.poolMode}`);
  console.log(`- pooler identifier: ${safeConfig.poolerIdentifier}`);
  console.log(`- source: ${safeConfig.source}`);
  console.log(`- password source: ${safeConfig.passwordSource}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
