# 3. Padrões Transactional Outbox (SKIP LOCKED) e Inbox Persistente com AWS SQS FIFO

**Data:** 2026-11-10  
**Contexto Técnico:** Backend Challenge — Distributed Wagering Processor  

---

## Contexto e Problema
A integração com mensageria externa (AWS SQS FIFO) envolve dois problemas críticos em sistemas distribuídos:
1. **Problema da Escrita Dupla (*Dual-Write*):** Publicar eventos diretamente no broker e comitar no banco de dados na mesma operação de aplicação resulta em inconsistência caso um dos dois falhe.
2. **Entregas Repetidas e Fora de Ordem:** O broker SQS opera com garantia *at-least-once*. Quedas do consumidor antes do `deleteMessage` geram redelivery da mensagem.

## Decisão Arquitetural
Implementar os padrões **Transactional Outbox** e **Inbox Persistente** acoplados ao PostgreSQL e AWS SQS FIFO:

### Detalhamento da Decisão:
1. **Transactional Outbox Atômico:**
   * Na mesma transação SQL que atualiza a carteira e insere o razão contábil, o evento de integração é inserido na tabela `outbox_messages` (`published_at IS NULL`).
   * Elimina completamente o dual-write problem: se a transação falhar, o evento não é gerado; se o banco comitar, o evento está garantido.
2. **Outbox Relayer Concorrente via `SKIP LOCKED`:**
   * O worker varre lotes pendentes utilizando:
     ```sql
     SELECT id, aggregate_id, event_type, payload, occurred_at
     FROM outbox_messages
     WHERE published_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
     ORDER BY occurred_at ASC LIMIT 10
     FOR UPDATE SKIP LOCKED;
     ```
   * Múltiplas instâncias do worker rodam em paralelo sem conflito de locks nem duplicidade de publicação.
   * Publicação com `MessageGroupId = aggregateId` (ordem causal) e `MessageDeduplicationId = eventId` (deduplicação na rede).
3. **Inbox Persistente:**
   * O consumidor SQS registra a tupla `(consumer_name, message_id)` na tabela `inbox_messages` dentro da mesma transação do processamento.
   * Em caso de redelivery da mensagem, a restrição de PRIMARY KEY barra reprocessamento e evita débitos duplicados no razão.

## Consequências
* **Positivas:**
  * Consistência eventual garantida entre banco e broker.
  * Resiliência a oscilações de rede com retry e backoff exponencial.
  * Tolerância a falhas abruptas do processo (Crash Recovery comprovado).
* **Negativas / Mitigações:**
  * Lag de publicação em milissegundos entre o commit e o despacho no SQS (mitigado por índices parciais e polling ágil).
