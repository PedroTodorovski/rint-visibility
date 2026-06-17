#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const moduleSchema = "rint";
const migrationsDir = join(process.cwd(), "supabase", "migrations");
const migrationFilePattern = /^\d{14}_[a-z0-9_]+\.sql$/;
const requiredHeaders = ["-- rint:migration", "-- objective:", "-- risk:", "-- rollback:"];

const failures = [];
const warnings = [];

if (!existsSync(migrationsDir)) {
  failures.push("Missing supabase/migrations directory.");
} else {
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (migrationFiles.length === 0) {
    warnings.push("No SQL migrations found.");
  }

  for (const fileName of migrationFiles) {
    const filePath = join(migrationsDir, fileName);
    const sql = readFileSync(filePath, "utf8");
    const normalizedSql = sql.replace(/\r\n/g, "\n");
    const executableSql = stripSqlComments(normalizedSql).toLowerCase();
    const isRemoteSnapshot = /_remote_schema\.sql$/i.test(fileName);
    const isExternalHistoryStub = /--\s*rint:external-migration-history-stub/i.test(normalizedSql);

    if (!normalizedSql.trim()) {
      failures.push(`${fileName} is empty.`);
      continue;
    }

    requireValidFileName(fileName);

    if (!isRemoteSnapshot && !isExternalHistoryStub) {
      requireHeader(normalizedSql, fileName);
    }

    forbidDestructiveSql(normalizedSql, executableSql, fileName);

    if (!isRemoteSnapshot) {
      guardSchemaOwnership(executableSql, fileName);
      requireRlsForCreatedTables(executableSql, fileName);
    }
  }
}

if (failures.length > 0) {
  console.error("db:guard failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

for (const warning of warnings) {
  console.warn(`db:guard warning: ${warning}`);
}

console.log("db:guard passed");

function requireValidFileName(fileName) {
  if (!migrationFilePattern.test(fileName)) {
    failures.push(`${fileName} has an invalid migration file name. Expected YYYYMMDDHHMMSS_description.sql.`);
  }
}

function requireHeader(sql, fileName) {
  const lowerSql = sql.toLowerCase();
  const missingHeaders = requiredHeaders.filter((header) => !lowerSql.includes(header));

  for (const header of missingHeaders) {
    failures.push(`${fileName} is missing required migration header '${header}'.`);
  }
}

function forbidDestructiveSql(sql, executableSql, fileName) {
  const destructivePatterns = [
    /\bdrop\s+(schema|table|view|materialized\s+view|function|policy|index|trigger)\b/,
    /\btruncate\s+table\b/,
    /\balter\s+table\s+[^;]*\s+drop\s+column\b/,
    /\bdelete\s+from\b(?![\s\S]*\bwhere\b)/,
    /\bupdate\s+[\w".]+\s+set\b(?![\s\S]*\bwhere\b)/,
  ];
  const hasDestructiveSql = destructivePatterns.some((pattern) => pattern.test(executableSql));

  if (!hasDestructiveSql) {
    return;
  }

  if (/--\s*rint:allow-destructive\s+/i.test(sql)) {
    return;
  }

  failures.push(`${fileName} contains destructive SQL without '-- rint:allow-destructive <ticket-id>'.`);
}

function guardSchemaOwnership(sql, fileName) {
  const schemaPattern = /\bcreate\s+schema\s+(?:if\s+not\s+exists\s+)?([a-z0-9_".]+)/g;
  const directObjectPattern =
    /\b(?:create(?:\s+or\s+replace)?\s+(?:table|view|materialized\s+view|function|type|sequence)|alter\s+(?:table|view|materialized\s+view|function|type|sequence))\s+(?:if\s+(?:not\s+)?exists\s+)?([a-z0-9_".]+)/g;
  const alterSchemaPattern = /\balter\s+schema\s+([a-z0-9_".]+)/g;
  const alterIndexPattern = /\balter\s+index\s+(?:if\s+exists\s+)?([a-z0-9_".]+)/g;
  const directDropPattern = /\b(?:drop|truncate)\s+(?:schema|table|view|materialized\s+view|function|type|sequence|index)\s+(?:if\s+exists\s+)?([a-z0-9_".]+)/g;
  const quotedOrBareName = String.raw`(?:"[^"]+"|[a-z0-9_]+)`;
  const createPolicyPattern = new RegExp(String.raw`\bcreate\s+policy\s+${quotedOrBareName}\s+on\s+([a-z0-9_".]+)`, "g");
  const alterPolicyPattern = new RegExp(String.raw`\balter\s+policy\s+${quotedOrBareName}\s+on\s+([a-z0-9_".]+)`, "g");
  const dropPolicyPattern = new RegExp(String.raw`\bdrop\s+policy\s+(?:if\s+exists\s+)?${quotedOrBareName}\s+on\s+([a-z0-9_".]+)`, "g");
  const createIndexPattern = new RegExp(String.raw`\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?${quotedOrBareName}\s+on\s+(?:only\s+)?([a-z0-9_".]+)`, "g");
  const createTriggerPattern = new RegExp(String.raw`\bcreate\s+trigger\s+${quotedOrBareName}[\s\S]*?\bon\s+([a-z0-9_".]+)`, "g");
  const alterTriggerPattern = new RegExp(String.raw`\balter\s+trigger\s+${quotedOrBareName}\s+on\s+([a-z0-9_".]+)`, "g");
  const dropTriggerPattern = new RegExp(String.raw`\bdrop\s+trigger\s+(?:if\s+exists\s+)?${quotedOrBareName}\s+on\s+([a-z0-9_".]+)`, "g");
  const commentPattern =
    /\bcomment\s+on\s+(?:schema|table|view|materialized\s+view|function|type|sequence|column|index)\s+([a-z0-9_".]+)/g;
  const commentPolicyPattern = new RegExp(String.raw`\bcomment\s+on\s+policy\s+${quotedOrBareName}\s+on\s+([a-z0-9_".]+)`, "g");
  const commentTriggerPattern = new RegExp(String.raw`\bcomment\s+on\s+trigger\s+${quotedOrBareName}\s+on\s+([a-z0-9_".]+)`, "g");
  const grantPattern =
    /\b(?:grant|revoke)\b[\s\S]*?\bon\s+(?:schema|table|view|materialized\s+view|function|sequence|all\s+tables\s+in\s+schema|all\s+sequences\s+in\s+schema|all\s+functions\s+in\s+schema)\s+([a-z0-9_".]+)/g;

  for (const match of sql.matchAll(schemaPattern)) {
    const schemaName = firstIdentifierToken(match[1]);

    if (schemaName !== moduleSchema) {
      failures.push(`${fileName} creates schema '${schemaName}' outside ${moduleSchema}.`);
    }
  }

  for (const pattern of [
    directObjectPattern,
    alterSchemaPattern,
    alterIndexPattern,
    directDropPattern,
    createPolicyPattern,
    alterPolicyPattern,
    dropPolicyPattern,
    createIndexPattern,
    createTriggerPattern,
    alterTriggerPattern,
    dropTriggerPattern,
    commentPattern,
    commentPolicyPattern,
    commentTriggerPattern,
    grantPattern,
  ]) {
    for (const match of sql.matchAll(pattern)) {
      assertModuleOwnedIdentifier(match[1], fileName);
    }
  }
}

function requireRlsForCreatedTables(sql, fileName) {
  const createdTables = [...sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_".]+)/g)]
    .map((match) => normalizeSqlIdentifier(match[1]))
    .filter((tableName) => tableName.startsWith(`${moduleSchema}.`));

  for (const tableName of createdTables) {
    const escapedTableName = escapeRegExp(tableName);
    const rlsPattern = new RegExp(`\\balter\\s+table\\s+${escapedTableName}\\s+enable\\s+row\\s+level\\s+security\\b`);

    if (!rlsPattern.test(sql)) {
      failures.push(`${fileName} creates '${tableName}' without enabling row level security.`);
    }
  }
}

function normalizeSqlIdentifier(identifier) {
  return identifier.replace(/"/g, "");
}

function assertModuleOwnedIdentifier(identifier, fileName) {
  const objectName = firstIdentifierToken(identifier);

  if (objectName === moduleSchema || objectName.startsWith(`${moduleSchema}.`)) {
    return;
  }

  if (!objectName.includes(".")) {
    failures.push(`${fileName} references unqualified object '${objectName}'. Migration objects must be schema-qualified under ${moduleSchema}.`);
    return;
  }

  failures.push(`${fileName} mutates '${objectName}' outside ${moduleSchema}. Cross-repo schema changes must live in the owning repository.`);
}

function firstIdentifierToken(identifier) {
  return normalizeSqlIdentifier(identifier)
    .split(/\s+/)[0]
    ?.replace(/[();,]+$/g, "") ?? "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}
