# Central de Gestão Online — Manual de Operação

## 1. Visão Geral
A Central de Gestão Online da Oba Doceria é uma aplicação privada hospedada na infraestrutura de alta performance da **Cloudflare (Workers + D1 + Static Assets)**, desenvolvida sob premissa estrita de **segurança máxima, isolamento de produção, zero custo e sem necessidade de cartão de crédito**.

---

## 2. Como Acessar a Central

- **Atalho no Windows:** Dê 2 cliques no arquivo [`ABRIR-CENTRAL-ONLINE.cmd`](file:///c:/Users/pc_fa/Documents/Projeto_Gemini/ABRIR-CENTRAL-ONLINE.cmd) na pasta do projeto.
- **Acesso direto via Navegador:** [https://oba-cardapio-gestao.obadoceria.workers.dev/](https://oba-cardapio-gestao.obadoceria.workers.dev/)

Ao acessar, insira a **senha administrativa** definida para o ambiente. A sessão utiliza cookies seguros e token anti-CSRF para proteção contra invasões e requisições forjadas.

---

## 3. Ciclo de Vida de Edição e Publicação

A gestão opera sob o modelo de 3 slots isolados:

$$\text{DRAFT (Rascunho)} \longrightarrow \text{PREVIEW (Conferência)} \longrightarrow \text{PUBLISHED (No Ar)}$$

### 3.1. DRAFT (Rascunho de Edição)
- Ao abrir a Central, você está sempre editando o slot **DRAFT**.
- Você pode alterar preços, sabores, categorias, descrições e banners à vontade sem que os clientes vejam nada em tempo real.
- Clique em **"Salvar rascunho"** para persistir as edições no banco D1.

### 3.2. PREVIEW (Conferência Visual Privada)
- Clique no botão **"Visualizar cardápio"** na barra superior.
- Uma nova aba abrirá no endereço protegido `/__preview`, exibindo o cardápio exatamente como os clientes verão.
- O Preview é alimentado dinamicamente pelos dados do seu DRAFT promovido.

### 3.3. PUBLISHED (Publicação no Ar)
- Após conferir o cardápio no Preview, clique em **"Publicar cardápio"** na Central.
- O sistema valida se a versão conferida no Preview ainda é a atual (proteção anti-stale) e promove a revisão atomicamente para produção.
- Todos os clientes passam a ver o catálogo atualizado instantaneamente.

### 3.4. Histórico de Versões e Rollback (Restauração Instantânea)
- Clique em **"Histórico de versões"** na barra superior para abrir o modal de auditoria.
- Veja todas as versões publicadas com data, hora e hash SHA-256.
- Para reverter para qualquer versão anterior, basta clicar em **"Restaurar"** ao lado da versão desejada e confirmar. O cardápio volta no mesmo segundo para a versão escolhida.

---

## 4. Gerenciamento e Upload de Imagens

- Ao editar um doce, categoria ou caixa, clique em **"Escolher arquivo"** para selecionar uma foto do seu computador/celular.
- **Compressão Inteligente:** A imagem é redimensionada e otimizada automaticamente no navegador (Canvas HTML5), mantendo alta qualidade visual em menos de 100 KB.
- **Armazenamento Seguro:** A imagem é salva no banco SQLite D1 (`catalog_media`) e servida via `/api/media/:id` com cache de longa duração (`Cache-Control: public, max-age=31536000, immutable`) e suporte a ETag (HTTP 304).

---

## 5. Scripts e Automação de Suporte

Na pasta `.scripts/8E9/` estão disponíveis runners automatizados para auditorias e deploys:

| Executável | Finalidade |
|---|---|
| [`EXECUTAR-8E10-HOMOLOGACAO.cmd`](file:///c:/Users/pc_fa/Documents/Projeto_Gemini/EXECUTAR-8E10-HOMOLOGACAO.cmd) | Executa os 12 passos da homologação geral do sistema e valida a integridade do D1. |
| [`EXECUTAR-8E9H-MIDIA.cmd`](file:///c:/Users/pc_fa/Documents/Projeto_Gemini/EXECUTAR-8E9H-MIDIA.cmd) | Valida o pipeline de upload e entrega pública de mídia. |
| [`EXECUTAR-8E9G-ROLLBACK.cmd`](file:///c:/Users/pc_fa/Documents/Projeto_Gemini/EXECUTAR-8E9G-ROLLBACK.cmd) | Valida o mecanismo de histórico e reversão atômica. |
| [`EXECUTAR-8E9F-PUBLICACAO.cmd`](file:///c:/Users/pc_fa/Documents/Projeto_Gemini/EXECUTAR-8E9F-PUBLICACAO.cmd) | Valida a publicação atômica PREVIEW -> PUBLISHED com trava anti-stale. |
