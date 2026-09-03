# Oba Doceria — Cardápio Virtual Interativo & Central de Gestão

Sistema completo de cardápio digital interativo e central de gestão online segura para a Oba Doceria.

---

## 🚀 Acesso Rápido

- **Central de Gestão Online:** [https://oba-cardapio-gestao.obadoceria.workers.dev/](https://oba-cardapio-gestao.obadoceria.workers.dev/)
  *(Ou abra pelo atalho [`ABRIR-CENTRAL-ONLINE.cmd`](ABRIR-CENTRAL-ONLINE.cmd))*
- **Cardápio Virtual Público:** [`ui-desenvolvimento/index.html`](ui-desenvolvimento/index.html) *(ou entrypoint [`index.html`](index.html))*

---

## 📖 Documentação e Manuais

Consulte o índice mestre de documentação:
👉 **[docs/INDICE_DOCUMENTACAO.md](docs/INDICE_DOCUMENTACAO.md)**

- **Manual da Gestão Online:** [`docs/CENTRAL_ONLINE_MANUAL.md`](docs/CENTRAL_ONLINE_MANUAL.md)
- **Manual do Cardápio:** [`docs/MANUAL_CARDAPIO.md`](docs/MANUAL_CARDAPIO.md)
- **Guia Tira-Dúvidas:** [`docs/GUIA_TIRA_DUVIDAS.md`](docs/GUIA_TIRA_DUVIDAS.md)
- **Decisões de Arquitetura (D001-D013):** [`docs/DECISIONS.md`](docs/DECISIONS.md)
- **Estado Atual e Governança:** [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md)
- **Histórico de Mudanças:** [`CHANGELOG.md`](CHANGELOG.md)

---

## 🏗️ Arquitetura do Sistema

```
[ Central Privada ] ---> DRAFT ---> PREVIEW ---> PUBLISHED ---> [ Cardápio Público ]
                                       ^             |
                                       |             v
                                       +--- ROLLBACK +
```

1. **Segurança Máxima:** Central protegida por autenticação HMAC, cookies `__Host`, rate limiting, headers estritos (`CSP`, `nosniff`, `noindex`) e tokens CSRF obrigatórios.
2. **Ciclo Controlado:** Edições ocorrem exclusivamente no slot `DRAFT`, são validadas em `PREVIEW` (`/__preview`), e promovidas com segurança atômica para `PUBLISHED` no Cloudflare D1.
3. **Rollback Instantâneo:** Histórico completo de revisões disponível com botão de restauração instantânea.
4. **Mídia Online Otimizada:** Upload de imagens com compressão client-side (Canvas HTML5), persistência em SQLite D1 (`catalog_media`) e servimento público imutável com cache e ETag (`304 Not Modified`).
5. **Zero Custo / Sem Cartão:** Toda a arquitetura opera de forma autônoma dentro dos limites gratuitos da Cloudflare.

---

## 🛠️ Suíte de Automação e Verificação

Os runners automatizados de testes e deploys ficam disponíveis em `.scripts/8E9/`:

- [`EXECUTAR-8E10-HOMOLOGACAO.cmd`](EXECUTAR-8E10-HOMOLOGACAO.cmd): Executa os 12 passos da homologação geral do sistema e auditoria de integridade do D1.
- [`EXECUTAR-8E9H-MIDIA.cmd`](EXECUTAR-8E9H-MIDIA.cmd): Validação do pipeline de mídia.
- [`EXECUTAR-8E9G-ROLLBACK.cmd`](EXECUTAR-8E9G-ROLLBACK.cmd): Validação de histórico e rollback.
- [`EXECUTAR-8E9F-PUBLICACAO.cmd`](EXECUTAR-8E9F-PUBLICACAO.cmd): Validação da publicação segura e prevenção de preview stale.
