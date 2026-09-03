# HANDOFF

Atualizado: 2026-09-03 12:47:00

Projeto: Oba Doceria - Cardapio Virtual + Central de Gestao.
Branch: feature/gestao-online-segura

## Ultima fase aprovada
8E.10 — Homologação Geral do Sistema (Gestão Ponta a Ponta, Cardápio, Mídia, Segurança e WhatsApp).

- Central -> DRAFT: operacional e autenticada.
- DRAFT -> PREVIEW: operacional com promoção auditada.
- Preview privado (/__preview): operacional com isolamento estrito (CSP e noindex).
- PREVIEW -> PUBLISHED: operacional com proteção anti-stale (HTTP 409) e batch atômico no D1.
- GET /api/publish/history: operacional (retorna promoções, revisões e status ativo).
- UI da Central: botão "Histórico de versões", modal e restauração instantânea homologados.
- Rollback seguro: operacional via UI e API, com integridade confirmada no D1.
- Mídia Online: upload com compressão Canvas, gravação no D1 (`catalog_media`) e servimento público com cache imutável e ETag / 304.
- Segurança: isolamento de 9 rotas privadas contra acessos anônimos (401/303) e proteção CSRF em mutações (403).
- Cardápio & WhatsApp: regras de negócio e checkout preservados.
- Zero serviços pagos / sem cartão.

## Proximo passo
Encerramento da migração: Remoção controlada da exposição da Central pública antiga, consolidação de backups e documentação de release.

Leia AGENTS.md, docs/CURRENT_STATE.md, docs/DECISIONS.md e docs/ROADMAP.md antes de alterar codigo.
