# 1. Escolha do MikroORM como Motor de Persistência e Exclusão do Prisma

**Data:** 2026-11-10  
**Contexto Técnico:** Backend Challenge — Distributed Wagering Processor  

---

## Contexto e Problema
O sistema atua como um processador financeiro distribuído de alta concorrência para transações de apostas de múltiplos provedores. Os requisitos inegociáveis incluem:
* Atomicidade transacional estrita (gravação conjunta de Carteira, Ledger, Inbox e Outbox).
* Bloqueio pessimista exclusivo particionado por carteira (`SELECT ... FOR UPDATE`).
* Desacoplamento arquitetural (Clean Architecture & DDD), onde o modelo de domínio deve ser puro e independente de decorators do banco.
* O edital oficial veda explicitamente o uso de Prisma (critério eliminatório).

## Decisão Arquitetural
Adotar o **MikroORM** como ORM oficial e descartar o **Prisma**.

### Motivações Técnicas:
1. **Unit of Work & Identity Map:** O MikroORM rastreia entidades e mutações transacionais nativamente, garantindo commits e rollbacks atômicos sem necessidade de sincronização manual.
2. **Suporte Nativo a `LockMode.PESSIMISTIC_WRITE`:** Permite emitir diretamente `SELECT ... FOR UPDATE` no momento da carga do agregado `Wallet`.
3. **Mapeamento Desacoplado via `EntitySchema`:** As entidades do domínio (`src/domain/entities/`) permanecem como classes puras em TypeScript, sem anotações do ORM. Os mapeamentos residem isolados em `src/infrastructure/database/schemas/`.
4. **Por que não Prisma:** O Prisma não adota Unit of Work/Identity Map, oculta transações sob query engine com conexões isoladas (gerando overhead de latência), impõe limitações em locks finos e exige schema proprietário (`schema.prisma`), violando o princípio *Domain-First*.

## Consequências
* **Positivas:**
  * Domínio 100% puro e testável sem dependência de banco em memória.
  * Controle transacional refinado com suporte completo a pessimistic locking.
  * Pleno cumprimento das regras do edital.
* **Negativas / Mitigações:**
  * Curva de aprendizado e mapeamento mais verboso via `EntitySchema`, mitigado por schemas centralizados e tipados.
