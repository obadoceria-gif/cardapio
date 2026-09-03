# DECISIONS

## D001 — GitHub como fonte canônica

Código, documentação, releases e histórico oficial vivem no repositório Git.

## D002 — Produção não é área de edição

Editar nunca significa publicar.

Fluxo obrigatório:

DRAFT -> PREVIEW -> PUBLISHED.

## D003 — Revisões imutáveis

Uma revisão publicada não é editada.

Novas alterações criam ou reutilizam revisões identificadas por conteúdo/SHA-256.

## D004 — Central privada

A administração não pode ser exposta como página pública sem proteção real.

## D005 — Autenticação no Worker

Cloudflare Access/Zero Trust não foi adotado porque a configuração disponível exigiu informações de pagamento.

A autenticação foi implementada na aplicação/Worker, mantendo o requisito de zero custo e sem cartão.

## D006 — Secrets

Passwords, session secrets e tokens nunca ficam no navegador, Git ou arquivos versionados.

## D007 — Publicação pública preservada durante migração

O cardápio público existente continua funcionando enquanto a nova gestão é construída isoladamente.

## D008 — Cloud writes protegidos

Checkpoint + gates + build antes de qualquer deploy ou D1 write.

## D009 — Fail closed

Se uma fase crítica falhar, não avançar automaticamente para a fase seguinte.

## D010 — Automação prioritária

Automatizar diagnóstico, patch, testes, checkpoints, deploy seguro, rollback, documentação e handoff sempre que possível.

## D011 — Portabilidade entre IAs

O repositório deve conter contexto suficiente para continuidade em ChatGPT, Claude, Cursor, Cline, Copilot ou outra ferramenta.

## D012 — Scripts persistentes

Evitar scripts extremamente longos colados diretamente no PSReadLine. Preferir scripts versionados em `.scripts/`.

## D013 — Armazenamento de mídia zero custo no D1

O Cloudflare R2 ou serviços externos de storage frequentemente exigem inserção de cartão de crédito. Para manter a premissa de zero custo e sem cartão, as imagens enviadas pela gestão são compactadas no navegador (Canvas HTML5) e persistidas em tabela dedicada (`catalog_media`) no Cloudflare D1 como Base64, sendo servidas publicamente via `/api/media/:id` com headers de cache imutável e ETag.
