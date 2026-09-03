## FASE 8E.10 — Homologação Geral do Sistema
Data de consolidacao: 2026-09-03

### Adicionado
- Suíte unificada de testes E2E ponta a ponta (`online/gestao/tests/homologacao-geral-e2e.cjs`) cobrindo 12 etapas críticas do sistema.
- Script de automação e checkpoint de segurança (.scripts/8E9/EXECUTAR_8E10_HOMOLOGACAO.ps1 e atalho EXECUTAR-8E10-HOMOLOGACAO.cmd).

### Validado
- Healthcheck do serviço online (GET /health -> HTTP 200).
- Isolamento total de rotas privadas contra acessos anônimos (9 endpoints bloqueados com HTTP 401/303).
- Autenticação administrativa e emissão segura de cookies __Host e tokens CSRF.
- Proteção CSRF obrigatória contra ataques de mutação em todos os endpoints sensíveis (HTTP 403).
- Ciclo de Mídia Online: Upload autenticado de imagem, persistência atômica no D1 (`catalog_media`), entrega pública com cache imutável (`Cache-Control: public, max-age=31536000, immutable`), suporte a ETag (HTTP 304) e validação de galeria.
- Ciclo de Catálogo: Carregamento e salvamento de DRAFT, promoção para PREVIEW, renderização privada de Preview (`/__preview`) com headers estritos de segurança (CSP, noindex).
- Proteção contra `preview_stale` (HTTP 409) na tentativa de publicação com revisão divergente.
- Promoção atômica PREVIEW -> PUBLISHED com preservação de integridade no D1.
- Histórico de versões (GET /api/publish/history) e Rollback atômico seguro para a baseline inicial (`pub_c3b7ee083866bb26a7a0b881`).
- Integridade de UI da Central e do Cardápio: ausência de alerts nativos, modais de confirmação funcionais e conformidade com regras comerciais.

---

## FASE 8E.9H — Pipeline de Mídia Online (Upload, D1 e Servimento Público)
Data de consolidacao: 2026-09-03

### Adicionado
- Migration D1 `0002_catalog_media.sql` para tabela `catalog_media` com restrições e índices.
- Endpoint público `GET /api/media/:id` com headers de cache imutável (`Cache-Control: public, max-age=31536000, immutable`), suporte a `ETag` (HTTP 304) e `X-Content-Type-Options: nosniff`.
- Endpoint autenticado `POST /api/media/upload` (e compatibilidade `/api/upload-image`) com validação de payload, sanitização Base64 e proteção CSRF.
- Endpoint autenticado `GET /api/media` para listagem de galeria de mídias cadastradas.
- Compressão client-side na Central de Gestão (`obaCompressImage` via HTML5 Canvas) antes do upload, reduzindo tamanho de imagem para ~800px / JPEG 85%.
- Teste E2E automatizado de mídia (`online/gestao/tests/media-e2e.cjs`).
- Script de comando único para execução de pipeline (.scripts/8E9/EXECUTAR_8E9H_MIDIA.ps1 e EXECUTAR-8E9H-MIDIA.cmd).

### Validado
- Bloqueio anônimo em upload de mídia (HTTP 401).
- Proteção contra CSRF em requisições de upload (HTTP 403).
- Upload autenticado com geração de ID de mídia e gravação atômica no D1.
- Servimento público com Content-Type, Content-Length e Cache-Control corretos.
- Resposta HTTP 304 Not Modified sob validação de ETag / If-None-Match.
- Consulta de galeria via GET /api/media.
- Regressão completa de publicação e rollback (DRAFT -> PREVIEW -> PUBLISH -> ROLLBACK).
- Integridade total do slot PUBLISHED e tabela catalog_media após homologação E2E.

---

## FASE 8E.9G — Rollback Operacional na Central de Gestão
Data de consolidacao: 2026-09-02

### Adicionado
- Endpoint GET /api/publish/history para consulta de promoções, histórico de revisões e slot ativo.
- Botão "Histórico de versões" na barra de ações superior (.topbar) da Central.
- Modal `<dialog id="modalHistorico">` com listagem de versões históricas e badge "No ar" / "Histórica".
- Ação interativa de restauração (Rollback) com confirmação explícita na Central.
- Script de comando único para execução de pipeline (.scripts/8E9/EXECUTAR_8E9G_ROLLBACK.ps1 e EXECUTAR-8E9G-ROLLBACK.cmd).

### Validado
- Consulta autenticada de histórico via GET /api/publish/history.
- Presença e comportamento dos elementos visuais de histórico e restauração na Central.
- Rollback para revisão histórica inicial via API e UI.
- Integridade total do slot PUBLISHED e auditoria D1.

---

## FASE 8E.9F — Publicação Segura e Rollback
Data de consolidacao: 2026-09-02

### Adicionado
- Endpoint POST /api/publish para promoção atômica PREVIEW -> PUBLISHED.
- Endpoint POST /api/publish/rollback para reversão controlada de revisões.
- Proteção contra `preview_stale` (HTTP 409) fixando `expected_revision_id`.
- Teste E2E automatizado integrado (online/gestao/tests/central-publish-e2e.cjs).
- Script de comando único para execução de pipeline (.scripts/8E9/EXECUTAR_8E9F_PUBLICACAO.ps1 e EXECUTAR-8E9F-PUBLICACAO.cmd).

### Corrigido
- Sincronização de ações em catalog_promotions no D1 (PUBLISHED e ROLLBACK) em estrita conformidade com o schema e restrições CHECK do SQLite.

### Validado
- Bloqueio anônimo em endpoints privados (401/303).
- Validação de sessão e CSRF em mutações.
- Promoção DRAFT -> PREVIEW -> PUBLISHED no Cloudflare D1.
- Rollback para revisão histórica inicial sem perda de dados.
- Integridade total do slot PUBLISHED e tabela catalog_promotions.

---

## R1.17-D - Continuidade do Fluxo Mobile

### Adicionado
- feedback visual curto entre etapas;
- orientacao de proxima etapa no carrinho;
- contexto de progresso no checkout;
- feedback de retorno ao carrinho.

### Preservado
- carrinho em viewport R1.17-B;
- checkout em etapa propria R1.17-C;
- fluxo de finalizacao via WhatsApp;
- estado do pedido durante navegacao.

### Validado
- carrinho -> checkout;
- checkout -> carrinho;
- retorno ao checkout;
- preservacao de itens e total;
- finalizacao do pedido;
- console sem TypeError.

### Proxima etapa
R1.18 - consolidacao e auditoria do fluxo comercial completo.

---
## R1.17-B - Carrinho em Viewport
Data de consolidacao: 2026-08-16

### Adicionado
- Carrinho mobile em viewport dedicada
- Header persistente
- Footer persistente
- Lista central rolavel
- Contagem de produtos e unidades
- Numeracao dos produtos
- Indicador de continuidade para produtos ocultos
- Scroll suave pelo indicador
- Gerenciamento de foco e inert

### Melhorado
- Descoberta de produtos abaixo da area visivel
- Total e proximas acoes permanecem acessiveis
- Carrinhos extensos nao aumentam indefinidamente a pagina
- Usuario nao precisa adivinhar que existem produtos abaixo

### Validado
- 1 e 2 produtos
- multiplos produtos
- 5 produtos
- incremento de unidades
- remocao
- total
- lista interna rolavel
- indicador de continuidade
- header e footer persistentes

### Proxima etapa
R1.17-C - Checkout em etapa propria.

---
## R1.17-A - Fluxo Mobile por Etapas
Data de consolidacao: 2026-08-16

### Adicionado
- Tela dedicada de escolha da Caixa Degustacao
- Tela dedicada de revisao do produto
- Navegacao Voltar e alterar
- Acoes separadas para continuar comprando, ver carrinho e finalizar
- Controle mobile baseado em 100dvh

### Alterado
- Escolher 12/25 deixa de salvar automaticamente o produto
- Inclusao no carrinho acontece somente apos acao explicita do usuario
- Informacoes deixaram de ser empilhadas abaixo da foto
- Fluxo mobile passa a operar por etapas

### Validado
- Degustacao 12
- Degustacao 25
- Preservacao da escolha ao voltar
- Tela de escolha sem rolagem para encontrar a proxima acao
- Tela de revisao sem rolagem para encontrar a proxima acao
- Console sem TypeError

### Proxima etapa
R1.17-B - Carrinho em viewport com cabecalho e acoes persistentes.

---
# CHANGELOG

## R1.16-K - Mobile First e Carrinho Global
Data de consolidacao: 2026-08-16

### Adicionado
- Experiencia Mobile First para Caixa Degustacao
- Seletor de 12 e 25 doces
- Lightbox ampliado
- Comparacao 12/25
- Carrinho global com badge
- Modal unico de carrinho
- Conclusao direta de caixas normais no carrinho

### Alterado
- Degustacao deixou de depender de modal intermediario
- Carrinho deixou de ocupar painel permanente nas paginas
- Caixa normal concluida passa diretamente para o carrinho
- Badge passa a refletir itens salvos
- WhatsApp deixa de competir com produtos em areas criticas

### Corrigido
- Undefined em dados da caixa de degustacao
- Inicializacao prematura das configuracoes de caixas
- Dependencias antigas mobile-total e mobile-label
- Sobreposicao do WhatsApp
- Inconsistencia entre fluxo da degustacao e caixas normais

### Validado
- Caixa Degustacao 12
- Caixa Degustacao 25
- Caixa normal de 25 doces
- Carrinho com multiplos itens
- Alteracao de quantidade
- Remocao de itens
- Total consolidado
- Abertura do carrinho pelo badge
- Testes mobile em viewport aproximada de 390x844

### Pendencias
- Imagens 12/25 fisicamente distintas ainda nao existem
- Fluxo mobile por etapas ainda sera implementado
- Checkout ainda compartilha a mesma tela do carrinho

---

## R1.15
- Integracao de configuracoes do Modelo Mestre
- Protecao da inicializacao de caixas
- Estrutura de degustacao preparada para hidratacao assincrona

## R1.14 e anteriores
O historico tecnico completo permanece preservado no Git.

<!-- R1.17-C-CHANGELOG -->

## R1.17-C

### Adicionado

- checkout em etapa própria;
- resumo compacto do pedido;
- campos de entrega;
- seleção de pagamento;
- validação de preenchimento;
- navegação checkout → carrinho;
- integração checkout → fluxo oficial → WhatsApp.

### UX

O carrinho passa a ser dedicado à revisão dos produtos.
Os dados de entrega e finalização passam a ocupar uma etapa
independente, reduzindo excesso de conteúdo no mesmo viewport.

### Compatibilidade

A R1.17-B foi preservada como base do carrinho em viewport.

## R1.18-C - CONSOLIDACAO FINAL

Data: 2026-08-16 21:39:51

### Resultado
- R1.18-A: auditoria consolidada aprovada.
- 67 checks executados.
- 67 checks aprovados.
- 0 falhas estruturais.
- R1.18-B: regressao funcional aprovada em navegador real.
- Fluxo validado: produto -> carrinho -> checkout -> voltar -> checkout -> WhatsApp.
- Carrinho preservou produtos, quantidades, subtotais e total.
- Checkout preservou o estado comercial.
- Validacoes de entrega verificadas.
- Finalizacao via WhatsApp verificada.
- Nenhum erro funcional observado no console durante a regressao.
- UX mobile consolidada.
- Carrinho em viewport propria consolidado.
- Checkout em etapa propria consolidado.
- Continuidade entre etapas consolidada.

### Decisao
R1.18 consolidada sobre o fluxo oficial.

### Seguranca
- promocao controlada;
- candidato temporario removido;
- documentacao versionada;
- push nao executado.

## R1.19-B01

- Adicionada proteção contra duplo envio no checkout.
- Adicionado lock temporário de finalização.
- Adicionado feedback visual PROCESSANDO PEDIDO....
- Adicionados ria-disabled e ria-busy durante processamento.
- Mantida compatibilidade com o fluxo legado e WhatsApp.
## R1.19-D

### UX
- substituído padrão de duplo toque para exclusão;
- lixeira agora abre modal de confirmação com um único toque;
- adicionadas ações explícitas para manter ou remover item;
- feedback de inclusão no carrinho passou a utilizar modal persistente.

### Acessibilidade
- corrigido foco retido dentro do modal ao aplicar aria-hidden;
- corrigido foco retido dentro do carrinho ao ocultar a viewport;
- adicionada proteção global antes de aria-hidden=true no carrinho.

### Regressão
- carrinho preservado;
- checkout preservado;
- WhatsApp preservado;
- R1.19-B01 preservada.
## R1.20-B01

### UX
- removidas confirmações nativas do navegador;
- saída de montagem agora usa modal central;
- quantidade zero agora usa modal central;
- ações de cancelar/confirmar ficaram consistentes com o restante do carrinho.

### Arquitetura
- criado adapter assíncrono para reutilizar o modal R1.19-D;
- funções dos dois fluxos tornadas assíncronas somente onde necessário.

### Regressão
- zero chamadas nativas de confirmação em código executável;
- carrinho preservado;
- checkout preservado;
- acessibilidade preservada;
- proteção contra duplo envio preservada.
============================================================
R1.20-B02 - ZERO alert() NATIVO + FEEDBACK INTEGRADO
Data: 2026-08-17 22:39:23
============================================================

RESULTADO:
- 4 alert() nativos eliminados.
- Checkout sem produtos migrado para feedback integrado.
- Checkout incompleto migrado para feedback integrado.
- Personalizados incompleto migrado para feedback integrado.
- Eventos incompleto migrado para feedback integrado.
- Modal reutilizavel R1.19-D preservado.
- Foco contextual preservado.
- Fluxos WhatsApp de Personalizados e Eventos preservados.

CORRECAO WPP1:
- Identificado window.open() da finalizacao dentro de fetch.finally().
- Adicionado mecanismo robusto de abertura do WhatsApp.
- Primeira tentativa: window.open().
- Fallback: window.location.assign().
- Teste funcional aprovado.
- WhatsApp abriu corretamente ao finalizar pedido.

VALIDACAO:
- alert() nativo restante: 0.
- R1.20-B01 preservado.
- R1.19-D preservado.
- Carrinho preservado.
- Checkout preservado.
- Acessibilidade preservada.
- Teste funcional aprovado.

STATUS:
CONCLUIDO E APROVADO.

PROXIMA ACAO:
R1.20-B03 - PROXIMO ITEM PRIORIZADO DO BACKLOG.
============================================================
## R1.20-B03 — asset Degustação 25 Sabores

Data: 2026-08-17 23:51:03

Status: encerrado tecnicamente / pendência externa de conteúdo.

Diagnóstico:
- Degustacao_12_Sabores.jpeg e Degustacao_25_Sabores.jpeg possuem conteúdo binário idêntico;
- inventário visual completo do ui-desenvolvimento analisado;
- 82 imagens físicas;
- 81 conteúdos únicos;
- nenhuma fotografia correta da Caixa Degustação 25 Sabores foi localizada.

Decisão:
- não reutilizar conscientemente a fotografia da caixa de 12 sabores como solução definitiva;
- não gerar ou inventar fotografia substituta;
- não substituir por asset sem autenticação;
- manter a referência atual até que a fotografia oficial correta seja fornecida;
- classificar a correção como dependência externa de conteúdo, não como bloqueio técnico.

Próxima ação:
R1.20-B04 — próximo gap técnico real do backlog.