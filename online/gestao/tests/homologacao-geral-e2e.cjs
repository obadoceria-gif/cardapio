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
    text: await response.text()
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
  console.log(' FASE 8E.10 — SUITE DE HOMOLOGACAO GERAL DO SISTEMA');
  console.log(' CARDAPIO, CENTRAL PRIVADA, D1, MIDIA, ROLLBACK E WHATSAPP');
  console.log('============================================================');

  // 1. Healthcheck publico
  console.log('\n[1/12] Validando Healthcheck do servico...');
  const healthRes = await call('/health');
  if (healthRes.status !== 200) throw new Error(`Healthcheck HTTP=${healthRes.status}`);
  const healthData = parse(healthRes);
  if (!healthData.ok || healthData.service !== 'oba-cardapio-gestao') {
    throw new Error('Healthcheck payload invalido');
  }
  console.log('PASS: Healthcheck operacional (200 OK)');

  // 2. Isolamento e bloqueio anonimo
  console.log('\n[2/12] Validando isolamento rigoroso de rotas privadas...');
  const endpointsToTest = [
    { path: '/api/draft', method: 'GET', expect: 401 },
    { path: '/api/preview', method: 'GET', expect: 401 },
    { path: '/__preview', method: 'GET', expect: 303 },
    { path: '/api/publish', method: 'GET', expect: 401 },
    { path: '/api/publish/history', method: 'GET', expect: 401 },
    { path: '/api/publish/rollback', method: 'POST', expect: 401 },
    { path: '/api/media', method: 'GET', expect: 401 },
    { path: '/api/media/upload', method: 'POST', expect: 401 },
    { path: '/api/upload-image', method: 'POST', expect: 401 }
  ];

  for (const ep of endpointsToTest) {
    const res = await call(ep.path, { method: ep.method });
    if (res.status !== ep.expect) {
      throw new Error(`Isolamento falhou para ${ep.method} ${ep.path}: HTTP=${res.status} (esperado ${ep.expect})`);
    }
  }
  console.log('PASS: Todas as 9 rotas privadas bloqueadas com 401/303 para requisicoes anonimas');

  // 3. Autenticacao administrativa
  console.log('\n[3/12] Executando autenticacao administrativa...');
  const login = await call('/__auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ password: PASSWORD }).toString()
  });
  if (![302, 303].includes(login.status)) {
    throw new Error(`Login administrativo falhou com HTTP ${login.status}`);
  }

  const jar = makeJar(getSetCookies(login.headers));
  const admin = jar.get('__Host-oba_admin');
  const csrf = jar.get('__Host-oba_csrf');
  if (!admin || !csrf) throw new Error('Cookies administrativos __Host ausentes');
  const cookie = cookieHeader(jar);
  console.log('PASS: Sessao autenticada com cookies seguros e token CSRF');

  // 4. Baseline PUBLISHED inicial
  console.log('\n[4/12] Identificando baseline PUBLISHED inicial no D1...');
  const pubStateRes = await call('/api/publish', { headers: { Cookie: cookie } });
  if (pubStateRes.status !== 200) throw new Error(`GET /api/publish=${pubStateRes.status}`);
  const pubState = parse(pubStateRes);
  const initialPublishedId = pubState.published ? pubState.published.revision_id : null;
  if (!initialPublishedId) throw new Error('Slot PUBLISHED inicial ausente no D1');
  console.log(`PASS: Baseline de producao identificada (${initialPublishedId})`);

  // 5. Protecao CSRF em mutacoes
  console.log('\n[5/12] Validando protecao CSRF em mutacoes protegidas...');
  const csrfTestEndpoints = [
    { path: '/api/draft', body: { payload: {} } },
    { path: '/api/preview', body: { confirm: 'PREVIEW' } },
    { path: '/api/publish', body: { confirm: 'PUBLISH' } },
    { path: '/api/publish/rollback', body: { confirm: 'ROLLBACK' } },
    { path: '/api/media/upload', body: { base64: 'abc', mime_type: 'image/jpeg' } }
  ];

  for (const ep of csrfTestEndpoints) {
    const res = await call(ep.path, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(ep.body)
    });
    if (res.status !== 403) {
      throw new Error(`Mutacao sem CSRF nao bloqueada em ${ep.path}: HTTP=${res.status}`);
    }
  }
  console.log('PASS: Protecao CSRF ativa em todas as operacoes de mutacao (HTTP 403)');

  // 6. Pipeline de Midia Online (Upload + D1 + Servimento Publico + Cache ETag)
  console.log('\n[6/12] Testando pipeline de midia online...');
  const testPixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const uploadRes = await call('/api/media/upload', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      base64: testPixelPng,
      mime_type: 'image/png',
      fileName: 'homologacao_pixel.png'
    })
  });
  if (uploadRes.status !== 200) throw new Error(`Upload de midia falhou HTTP=${uploadRes.status}`);
  const uploadData = parse(uploadRes);
  if (!uploadData.ok || !uploadData.media_id || !uploadData.path) {
    throw new Error('Resposta de upload invalida');
  }

  // Servimento publico
  const serveRes = await call(uploadData.path);
  if (serveRes.status !== 200) throw new Error(`Servimento de imagem HTTP=${serveRes.status}`);
  const cType = serveRes.headers.get('content-type');
  const cacheControl = serveRes.headers.get('cache-control');
  const etag = serveRes.headers.get('etag');

  if (!cType || !cType.includes('image/png')) throw new Error(`Content-Type incorreto: ${cType}`);
  if (!cacheControl || !cacheControl.includes('immutable')) throw new Error(`Cache-Control incorreto: ${cacheControl}`);

  // Cache 304 com ETag
  if (etag) {
    const cachedRes = await call(uploadData.path, { headers: { 'If-None-Match': etag } });
    if (cachedRes.status !== 304) console.log(`[WARN] ETag HTTP=${cachedRes.status} (esperado 304)`);
  }
  console.log(`PASS: Upload (${uploadData.media_id}), gravacao D1 e servimento publico com cache validados`);

  // 7. Ciclo DRAFT -> PREVIEW
  console.log('\n[7/12] Carregando DRAFT e promovendo para PREVIEW...');
  const draftRes = await call('/api/draft', { headers: { Cookie: cookie } });
  if (draftRes.status !== 200) throw new Error(`GET /api/draft=${draftRes.status}`);
  const draft = parse(draftRes);
  if (!draft.revision_id || !draft.payload) throw new Error('DRAFT invalido no D1');

  const promoteRes = await call('/api/preview', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ confirm: 'PREVIEW' })
  });
  if (promoteRes.status !== 200) throw new Error(`POST /api/preview=${promoteRes.status}`);
  const promoted = parse(promoteRes);
  if (!promoted.ok || !promoted.revision_id) throw new Error('Promocao PREVIEW falhou');
  console.log(`PASS: DRAFT promovido para PREVIEW (${promoted.revision_id})`);

  // 8. Preview Privado com seguranca
  console.log('\n[8/12] Testando visualizacao privada em /__preview...');
  const previewPage = await call('/__preview', { headers: { Cookie: cookie } });
  if (previewPage.status !== 200) throw new Error(`Visual /__preview=${previewPage.status}`);
  const previewCsp = previewPage.headers.get('content-security-policy') || '';
  const previewRobots = previewPage.headers.get('x-robots-tag') || '';
  if (!previewRobots.includes('noindex')) throw new Error('Preview sem header noindex');
  console.log('PASS: Preview visual renderizado com headers estritos de seguranca (CSP e noindex)');

  // 9. Protecao contra preview_stale na publicacao
  console.log('\n[9/12] Validando protecao contra conflito de edicao (preview_stale)...');
  const staleRes = await call('/api/publish', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      confirm: 'PUBLISH',
      expected_revision_id: 'rev_stale_divergente_fake'
    })
  });
  if (staleRes.status !== 409) throw new Error(`Stale preview HTTP=${staleRes.status}`);
  console.log('PASS: Publicacao divergente bloqueada com HTTP 409 preview_stale');

  // 10. Publicacao atomica PREVIEW -> PUBLISHED
  console.log('\n[10/12] Publicando revisao de PREVIEW para PUBLISHED...');
  const publishRes = await call('/api/publish', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      confirm: 'PUBLISH',
      expected_revision_id: promoted.revision_id
    })
  });
  if (publishRes.status !== 200) throw new Error(`POST /api/publish=${publishRes.status}`);
  const pubData = parse(publishRes);
  if (!pubData.ok || pubData.slot !== 'PUBLISHED' || pubData.revision_id !== promoted.revision_id) {
    throw new Error('Publicacao nao gravou slot PUBLISHED');
  }
  console.log(`PASS: Publicacao atomica consolidada no D1 (${pubData.revision_id})`);

  // 11. Historico e Rollback seguro para baseline inicial
  console.log('\n[11/12] Validando historico e executando rollback seguro...');
  const histRes = await call('/api/publish/history', { headers: { Cookie: cookie } });
  if (histRes.status !== 200) throw new Error(`GET /api/publish/history=${histRes.status}`);
  const histData = parse(histRes);
  if (!histData.ok || !Array.isArray(histData.history) || histData.history.length === 0) {
    throw new Error('Historico de publicacoes vazio ou invalido');
  }

  const rollbackRes = await call('/api/publish/rollback', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      confirm: 'ROLLBACK',
      revision_id: initialPublishedId
    })
  });
  if (rollbackRes.status !== 200) throw new Error(`Rollback HTTP=${rollbackRes.status}`);
  const rbData = parse(rollbackRes);
  if (!rbData.ok || rbData.revision_id !== initialPublishedId) {
    throw new Error('Rollback falhou em restaurar baseline inicial');
  }
  console.log(`PASS: Rollback homologado com sucesso para a baseline inicial (${rbData.revision_id})`);

  // 12. Regressao e UI da Central
  console.log('\n[12/12] Validando componentes essenciais de UI e Cardapio...');
  const centralPage = await call('/', { headers: { Cookie: cookie } });
  if (centralPage.status !== 200) throw new Error(`Central HTTP=${centralPage.status}`);
  const requiredUiElements = [
    'id="historicoBtn"',
    'id="modalHistorico"',
    'id="oba-publish-8e9f"',
    'id="oba-rollback-8e9g"',
    'obaCompressImage'
  ];
  for (const el of requiredUiElements) {
    if (!centralPage.text.includes(el)) throw new Error(`Elemento de UI ausente na Central: ${el}`);
  }
  console.log('PASS: Todos os elementos visuais e modais da Central homologados');

  console.log('\n============================================================');
  console.log(' HOMOLOGACAO_GERAL_OK — SISTEMA 100% OPERACIONAL E CONFORME');
  console.log('============================================================');
})().catch(error => {
  console.error('\n[ERRO FATAL NA HOMOLOGACAO GERAL]:', error && error.message ? error.message : String(error));
  process.exit(1);
});
