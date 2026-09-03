"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

const worker =
  fs.readFileSync(
    path.join(root, "src", "index.js"),
    "utf8"
  );

const central =
  fs.readFileSync(
    path.join(root, "public", "index.html"),
    "utf8"
  );

function must(value, message) {
  if (!value) throw new Error(message);
}

must(
  worker.includes("async function obaHandlePublishApi"),
  "Publish handler ausente"
);

must(
  worker.includes('url.pathname !== "/api/publish"'),
  "Rota publish ausente"
);

must(
  worker.includes('url.pathname !== "/api/publish/rollback"'),
  "Rota rollback ausente"
);

must(
  worker.includes('"PUBLISHED"'),
  "PUBLISHED ausente"
);

must(
  worker.includes('"ROLLBACK"'),
  "ROLLBACK ausente"
);

must(
  worker.includes("expected_revision_id"),
  "expected_revision_id ausente"
);

must(
  worker.includes('"preview_stale"'),
  "preview_stale ausente"
);

must(
  worker.includes("await env.DB.batch(["),
  "D1 batch ausente"
);

must(
  worker.includes('url.pathname === "/api/publish/history"'),
  "Rota publish/history ausente"
);

must(
  central.includes('id="oba-publish-8e9f"'),
  "Camada Central 8E.9F ausente"
);

must(
  central.includes('id="oba-rollback-8e9g"'),
  "Camada Central 8E.9G ausente"
);

must(
  central.includes('id="modalHistorico"'),
  "modalHistorico ausente"
);

must(
  central.includes('id="historicoBtn"'),
  "historicoBtn ausente"
);

must(
  central.includes("expected_revision_id:preview.revision_id"),
  "Central nao fixa a revisao do Preview"
);

must(
  central.includes("button.onclick = async function"),
  "Botao publicar nao foi controlado"
);

console.log("PUBLISH_E2E_STATIC_OK");