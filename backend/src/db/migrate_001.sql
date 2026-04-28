-- ══════════════════════════════════════════════════
--  MIGRAÇÃO: Parcelas + Contrato Assinado
--  Execute: docker compose exec postgres psql -U megabitix -d megabitix -f /docker-entrypoint-initdb.d/migrate_001.sql
-- ══════════════════════════════════════════════════

-- ─── PARCELAS DE PAGAMENTO ───────────────────────
CREATE TABLE IF NOT EXISTS parcelas (
    id              SERIAL PRIMARY KEY,
    venda_id        INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    numero          INTEGER NOT NULL,          -- 1, 2, 3...
    valor           NUMERIC(12,2) NOT NULL,
    data_vencimento DATE NOT NULL,
    data_pagamento  DATE,
    status          VARCHAR(20) NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente', 'pago', 'vencido', 'cancelado')),
    observacao      TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parcelas_venda   ON parcelas(venda_id);
CREATE INDEX IF NOT EXISTS idx_parcelas_status  ON parcelas(status);
CREATE INDEX IF NOT EXISTS idx_parcelas_vencto  ON parcelas(data_vencimento);

CREATE TRIGGER trg_parcelas_updated
  BEFORE UPDATE ON parcelas
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- ─── CONTRATO ASSINADO (armazenado como base64) ──
ALTER TABLE contratos
  ADD COLUMN IF NOT EXISTS assinado_nome     TEXT,
  ADD COLUMN IF NOT EXISTS assinado_base64   TEXT,
  ADD COLUMN IF NOT EXISTS assinado_em       TIMESTAMPTZ;

-- ─── ENTRADA como parcela 0 (se parcelado) ───────
-- Nada a fazer no schema — a entrada é controlada na lógica da aplicação
