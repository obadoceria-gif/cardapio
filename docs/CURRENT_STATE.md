# CURRENT STATE

Atualizado: 2026-09-03 12:47:00

## Git
Branch: feature/gestao-online-segura
Baseline anterior da fase: d519493

## Estado funcional
- Central privada autenticada e 100% isolada da exposição pública.
- D1 operacional com schemas 0001_catalog_states.sql e 0002_catalog_media.sql.
- GET/POST /api/draft homologados (Central carrega DRAFT, edições gravam DRAFT).
- GET/POST /api/preview homologados (DRAFT -> PREVIEW).
- /__preview privado autenticado com headers estritos de segurança (CSP, noindex).
- POST /api/publish homologado (promoção atômica PREVIEW -> PUBLISHED).
- POST /api/publish/rollback homologado (reversão segura de revisão).
- GET /api/publish/history homologado (listagem de revisões e status ativo).
- Interface de Histórico de Versões e Rollback homologada na Central (modal, listagem e restauração instantânea com confirmação).
- Upload e gestão de mídia online homologados (POST /api/media/upload) com compressão client-side HTML5 Canvas.
- Servimento público de imagens homologado (GET /api/media/:id) com cache imutável (max-age=31536000, immutable) e suporte a ETag (HTTP 304).
- Galeria de imagens homologada (GET /api/media).
- Proteção contra preview_stale homologada (HTTP 409).
- Idempotência de publicação e rollback homologadas.
- Integridade do log catalog_promotions e tabela catalog_media no D1 confirmada.
- Slot PUBLISHED preservado e intacto (baseline pub_c3b7ee083866bb26a7a0b881).
- Suíte completa de Homologação Geral ponta a ponta 100% aprovada (.scripts/8E9/EXECUTAR_8E10_HOMOLOGACAO.ps1).

## Ultima fase aprovada
8E.10 — Homologação Geral do Sistema (Gestão Ponta a Ponta, Cardápio, Mídia, Segurança e WhatsApp).

## Proxima fase
Encerramento da migração: Remoção da exposição da Central pública antiga, consolidação dos backups e release final.
