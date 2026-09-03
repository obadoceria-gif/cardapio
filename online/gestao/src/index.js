const encoder = new TextEncoder();

const COOKIE_NAME = "__Host-oba_admin";
const CSRF_COOKIE = "__Host-oba_csrf";

const SESSION_SECONDS = 60 * 60 * 8;

const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

/*
 * Rate limit local por isolate.
 *
 * Serve como primeira barreira e permite testes locais.
 * Antes da abertura publica, a camada de rate limiting distribuida
 * sera validada separadamente.
 */
const loginAttempts = new Map();

function response(body, status = 200, headers = {}) {
  /*
   * IMPORTANTE:
   *
   * headers pode ser um Headers real, inclusive contendo multiplos
   * Set-Cookie. Object spread de um objeto Headers nao preserva corretamente
   * esses valores.
   *
   * Portanto trabalhamos diretamente com Headers.
   */
  const finalHeaders =
    headers instanceof Headers
      ? headers
      : new Headers(headers);

  if (!finalHeaders.has("Cache-Control")) {
    finalHeaders.set("Cache-Control", "no-store");
  }

  if (!finalHeaders.has("X-Content-Type-Options")) {
    finalHeaders.set("X-Content-Type-Options", "nosniff");
  }

  if (!finalHeaders.has("Referrer-Policy")) {
    finalHeaders.set("Referrer-Policy", "no-referrer");
  }

  if (!finalHeaders.has("X-Frame-Options")) {
    finalHeaders.set("X-Frame-Options", "DENY");
  }

  if (!finalHeaders.has("Content-Security-Policy")) {
    finalHeaders.set(
      "Content-Security-Policy",
      "default-src 'self'; " +
        "style-src 'unsafe-inline'; " +
        "form-action 'self'; " +
        "frame-ancestors 'none'; " +
        "base-uri 'none'"
    );
  }

  return new Response(body, {
    status,
    headers: finalHeaders,
  });
}

function json(data, status = 200, headers = {}) {
  return response(JSON.stringify(data), status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
}

function parseCookies(request) {
  const raw = request.headers.get("Cookie") || "";
  const out = {};

  for (const part of raw.split(";")) {
    const index = part.indexOf("=");

    if (index <= 0) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    out[key] = value;
  }

  return out;
}

function toBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return toBase64Url(data);
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;

  const aa = encoder.encode(a);
  const bb = encoder.encode(b);

  const max = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;

  for (let i = 0; i < max; i++) {
    diff |= (aa[i] || 0) ^ (bb[i] || 0);
  }

  return diff === 0;
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value)
  );

  return toBase64Url(new Uint8Array(signature));
}

function getClientKey(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "local"
  ).split(",")[0].trim();
}

function pruneAttempts(now) {
  if (loginAttempts.size < 1000) return;

  for (const [key, value] of loginAttempts.entries()) {
    if (now - value.startedAt >= LOGIN_WINDOW_MS) {
      loginAttempts.delete(key);
    }
  }
}

function rateState(request) {
  const now = Date.now();
  const key = getClientKey(request);

  pruneAttempts(now);

  let state = loginAttempts.get(key);

  if (!state || now - state.startedAt >= LOGIN_WINDOW_MS) {
    state = {
      startedAt: now,
      failures: 0,
    };

    loginAttempts.set(key, state);
  }

  return { key, state, now };
}

function isRateLimited(request) {
  const { state } = rateState(request);
  return state.failures >= LOGIN_MAX_ATTEMPTS;
}

function registerFailure(request) {
  const { key, state } = rateState(request);
  state.failures += 1;
  loginAttempts.set(key, state);
}

function clearFailures(request) {
  loginAttempts.delete(getClientKey(request));
}

async function createSession(env) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + SESSION_SECONDS;

  const nonce = crypto.randomUUID();

  const payload = `${issuedAt}.${expiresAt}.${nonce}`;
  const signature = await hmac(env.AUTH_SESSION_SECRET, payload);

  return `${payload}.${signature}`;
}

async function validateSession(request, env) {
  if (!env.AUTH_SESSION_SECRET) return false;

  const cookies = parseCookies(request);
  const token = cookies[COOKIE_NAME];

  if (!token) return false;

  const pieces = token.split(".");

  if (pieces.length !== 4) return false;

  const [issuedAtRaw, expiresAtRaw, nonce, signature] = pieces;

  const issuedAt = Number(issuedAtRaw);
  const expiresAt = Number(expiresAtRaw);

  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    !nonce ||
    !signature
  ) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  if (issuedAt > now + 60) return false;
  if (expiresAt <= now) return false;
  if (expiresAt - issuedAt > SESSION_SECONDS) return false;

  const payload = `${issuedAt}.${expiresAt}.${nonce}`;
  const expected = await hmac(env.AUTH_SESSION_SECRET, payload);

  return constantTimeEqual(expected, signature);
}

function csrfValid(request) {
  const cookies = parseCookies(request);
  const cookieToken = cookies[CSRF_COOKIE];
  const headerToken = request.headers.get("X-CSRF-Token");

  return (
    typeof cookieToken === "string" &&
    typeof headerToken === "string" &&
    cookieToken.length >= 32 &&
    constantTimeEqual(cookieToken, headerToken)
  );
}

function loginPage(error = "") {
  const safeError = error
    ? '<p role="alert" class="error">Acesso nao autorizado.</p>'
    : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Oba Doceria - Gestao</title>
<style>
*{box-sizing:border-box}
body{
  margin:0;
  min-height:100vh;
  display:grid;
  place-items:center;
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  background:#f6f3ee;
  color:#28231f
}
main{
  width:min(92vw,420px);
  background:#fff;
  padding:32px;
  border-radius:18px;
  box-shadow:0 12px 40px rgba(0,0,0,.10)
}
h1{margin-top:0}
label{display:block;margin:18px 0 8px}
input{
  width:100%;
  padding:13px;
  font:inherit;
  border:1px solid #bbb;
  border-radius:9px
}
button{
  width:100%;
  margin-top:20px;
  padding:13px;
  border:0;
  border-radius:9px;
  font:inherit;
  font-weight:700;
  cursor:pointer
}
.error{color:#a00}
.small{font-size:.85rem;opacity:.7}
</style>
</head>
<body>
<main>
<h1>Gestao Oba Doceria</h1>
<p>Acesso administrativo.</p>
${safeError}
<form method="post" action="/__auth/login" autocomplete="off">
<label for="password">Senha</label>
<input
  id="password"
  name="password"
  type="password"
  required
  minlength="12"
  autocomplete="current-password">
<button type="submit">Entrar</button>
</form>
<p class="small">Area privada.</p>
</main>
</body>
</html>`;
}

async function handleLogin(request, env) {
  if (!env.AUTH_PASSWORD || !env.AUTH_SESSION_SECRET) {
    return response("Authentication not configured", 503);
  }

  if (isRateLimited(request)) {
    return response("Too Many Requests", 429, {
      "Retry-After": "60",
    });
  }

  const contentType = request.headers.get("Content-Type") || "";

  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return response("Unsupported Media Type", 415);
  }

  const form = await request.formData();
  const password = String(form.get("password") || "");

  if (!constantTimeEqual(password, env.AUTH_PASSWORD)) {
    registerFailure(request);

    return response(loginPage("invalid"), 401, {
      "Content-Type": "text/html; charset=utf-8",
    });
  }

  clearFailures(request);

  const session = await createSession(env);
  const csrf = randomToken();

  const headers = new Headers();

  headers.set("Location", "/");

  headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`
  );

  /*
   * CSRF precisa estar disponivel ao JavaScript administrativo
   * para ser enviado no header X-CSRF-Token.
   * Nao e credencial de autenticacao.
   */
  headers.append(
    "Set-Cookie",
    `${CSRF_COOKIE}=${csrf}; Path=/; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`
  );

  return response("", 303, headers);
}

function handleLogout() {
  const headers = new Headers();

  headers.set("Location", "/__auth/login");

  headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
  );

  headers.append(
    "Set-Cookie",
    `${CSRF_COOKIE}=; Path=/; Secure; SameSite=Strict; Max-Age=0`
  );

  return response("", 303, headers);
}

function isUnsafeMethod(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}



/* OBA_CATALOG_READ_API_BEGIN */

const OBA_CATALOG_FILES = Object.freeze({
  "loja": "config.json",
  "combos": "combos.json",
  "categorias": "categories.json",
  "caixas": "boxes.json",
  "sabores": "flavors.json",
  "produtos": "products.json",
  "opcionais": "options.json"
});

const OBA_CATALOG_ALIASES = Object.freeze({
  sabor: "sabores",
  sabores: "sabores",
  flavor: "sabores",
  flavors: "sabores",
  flavour: "sabores",
  flavours: "sabores",

  categoria: "categorias",
  categorias: "categorias",
  category: "categorias",
  categories: "categorias",

  caixa: "caixas",
  caixas: "caixas",
  box: "caixas",
  boxes: "caixas",

  produto: "produtos",
  produtos: "produtos",
  product: "produtos",
  products: "produtos",

  opcional: "opcionais",
  opcionais: "opcionais",
  option: "opcionais",
  options: "opcionais",

  combo: "combos",
  combos: "combos",

  loja: "loja",
  config: "loja",
  store: "loja"
});

async function obaReadCatalogFile(
  request,
  env,
  fileName
) {

  const assetUrl =
    new URL(request.url);

  assetUrl.pathname =
    "/data/catalog-v1/" +
    encodeURIComponent(fileName);

  assetUrl.search = "";
  assetUrl.hash = "";

  const assetRequest =
    new Request(
      assetUrl.toString(),
      {
        method: "GET",
        headers: request.headers
      }
    );

  const response =
    await env.ASSETS.fetch(
      assetRequest
    );

  if (!response.ok) {
    return {
      ok: false,
      status: response.status
    };
  }

  const text =
    await response.text();

  try {
    return {
      ok: true,
      value: JSON.parse(text)
    };
  }
  catch {
    return {
      ok: false,
      status: 500
    };
  }
}

function obaApiJson(
  value,
  status = 200
) {

  return new Response(
    JSON.stringify(value),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control":
          "no-store"
      }
    }
  );
}

async function obaCatalogSnapshot(
  request,
  env
) {

  const snapshot = {};

  for (
    const [key, fileName]
    of Object.entries(
      OBA_CATALOG_FILES
    )
  ) {

    const result =
      await obaReadCatalogFile(
        request,
        env,
        fileName
      );

    if (!result.ok) {
      return null;
    }

    snapshot[key] =
      result.value;
  }

  /*
   * Aliases para compatibilidade da UI existente.
   */
  snapshot.flavors =
    snapshot.sabores;

  snapshot.categories =
    snapshot.categorias;

  snapshot.boxes =
    snapshot.caixas;

  snapshot.products =
    snapshot.produtos;

  snapshot.options =
    snapshot.opcionais;

  snapshot.store =
    snapshot.loja;

  return snapshot;
}

async function obaHandleCatalogReadApi(
  request,
  env
) {

  /*
   * ESTA FASE E EXCLUSIVAMENTE GET.
   */
  if (request.method !== "GET") {
    return null;
  }

  const url =
    new URL(request.url);

  if (
    !url.pathname.startsWith(
      "/api/"
    )
  ) {
    return null;
  }

  const segments =
    url.pathname
      .split("/")
      .filter(Boolean)
      .slice(1);

  if (!segments.length) {
    return null;
  }

  const first =
    segments[0]
      .toLowerCase();

  const aggregateNames =
    new Set([
      "catalog",
      "catalogo",
      "catalog-v1",
      "bootstrap",
      "state",
      "data"
    ]);

  /*
   * /api/catalog
   * /api/catalogo
   * /api/bootstrap
   * /api/state
   */
  if (
    segments.length === 1 &&
    aggregateNames.has(first)
  ) {

    const catalog =
      await obaCatalogSnapshot(
        request,
        env
      );

    if (!catalog) {
      return obaApiJson(
        {
          ok: false,
          error:
            "catalog_read_failed"
        },
        500
      );
    }

    /*
     * Mantemos varios envelopes COMPATIVEIS
     * apontando para o mesmo snapshot.
     */
    return obaApiJson({
      ok: true,
      data: catalog,
      catalog,
      state: catalog,

      sabores:
        catalog.sabores,
      flavors:
        catalog.sabores,

      categorias:
        catalog.categorias,
      categories:
        catalog.categorias,

      caixas:
        catalog.caixas,
      boxes:
        catalog.caixas,

      produtos:
        catalog.produtos,
      products:
        catalog.produtos,

      opcionais:
        catalog.opcionais,
      options:
        catalog.opcionais,

      combos:
        catalog.combos,

      loja:
        catalog.loja,
      store:
        catalog.loja
    });
  }

  /*
   * Tambem aceitar:
   *
   * /api/sabores
   * /api/flavors
   * /api/catalog/sabores
   * /api/catalog/flavors
   */
  let entityName = null;

  if (segments.length === 1) {

    entityName =
      segments[0];
  }
  else if (
    segments.length === 2 &&
    aggregateNames.has(first)
  ) {

    entityName =
      segments[1];
  }

  if (!entityName) {
    return null;
  }

  const canonical =
    OBA_CATALOG_ALIASES[
      entityName.toLowerCase()
    ];

  if (!canonical) {
    return null;
  }

  const fileName =
    OBA_CATALOG_FILES[
      canonical
    ];

  if (!fileName) {
    return null;
  }

  const entity =
    await obaReadCatalogFile(
      request,
      env,
      fileName
    );

  if (!entity.ok) {

    return obaApiJson(
      {
        ok: false,
        error:
          "catalog_read_failed",
        entity:
          canonical
      },
      entity.status || 500
    );
  }

  return obaApiJson(
    entity.value
  );
}

/* OBA_CATALOG_READ_API_END */




/* OBA_DRAFT_API_BEGIN */

function obaDraftStableJson(value) {

  if (Array.isArray(value)) {

    return "[" +
      value
        .map(
          obaDraftStableJson
        )
        .join(",") +
      "]";
  }

  if (
    value !== null &&
    typeof value === "object"
  ) {

    return "{" +
      Object.keys(value)
        .sort()
        .map(
          key =>
            JSON.stringify(key) +
            ":" +
            obaDraftStableJson(
              value[key]
            )
        )
        .join(",") +
      "}";
  }

  return JSON.stringify(value);
}

async function obaDraftSha256(
  text
) {

  const encoded =
    new TextEncoder()
      .encode(text);

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      encoded
    );

  return Array
    .from(
      new Uint8Array(
        digest
      )
    )
    .map(
      value =>
        value
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}

function obaDraftPayloadValid(
  payload
) {

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return false;
  }

  const required = [
    "sabores",
    "categorias",
    "caixas",
    "produtos",
    "opcionais",
    "combos",
    "loja"
  ];

  return required.every(
    key =>
      Object.prototype
        .hasOwnProperty
        .call(
          payload,
          key
        )
  );
}

async function obaHandleDraftApi(
  request,
  env,
  url
) {

  if (
    url.pathname !== "/api/draft"
  ) {
    return null;
  }

  /*
   * GET /api/draft
   */

  if (
    request.method === "GET"
  ) {

    const sql =
      [
        "SELECT",
        "s.slot,",
        "s.revision_id,",
        "s.updated_at,",
        "r.payload_json,",
        "r.payload_sha256,",
        "r.created_at",
        "FROM catalog_slots s",
        "LEFT JOIN catalog_revisions r",
        "ON r.revision_id = s.revision_id",
        "WHERE s.slot = 'DRAFT'",
        "LIMIT 1"
      ].join(" ");

    const row =
      await env.DB
        .prepare(sql)
        .first();

    if (
      !row ||
      !row.revision_id
    ) {

      return obaApiJson({
        ok: true,
        slot: "DRAFT",
        revision_id: null,
        payload_sha256: null,
        payload: null
      });
    }

    let payload;

    try {

      payload =
        JSON.parse(
          row.payload_json
        );
    }
    catch {

      return obaApiJson(
        {
          ok: false,
          error:
            "draft_payload_corrupt"
        },
        500
      );
    }

    return obaApiJson({
      ok: true,
      slot: "DRAFT",
      revision_id:
        row.revision_id,
      updated_at:
        row.updated_at,
      payload_sha256:
        row.payload_sha256,
      payload
    });
  }

  /*
   * Somente POST grava.
   */

  if (
    request.method !== "POST"
  ) {

    return obaApiJson(
      {
        ok: false,
        error:
          "method_not_allowed"
      },
      405
    );
  }

  let body;

  try {

    body =
      await request.json();
  }
  catch {

    return obaApiJson(
      {
        ok: false,
        error:
          "invalid_json"
      },
      400
    );
  }

  const payload =
    body &&
    body.payload &&
    typeof body.payload === "object"
      ? body.payload
      : body;

  if (
    !obaDraftPayloadValid(
      payload
    )
  ) {

    return obaApiJson(
      {
        ok: false,
        error:
          "invalid_catalog_payload"
      },
      400
    );
  }

  const payloadJson =
    obaDraftStableJson(
      payload
    );

  const sha =
    await obaDraftSha256(
      payloadJson
    );

  const now =
    new Date()
      .toISOString();

  const existing =
    await env.DB
      .prepare(
        [
          "SELECT revision_id",
          "FROM catalog_revisions",
          "WHERE payload_sha256 = ?",
          "LIMIT 1"
        ].join(" ")
      )
      .bind(sha)
      .first();

  const revisionId =
    (
      existing &&
      existing.revision_id
    )
      ? existing.revision_id
      : (
          "draft_" +
          sha.slice(
            0,
            24
          )
        );

  const previous =
    await env.DB
      .prepare(
        [
          "SELECT revision_id",
          "FROM catalog_slots",
          "WHERE slot = 'DRAFT'",
          "LIMIT 1"
        ].join(" ")
      )
      .first();

  const statements = [];

  /*
   * Conteudo novo:
   * cria revisao.
   *
   * Conteudo ja existente:
   * reutiliza a revisao imutavel.
   */

  if (
    !existing ||
    !existing.revision_id
  ) {

    statements.push(
      env.DB
        .prepare(
          [
            "INSERT INTO catalog_revisions",
            "(",
            "revision_id,",
            "payload_json,",
            "payload_sha256,",
            "source,",
            "created_at,",
            "created_by",
            ")",
            "VALUES (?, ?, ?, ?, ?, ?)"
          ].join(" ")
        )
        .bind(
          revisionId,
          payloadJson,
          sha,
          "CENTRAL_ONLINE_DRAFT",
          now,
          "admin"
        )
    );
  }

  /*
   * Somente DRAFT muda.
   */

  statements.push(
    env.DB
      .prepare(
        [
          "UPDATE catalog_slots",
          "SET revision_id = ?,",
          "updated_at = ?",
          "WHERE slot = 'DRAFT'"
        ].join(" ")
      )
      .bind(
        revisionId,
        now
      )
  );

  /*
   * Auditoria append-only.
   */

  statements.push(
    env.DB
      .prepare(
        [
          "INSERT INTO catalog_promotions",
          "(",
          "promotion_id,",
          "action,",
          "from_revision_id,",
          "to_revision_id,",
          "created_at,",
          "created_by",
          ")",
          "VALUES (?, ?, ?, ?, ?, ?)"
        ].join(" ")
      )
      .bind(
        "promotion_" +
          crypto.randomUUID()
            .replaceAll(
              "-",
              ""
            ),
        "DRAFT_SAVED",
        previous
          ? previous.revision_id
          : null,
        revisionId,
        now,
        "admin"
      )
  );

  await env.DB.batch(
    statements
  );

  /*
   * Gate pós-write:
   * conferir os três slots.
   */

  const slotsResult =
    await env.DB
      .prepare(
        [
          "SELECT slot, revision_id",
          "FROM catalog_slots",
          "ORDER BY slot"
        ].join(" ")
      )
      .all();

  const slots = {
    DRAFT: null,
    PREVIEW: null,
    PUBLISHED: null
  };

  for (
    const row of
    slotsResult.results || []
  ) {

    if (
      Object.prototype
        .hasOwnProperty.call(
          slots,
          row.slot
        )
    ) {

      slots[row.slot] =
        row.revision_id ?? null;
    }
  }

  return obaApiJson({
    ok: true,
    slot: "DRAFT",
    revision_id:
      revisionId,
    payload_sha256:
      sha,
    reused:
      Boolean(
        existing &&
        existing.revision_id
      ),
    slots
  });
}

/* OBA_DRAFT_API_END */

/* OBA_PREVIEW_API_BEGIN */

async function obaLoadCatalogSlot(env, slot) {
  const row =
    await env.DB
      .prepare(
        [
          "SELECT",
          "s.slot,",
          "s.revision_id,",
          "s.updated_at,",
          "r.payload_json,",
          "r.payload_sha256,",
          "r.created_at",
          "FROM catalog_slots s",
          "LEFT JOIN catalog_revisions r",
          "ON r.revision_id = s.revision_id",
          "WHERE s.slot = ?",
          "LIMIT 1"
        ].join(" ")
      )
      .bind(slot)
      .first();

  if (!row || !row.revision_id) {
    return {
      slot,
      revision_id: null,
      updated_at: row ? row.updated_at : null,
      payload_sha256: null,
      payload: null
    };
  }

  let payload;
  try {
    payload = JSON.parse(row.payload_json);
  }
  catch {
    throw new Error("slot_payload_corrupt");
  }

  return {
    slot,
    revision_id: row.revision_id,
    updated_at: row.updated_at,
    payload_sha256: row.payload_sha256,
    payload
  };
}

async function obaCatalogSlotsState(env) {
  const rows =
    await env.DB
      .prepare(
        [
          "SELECT slot, revision_id",
          "FROM catalog_slots",
          "ORDER BY slot"
        ].join(" ")
      )
      .all();

  const slots = { DRAFT: null, PREVIEW: null, PUBLISHED: null };
  for (const row of rows.results || []) {
    if (Object.prototype.hasOwnProperty.call(slots, row.slot)) {
      slots[row.slot] = row.revision_id ?? null;
    }
  }
  return slots;
}

async function obaHandlePreviewApi(request, env, url) {
  if (url.pathname !== "/api/preview") return null;

  if (request.method === "GET") {
    const preview = await obaLoadCatalogSlot(env, "PREVIEW");
    const slots = await obaCatalogSlotsState(env);
    return obaApiJson({ ok: true, ...preview, slots });
  }

  if (request.method !== "POST") {
    return obaApiJson({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body;
  try { body = await request.json(); }
  catch { return obaApiJson({ ok: false, error: "invalid_json" }, 400); }

  if (!body || body.confirm !== "PREVIEW") {
    return obaApiJson({ ok: false, error: "preview_confirmation_required" }, 400);
  }

  const draft = await obaLoadCatalogSlot(env, "DRAFT");
  if (!draft.revision_id) {
    return obaApiJson({ ok: false, error: "draft_required" }, 409);
  }

  const before = await obaLoadCatalogSlot(env, "PREVIEW");
  const published = await obaLoadCatalogSlot(env, "PUBLISHED");

  if (before.revision_id === draft.revision_id) {
    return obaApiJson({
      ok: true,
      slot: "PREVIEW",
      revision_id: draft.revision_id,
      payload_sha256: draft.payload_sha256,
      reused: true,
      slots: {
        DRAFT: draft.revision_id,
        PREVIEW: before.revision_id,
        PUBLISHED: published.revision_id
      }
    });
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB
      .prepare(
        [
          "UPDATE catalog_slots",
          "SET revision_id = ?,",
          "updated_at = ?",
          "WHERE slot = 'PREVIEW'"
        ].join(" ")
      )
      .bind(draft.revision_id, now),

    env.DB
      .prepare(
        [
          "INSERT INTO catalog_promotions",
          "(",
          "promotion_id,",
          "action,",
          "from_revision_id,",
          "to_revision_id,",
          "created_at,",
          "created_by",
          ")",
          "VALUES (?, ?, ?, ?, ?, ?)"
        ].join(" ")
      )
      .bind(
        "promotion_" + crypto.randomUUID().replaceAll("-", ""),
        "PREVIEW_CREATED",
        before.revision_id,
        draft.revision_id,
        now,
        "admin"
      )
  ]);

  return obaApiJson({
    ok: true,
    slot: "PREVIEW",
    revision_id: draft.revision_id,
    payload_sha256: draft.payload_sha256,
    reused: false,
    slots: {
      DRAFT: draft.revision_id,
      PREVIEW: draft.revision_id,
      PUBLISHED: published.revision_id
    }
  });
}


/* OBA_PUBLISH_API_BEGIN */

async function obaHandlePublishApi(request, env, url) {
  if (
    url.pathname !== "/api/publish" &&
    url.pathname !== "/api/publish/rollback" &&
    url.pathname !== "/api/publish/history"
  ) {
    return null;
  }

  if (
    url.pathname === "/api/publish/history" &&
    request.method === "GET"
  ) {
    const published =
      await obaLoadCatalogSlot(env, "PUBLISHED");
    const preview =
      await obaLoadCatalogSlot(env, "PREVIEW");
    const draft =
      await obaLoadCatalogSlot(env, "DRAFT");

    const rows =
      await env.DB
        .prepare(
          [
            "SELECT",
            "p.promotion_id,",
            "p.action,",
            "p.from_revision_id,",
            "p.to_revision_id,",
            "p.created_at,",
            "p.created_by,",
            "r.payload_sha256",
            "FROM catalog_promotions p",
            "LEFT JOIN catalog_revisions r",
            "ON r.revision_id = p.to_revision_id",
            "ORDER BY p.created_at DESC",
            "LIMIT 30"
          ].join(" ")
        )
        .all();

    const history =
      (rows.results || []).map(row => ({
        promotion_id: row.promotion_id,
        action: row.action,
        from_revision_id: row.from_revision_id,
        to_revision_id: row.to_revision_id,
        revision_id: row.to_revision_id,
        payload_sha256: row.payload_sha256,
        created_at: row.created_at,
        created_by: row.created_by,
        is_published:
          Boolean(published.revision_id && row.to_revision_id === published.revision_id)
      }));

    return obaApiJson({
      ok: true,
      current_published_id: published.revision_id,
      current_preview_id: preview.revision_id,
      current_draft_id: draft.revision_id,
      history,
      slots: await obaCatalogSlotsState(env)
    });
  }

  if (
    url.pathname === "/api/publish" &&
    request.method === "GET"
  ) {
    const preview =
      await obaLoadCatalogSlot(env, "PREVIEW");

    const published =
      await obaLoadCatalogSlot(env, "PUBLISHED");

    return obaApiJson({
      ok: true,
      preview: {
        revision_id: preview.revision_id,
        payload_sha256: preview.payload_sha256
      },
      published: {
        revision_id: published.revision_id,
        payload_sha256: published.payload_sha256
      },
      slots: await obaCatalogSlotsState(env)
    });
  }

  if (request.method !== "POST") {
    return obaApiJson(
      { ok: false, error: "method_not_allowed" },
      405
    );
  }

  let body;
  try {
    body = await request.json();
  }
  catch {
    return obaApiJson(
      { ok: false, error: "invalid_json" },
      400
    );
  }

  if (url.pathname === "/api/publish") {
    if (!body || body.confirm !== "PUBLISH") {
      return obaApiJson(
        {
          ok: false,
          error: "publish_confirmation_required"
        },
        400
      );
    }

    const preview =
      await obaLoadCatalogSlot(env, "PREVIEW");

    const published =
      await obaLoadCatalogSlot(env, "PUBLISHED");

    if (!preview.revision_id || !preview.payload) {
      return obaApiJson(
        { ok: false, error: "preview_missing" },
        409
      );
    }

    if (
      !body.expected_revision_id ||
      body.expected_revision_id !== preview.revision_id
    ) {
      return obaApiJson(
        {
          ok: false,
          error: "preview_stale",
          expected_revision_id:
            body.expected_revision_id || null,
          current_preview_revision_id:
            preview.revision_id
        },
        409
      );
    }

    if (published.revision_id === preview.revision_id) {
      return obaApiJson({
        ok: true,
        slot: "PUBLISHED",
        revision_id: preview.revision_id,
        payload_sha256: preview.payload_sha256,
        previous_revision_id: published.revision_id,
        reused: true,
        slots: await obaCatalogSlotsState(env)
      });
    }

    const now = new Date().toISOString();
    const promotionId =
      "promotion_" +
      crypto.randomUUID().replaceAll("-", "");

    await env.DB.batch([
      env.DB
        .prepare(
          [
            "UPDATE catalog_slots",
            "SET revision_id = ?,",
            "updated_at = ?",
            "WHERE slot = 'PUBLISHED'"
          ].join(" ")
        )
        .bind(preview.revision_id, now),

      env.DB
        .prepare(
          [
            "INSERT INTO catalog_promotions",
            "(",
            "promotion_id,",
            "action,",
            "from_revision_id,",
            "to_revision_id,",
            "created_at,",
            "created_by",
            ")",
            "VALUES (?, ?, ?, ?, ?, ?)"
          ].join(" ")
        )
        .bind(
          promotionId,
          "PUBLISHED",
          published.revision_id,
          preview.revision_id,
          now,
          "admin"
        )
    ]);

    const after =
      await obaLoadCatalogSlot(env, "PUBLISHED");

    if (after.revision_id !== preview.revision_id) {
      throw new Error("published_post_write_mismatch");
    }

    return obaApiJson({
      ok: true,
      slot: "PUBLISHED",
      revision_id: after.revision_id,
      payload_sha256: after.payload_sha256,
      previous_revision_id: published.revision_id,
      promotion_id: promotionId,
      reused: false,
      slots: await obaCatalogSlotsState(env)
    });
  }

  /* /api/publish/rollback */

  if (
    !body ||
    body.confirm !== "ROLLBACK" ||
    !body.revision_id
  ) {
    return obaApiJson(
      {
        ok: false,
        error: "rollback_confirmation_required"
      },
      400
    );
  }

  const target =
    await env.DB
      .prepare(
        [
          "SELECT",
          "revision_id,",
          "payload_sha256",
          "FROM catalog_revisions",
          "WHERE revision_id = ?",
          "LIMIT 1"
        ].join(" ")
      )
      .bind(body.revision_id)
      .first();

  if (!target) {
    return obaApiJson(
      {
        ok: false,
        error: "rollback_revision_not_found"
      },
      404
    );
  }

  const published =
    await obaLoadCatalogSlot(env, "PUBLISHED");

  if (published.revision_id === target.revision_id) {
    return obaApiJson({
      ok: true,
      slot: "PUBLISHED",
      revision_id: target.revision_id,
      payload_sha256: target.payload_sha256,
      previous_revision_id: published.revision_id,
      reused: true,
      rolled_back: true,
      slots: await obaCatalogSlotsState(env)
    });
  }

  const now = new Date().toISOString();
  const promotionId =
    "promotion_" +
    crypto.randomUUID().replaceAll("-", "");

  await env.DB.batch([
    env.DB
      .prepare(
        [
          "UPDATE catalog_slots",
          "SET revision_id = ?,",
          "updated_at = ?",
          "WHERE slot = 'PUBLISHED'"
        ].join(" ")
      )
      .bind(target.revision_id, now),

    env.DB
      .prepare(
        [
          "INSERT INTO catalog_promotions",
          "(",
          "promotion_id,",
          "action,",
          "from_revision_id,",
          "to_revision_id,",
          "created_at,",
          "created_by",
          ")",
          "VALUES (?, ?, ?, ?, ?, ?)"
        ].join(" ")
      )
      .bind(
        promotionId,
        "ROLLBACK",
        published.revision_id,
        target.revision_id,
        now,
        "admin"
      )
  ]);

  const after =
    await obaLoadCatalogSlot(env, "PUBLISHED");

  if (after.revision_id !== target.revision_id) {
    throw new Error("rollback_post_write_mismatch");
  }

  return obaApiJson({
    ok: true,
    slot: "PUBLISHED",
    revision_id: after.revision_id,
    payload_sha256: after.payload_sha256,
    previous_revision_id: published.revision_id,
    promotion_id: promotionId,
    reused: false,
    rolled_back: true,
    slots: await obaCatalogSlotsState(env)
  });
}

/* OBA_MEDIA_API_BEGIN */

async function obaHandleMediaServe(request, env, url) {
  const mediaId = url.pathname.slice("/api/media/".length).trim();
  if (!mediaId) {
    return json({ ok: false, error: "media_id_required" }, 400);
  }

  const row = await env.DB
    .prepare(
      "SELECT media_id, mime_type, data_base64, size_bytes FROM catalog_media WHERE media_id = ? LIMIT 1"
    )
    .bind(mediaId)
    .first();

  if (!row) {
    return json({ ok: false, error: "media_not_found" }, 404);
  }

  const ifNoneMatch = request.headers.get("if-none-match");
  const etag = `"${row.media_id}"`;

  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        "ETag": etag,
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  }

  try {
    const raw = atob(row.data_base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": row.mime_type || "image/jpeg",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": etag,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return json({ ok: false, error: "media_corrupted" }, 500);
  }
}

async function obaHandleMediaApi(request, env, url) {
  if (
    url.pathname !== "/api/media" &&
    url.pathname !== "/api/media/upload" &&
    url.pathname !== "/api/upload-image"
  ) {
    return null;
  }

  if (url.pathname === "/api/media" && request.method === "GET") {
    const rows = await env.DB
      .prepare(
        "SELECT media_id, mime_type, size_bytes, created_at, created_by FROM catalog_media ORDER BY created_at DESC LIMIT 50"
      )
      .all();

    return obaApiJson({
      ok: true,
      media: rows.results || []
    });
  }

  if (
    (url.pathname === "/api/media/upload" || url.pathname === "/api/upload-image") &&
    request.method === "POST"
  ) {
    let body;
    try {
      body = await request.json();
    } catch {
      return obaApiJson({ ok: false, error: "invalid_json_body" }, 400);
    }

    if (!body || !body.base64) {
      return obaApiJson({ ok: false, error: "base64_data_required" }, 400);
    }

    const cleanBase64 = String(body.base64).replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, "").trim();
    if (cleanBase64.length < 10) {
      return obaApiJson({ ok: false, error: "base64_too_short" }, 400);
    }

    if (cleanBase64.length > 2000000) {
      return obaApiJson({ ok: false, error: "image_too_large_max_1mb" }, 413);
    }

    let mimeType = String(body.mime_type || "").toLowerCase();
    if (!mimeType && body.fileName) {
      const ext = String(body.fileName).split(".").pop().toLowerCase();
      if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
      else if (ext === "png") mimeType = "image/png";
      else if (ext === "webp") mimeType = "image/webp";
      else if (ext === "gif") mimeType = "image/gif";
    }

    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)) {
      mimeType = "image/jpeg";
    }

    const sizeBytes = Math.floor((cleanBase64.length * 3) / 4);
    const mediaId = "media_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    const now = new Date().toISOString();

    await env.DB
      .prepare(
        [
          "INSERT INTO catalog_media",
          "(media_id, mime_type, data_base64, size_bytes, created_at, created_by)",
          "VALUES (?, ?, ?, ?, ?, ?)"
        ].join(" ")
      )
      .bind(
        mediaId,
        mimeType,
        cleanBase64,
        sizeBytes,
        now,
        "admin"
      )
      .run();

    const mediaPath = `/api/media/${mediaId}`;

    return obaApiJson({
      ok: true,
      media_id: mediaId,
      path: mediaPath,
      mime_type: mimeType,
      size_bytes: sizeBytes
    });
  }

  return obaApiJson({ ok: false, error: "method_not_allowed" }, 405);
}

/* OBA_MEDIA_API_END */

async function obaPrivatePreviewPage(request, env) {
  const preview = await obaLoadCatalogSlot(env, "PREVIEW");
  if (!preview.revision_id || !preview.payload) {
    return new Response(
      "<!doctype html><html lang='pt-BR'><meta charset='utf-8'><title>Preview indisponivel</title><body><h1>Preview ainda nao foi criado.</h1><p>Volte a Central e clique em Visualizar cardapio.</p></body></html>",
      { status: 409, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } }
    );
  }

  const assetUrl = new URL(request.url);
  assetUrl.pathname = "/ui-desenvolvimento/index.html";
  assetUrl.search = "";
  assetUrl.hash = "";
  const asset = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET", headers: request.headers }));
  if (!asset.ok) return new Response("Preview asset unavailable", { status: 502 });

  const source = await asset.text();
  const inject = "<base href='/'><script src='/preview-bootstrap.js'></script>";
  const html = source.includes("<head>") ? source.replace("<head>", "<head>" + inject) : inject + source;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com data:; img-src * data: blob:; connect-src 'self' https:; form-action 'self'; frame-ancestors 'none'; base-uri 'self'"
    }
  });
}

/* OBA_PREVIEW_API_END */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "oba-cardapio-gestao",
        auth: "worker-gate",
      });
    }

    if (url.pathname === "/__auth/login") {
      if (request.method === "GET") {
        return response(loginPage(), 200, {
          "Content-Type": "text/html; charset=utf-8",
        });
      }

      if (request.method === "POST") {
        return handleLogin(request, env);
      }

      return response("Method Not Allowed", 405, {
        "Allow": "GET, POST",
      });
    }

    if (url.pathname === "/__auth/logout") {
      if (request.method !== "POST") {
        return response("Method Not Allowed", 405, {
          "Allow": "POST",
        });
      }

      const authenticated = await validateSession(request, env);

      if (!authenticated) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }

      if (!csrfValid(request)) {
        return json({ ok: false, error: "csrf" }, 403);
      }

      return handleLogout();
    }

    if (url.pathname.startsWith("/api/media/") && request.method === "GET") {
      return obaHandleMediaServe(request, env, url);
    }

    const authenticated = await validateSession(request, env);

    if (!authenticated) {
      if (url.pathname.startsWith("/api/")) {
        return json(
          {
            ok: false,
            error: "unauthorized",
          },
          401
        );
      }

      return response("", 303, {
        "Location": "/__auth/login",
      });
    }

    if (
      url.pathname.startsWith("/api/") &&
      isUnsafeMethod(request.method) &&
      !csrfValid(request)
    ) {
      return json(
        {
          ok: false,
          error: "csrf",
        },
        403
      );
    }

    if (url.pathname === "/__preview") {
      return obaPrivatePreviewPage(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      const obaMediaResponse =
        await obaHandleMediaApi(
          request,
          env,
          url
        );

      if (obaMediaResponse) {
        return obaMediaResponse;
      }

      const obaPublishResponse =
        await obaHandlePublishApi(
          request,
          env,
          url
        );

      if (obaPublishResponse) {
        return obaPublishResponse;
      }

      const obaPreviewResponse =
        await obaHandlePreviewApi(
          request,
          env,
          url
        );

      if (obaPreviewResponse) {
        return obaPreviewResponse;
      }

const obaDraftResponse =
        await obaHandleDraftApi(
          request,
          env,
          url
        );

      if (obaDraftResponse) {
        return obaDraftResponse;
      }


    const obaCatalogReadResponse =
      await obaHandleCatalogReadApi(
        request,
        env
      );

    if (obaCatalogReadResponse) {
      return obaCatalogReadResponse;
    }

return json(
        {
          ok: false,
          error: "not_implemented",
        },
        501
      );
    }

    return env.ASSETS.fetch(request);
  },
};
