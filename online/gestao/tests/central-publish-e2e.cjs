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
  console.log(' E2E INTEGRADO: AUTH -> DRAFT -> PREVIEW -> PUBLISH -> ROLLBACK');
  console.log('============================================================');

  // 1. Anonimo bloqueado
  console.log('\n[1/10] Testando bloqueio anonimo...');
  const anonPrevApi = await call('/api/preview');
  if (anonPrevApi.status !== 401) throw new Error(`GET /api/preview anon=${anonPrevApi.status}`);

  const anonPrevPage = await call('/__preview');
  if (anonPrevPage.status !== 303) throw new Error(`GET /__preview anon=${anonPrevPage.status}`);

  const anonPubGet = await call('/api/publish');
  if (anonPubGet.status !== 401) throw new Error(`GET /api/publish anon=${anonPubGet.status}`);

  const anonPubPost = await call('/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'PUBLISH' })
  });
  if (anonPubPost.status !== 401) throw new Error(`POST /api/publish anon=${anonPubPost.status}`);

  const anonRollback = await call('/api/publish/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'ROLLBACK' })
  });
  if (anonRollback.status !== 401) throw new Error(`POST /api/publish/rollback anon=${anonRollback.status}`);
  console.log('PASS: Todas as rotas privadas bloqueadas para anonimos (401/303)');

  // 2. Login unico autenticado
  console.log('\n[2/10] Realizando autenticacao administrativa...');
  const login = await call('/__auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ password: PASSWORD }).toString()
  });
  if (![302, 303].includes(login.status)) {
    throw new Error(`Login falhou com HTTP ${login.status} (verifique a senha fornecida)`);
  }

  const jar = makeJar(getSetCookies(login.headers));
  const admin = jar.get('__Host-oba_admin');
  const csrf = jar.get('__Host-oba_csrf');
  if (!admin || !csrf) throw new Error('Cookies admin/csrf ausentes na resposta de login');

  const cookie = cookieHeader(jar);
  console.log('PASS: Sessao autenticada com cookies seguros e token CSRF');

  // Obter baseline publicada inicial e validar historico
  const histAnon = await call('/api/publish/history');
  if (histAnon.status !== 401) throw new Error(`GET /api/publish/history anon=${histAnon.status}`);
  console.log('PASS: GET /api/publish/history anonimo 401');

  const pubStateRes = await call('/api/publish', { headers: { Cookie: cookie } });
  if (pubStateRes.status !== 200) throw new Error(`GET /api/publish=${pubStateRes.status}`);
  const pubState = parse(pubStateRes);
  const initialPublishedId = pubState.published ? pubState.published.revision_id : null;
  if (!initialPublishedId) throw new Error('Slot PUBLISHED inicial ausente no D1');
  console.log(`PASS: Baseline PUBLISHED inicial identificada (${initialPublishedId})`);

  const histRes = await call('/api/publish/history', { headers: { Cookie: cookie } });
  if (histRes.status !== 200) throw new Error(`GET /api/publish/history=${histRes.status}`);
  const histData = parse(histRes);
  if (!histData.ok || !Array.isArray(histData.history)) throw new Error('Historico de publicacoes invalido');
  console.log(`PASS: Historico de publicacoes carregado com ${histData.history.length} registros`);

  // Validar elementos de UI da Central
  const centralPage = await call('/', { headers: { Cookie: cookie } });
  if (centralPage.status !== 200) throw new Error(`Central HTTP=${centralPage.status}`);
  for (const el of ['id="historicoBtn"', 'id="modalHistorico"', 'id="oba-rollback-8e9g"']) {
    if (!centralPage.text.includes(el)) throw new Error(`Elemento de UI ausente na Central: ${el}`);
  }
  console.log('PASS: Elementos visuais de Historico e Rollback presentes na Central');

  // 3. CSRF obrigatorio em mutacoes
  console.log('\n[3/10] Validando protecao contra CSRF...');
  const noCsrf = await call('/api/publish', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'PUBLISH' })
  });
  if (noCsrf.status !== 403) throw new Error(`POST sem CSRF=${noCsrf.status}`);
  console.log('PASS: Requisicoes de mutacao sem header X-CSRF-Token rejeitadas (HTTP 403)');

  // 4. Confirmacao obrigatoria
  console.log('\n[4/10] Validando confirmacao explicita...');
  const badConfirm = await call('/api/publish', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ confirm: 'INVALIDO' })
  });
  if (badConfirm.status !== 400) throw new Error(`Confirmacao invalida HTTP=${badConfirm.status}`);
  console.log('PASS: Payload com confirmacao invalida rejeitado (HTTP 400)');

  // 5. Estado inicial DRAFT e PREVIEW
  console.log('\n[5/10] Carregando DRAFT e promovendo para PREVIEW...');
  const draftRes = await call('/api/draft', { headers: { Cookie: cookie } });
  if (draftRes.status !== 200) throw new Error(`GET /api/draft=${draftRes.status}`);
  const draft = parse(draftRes);
  if (!draft.revision_id || !draft.payload) throw new Error('DRAFT persistente ausente');

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
  if (!promoted.ok || promoted.slot !== 'PREVIEW' || !promoted.revision_id) {
    throw new Error('Promocao para PREVIEW falhou');
  }
  console.log(`PASS: DRAFT promovido para PREVIEW (${promoted.revision_id})`);

  // 6. Preview visual privado
  console.log('\n[6/10] Validando acesso visual ao Preview...');
  const previewVisual = await call('/__preview', { headers: { Cookie: cookie } });
  if (previewVisual.status !== 200) throw new Error(`Visual /__preview=${previewVisual.status}`);
  if (!previewVisual.text.includes("<base href='/'") && !previewVisual.text.includes('<base href="/"')) {
    throw new Error('Base href ausente no HTML do preview');
  }
  console.log('PASS: Preview visual autenticado renderizado com sucesso');

  // 7. Protecao contra preview_stale na publicacao
  console.log('\n[7/10] Testando protecao contra preview_stale...');
  const staleRes = await call('/api/publish', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      confirm: 'PUBLISH',
      expected_revision_id: 'rev_inexistente_divergente'
    })
  });
  if (staleRes.status !== 409) throw new Error(`Stale preview HTTP=${staleRes.status}`);
  console.log('PASS: Publicacao com revisao divergente rejeitada (HTTP 409 preview_stale)');

  // 8. Publicacao PREVIEW -> PUBLISHED
  console.log('\n[8/10] Publicando revisao de PREVIEW para PUBLISHED...');
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
  if (publishRes.status !== 200) throw new Error(`POST /api/publish=${publishRes.status} ${publishRes.text}`);
  const pubData = parse(publishRes);
  if (!pubData.ok || pubData.slot !== 'PUBLISHED' || pubData.revision_id !== promoted.revision_id) {
    throw new Error('Publicacao nao atualizou slot PUBLISHED');
  }
  console.log(`PASS: Slot PUBLISHED atualizado para ${pubData.revision_id} (reused=${pubData.reused})`);

  // 9. Rollback seguro para baseline inicial
  console.log('\n[9/10] Testando rollback para revisao homologada inicial...');
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
  if (rollbackRes.status !== 200) throw new Error(`POST /api/publish/rollback=${rollbackRes.status} ${rollbackRes.text}`);
  const rbData = parse(rollbackRes);
  if (!rbData.ok || rbData.slot !== 'PUBLISHED' || !rbData.rolled_back || rbData.revision_id !== initialPublishedId) {
    throw new Error('Rollback falhou em restaurar revisao inicial');
  }
  console.log(`PASS: Rollback homologado com sucesso (slot PUBLISHED=${rbData.revision_id})`);

  // 10. Conclusao
  console.log('\n[10/10] Finalizando auditoria...');
  console.log('============================================================');
  console.log(' CENTRAL_PUBLISH_E2E_OK — PUBLICACAO E ROLLBACK 100% HOMOLOGADOS');
  console.log('============================================================');
})().catch(error => {
  console.error('\n[ERRO FATAL E2E]:', error && error.message ? error.message : String(error));
  process.exit(1);
});
