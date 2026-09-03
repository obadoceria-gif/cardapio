"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  path.resolve(
    __dirname,
    ".."
  );

const MIGRATIONS_DIR =
  path.join(
    ROOT,
    "migrations"
  );

function pass(message) {
  console.log(
    `PASS: ${message}`
  );
}

function fail(message) {
  console.error(
    `FAIL: ${message}`
  );

  process.exit(1);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  fail(
    "diretorio migrations ausente"
  );
}

const migrationFiles = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
if (migrationFiles.length === 0) {
  fail("nenhuma migration encontrada");
}

let sql = "";
for (const file of migrationFiles) {
  sql += "\n" + fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
}

const requiredTables = [
  "catalog_revisions",
  "catalog_slots",
  "catalog_promotions",
  "catalog_media"
];

for (
  const table of requiredTables
) {

  const pattern =
    new RegExp(
      `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`,
      "i"
    );

  if (!pattern.test(sql)) {
    fail(
      `tabela ausente: ${table}`
    );
  }

  pass(
    `tabela ${table}`
  );
}

for (
  const slot of [
    "DRAFT",
    "PREVIEW",
    "PUBLISHED"
  ]
) {

  if (
    !sql.includes(
      `'${slot}'`
    )
  ) {
    fail(
      `slot ausente: ${slot}`
    );
  }

  pass(
    `slot ${slot}`
  );
}

for (
  const action of [
    "DRAFT_SAVED",
    "PREVIEW_CREATED",
    "PUBLISHED",
    "ROLLBACK"
  ]
) {

  if (
    !sql.includes(
      `'${action}'`
    )
  ) {
    fail(
      `acao ausente: ${action}`
    );
  }

  pass(
    `acao ${action}`
  );
}

if (
  !/payload_sha256\s+TEXT\s+NOT\s+NULL/i
    .test(sql)
) {
  fail(
    "SHA256 obrigatorio ausente"
  );
}

pass(
  "SHA256 obrigatorio"
);

if (
  !/FOREIGN\s+KEY\s*\(\s*revision_id\s*\)/i
    .test(sql)
) {
  fail(
    "FK de slot ausente"
  );
}

pass(
  "FK slot -> revisao"
);

if (
  !/ON\s+DELETE\s+RESTRICT/i
    .test(sql)
) {
  fail(
    "proteção contra exclusao ausente"
  );
}

pass(
  "delete restrict"
);

/*
 * Regras que NAO podem existir nesta fase.
 */

const forbidden = [
  /DROP\s+TABLE/i,
  /DELETE\s+FROM\s+catalog_revisions/i,
  /UPDATE\s+catalog_revisions/i,
  /REPLACE\s+INTO\s+catalog_revisions/i
];

for (
  const pattern of forbidden
) {

  if (pattern.test(sql)) {
    fail(
      `operacao proibida no schema: ${pattern}`
    );
  }
}

pass(
  "zero sobrescrita de revisao"
);

pass(
  "zero exclusao de revisao"
);

console.log(
  "CATALOG_STATE_CONTRACT_OK"
);