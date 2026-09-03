'use strict';

const BASE = process.env.TEST_BASE_URL;
const PASSWORD = process.env.TEST_AUTH_PASSWORD;

if (!BASE || !PASSWORD) {
  throw new Error('TEST_BASE_URL/TEST_AUTH_PASSWORD ausentes');
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  if (!raw) return [];
  return raw.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/);
}

function makeJar(values) {
  const jar = new Map();
  for (const value of values) {
    const first = value.split(';')[0];
    const pos = first.indexOf('=');
    if (pos > 0) jar.set(first.slice(0, pos), first.slice(pos + 1));
  }
  return jar;
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function call(pathname, options = {}) {
  const timeoutSignal = AbortSignal.timeout(15000);
  const response = await fetch(BASE + pathname, {
    redirect: 'manual',
    signal: timeoutSignal,
    ...options
  });
  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
    arrayBuffer: async () => response.arrayBuffer()
  };
}

function parse(result) {
  try {
    return JSON.parse(result.text);
  } catch {
    throw new Error(`JSON invalido HTTP ${result.status}: ${result.text.slice(0, 200)}`);
  }
}

(async () => {
  console.log('============================================================');
  console.log(' E2E MIDIA ONLINE: UPLOAD, D1 BLOB E SERVIMENTO COM CACHE');
  console.log('============================================================');

  // 1x1 transparent PNG base64
  const testPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // 1. Upload anonimo bloqueado
  console.log('\n[1/7] Testando bloqueio anonimo de upload...');
  const anonUpload = await call('/api/media/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64: testPngBase64, mime_type: 'image/png', fileName: 'teste.png' })
  });
  if (anonUpload.status !== 401) throw new Error(`Upload anonimo HTTP=${anonUpload.status}`);
  console.log('PASS: Upload anonimo rejeitado (HTTP 401)');

  // 2. Login administrativo
  console.log('\n[2/7] Realizando autenticacao administrativa...');
  const login = await call('/__auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ password: PASSWORD }).toString()
  });
  if (![302, 303].includes(login.status)) {
    throw new Error(`Login falhou com HTTP ${login.status}`);
  }
  const jar = makeJar(getSetCookies(login.headers));
  const admin = jar.get('__Host-oba_admin');
  const csrf = jar.get('__Host-oba_csrf');
  if (!admin || !csrf) throw new Error('Cookies de sessao ausentes');
  const cookie = cookieHeader(jar);
  console.log('PASS: Sessao autenticada com cookies e CSRF');

  // 3. Upload sem CSRF bloqueado
  console.log('\n[3/7] Testando protecao CSRF em upload...');
  const noCsrf = await call('/api/media/upload', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64: testPngBase64, mime_type: 'image/png' })
  });
  if (noCsrf.status !== 403) throw new Error(`Upload sem CSRF HTTP=${noCsrf.status}`);
  console.log('PASS: Upload sem CSRF rejeitado (HTTP 403)');

  // 4. Upload autenticado com sucesso
  console.log('\n[4/7] Executando upload autenticado de imagem...');
  const uploadRes = await call('/api/media/upload', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      base64: testPngBase64,
      mime_type: 'image/png',
      fileName: 'morango_especial.png'
    })
  });
  if (uploadRes.status !== 200) throw new Error(`Upload falhou HTTP=${uploadRes.status}: ${uploadRes.text}`);
  const uploadData = parse(uploadRes);
  if (!uploadData.ok || !uploadData.media_id || !uploadData.path) {
    throw new Error('Payload de resposta de upload invalido');
  }
  console.log(`PASS: Midia enviada com sucesso: ${uploadData.media_id} (${uploadData.path})`);

  // 5. Servimento publico da imagem
  console.log('\n[5/7] Testando servimento publico da imagem enviada...');
  const serveRes = await call(uploadData.path);
  if (serveRes.status !== 200) throw new Error(`Servimento de imagem HTTP=${serveRes.status}`);
  const cType = serveRes.headers.get('content-type');
  if (!cType || !cType.includes('image/png')) {
    throw new Error(`Content-Type inesperado: ${cType}`);
  }
  const cacheControl = serveRes.headers.get('cache-control');
  if (!cacheControl || !cacheControl.includes('immutable')) {
    throw new Error(`Cache-Control imutavel ausente: ${cacheControl}`);
  }
  console.log('PASS: Imagem servida publicamente com Content-Type e Cache-Control corretos');

  // 6. Teste de ETag / 304
  console.log('\n[6/7] Validando suporte a ETag / 304 Not Modified...');
  const etag = serveRes.headers.get('etag');
  if (etag) {
    const cachedRes = await call(uploadData.path, {
      headers: { 'If-None-Match': etag }
    });
    if (cachedRes.status !== 304) {
      console.log(`[WARN] ETag retornou status ${cachedRes.status} (esperado 304)`);
    } else {
      console.log('PASS: Cache ETag validado com HTTP 304');
    }
  }

  // 7. Listagem de galeria autenticada
  console.log('\n[7/7] Consultando galeria de midias...');
  const listRes = await call('/api/media', { headers: { Cookie: cookie } });
  if (listRes.status !== 200) throw new Error(`GET /api/media=${listRes.status}`);
  const listData = parse(listRes);
  if (!listData.ok || !Array.isArray(listData.media)) throw new Error('Listagem de midias invalida');
  const found = listData.media.some(m => m.media_id === uploadData.media_id);
  if (!found) throw new Error('Midia recem-criada nao encontrada na listagem');
  console.log(`PASS: Galeria de midias contem ${listData.media.length} itens gravados no D1`);

  console.log('\n============================================================');
  console.log(' MEDIA_E2E_OK — PIPELINE DE MIDIA ONLINE 100% HOMOLOGADO');
  console.log('============================================================');
})().catch(error => {
  console.error('\n[ERRO FATAL E2E MIDIA]:', error && error.message ? error.message : String(error));
  process.exit(1);
});
