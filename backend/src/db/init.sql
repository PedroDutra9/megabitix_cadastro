-- ══════════════════════════════════════════════════
--  MEGABITIX — Schema do Banco de Dados
--  Executado automaticamente ao criar o container
-- ══════════════════════════════════════════════════

-- Extensões
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── USUÁRIOS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
    id          SERIAL PRIMARY KEY,
    nome        VARCHAR(100) NOT NULL,
    email       VARCHAR(150) UNIQUE NOT NULL,
    senha_hash  TEXT NOT NULL,
    perfil      VARCHAR(20) NOT NULL DEFAULT 'vendedor' CHECK (perfil IN ('admin', 'vendedor')),
    ativo       BOOLEAN NOT NULL DEFAULT true,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_login TIMESTAMPTZ
);

-- ─── CLIENTES ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
    id          SERIAL PRIMARY KEY,
    nome        VARCHAR(200) NOT NULL,
    doc         VARCHAR(20)  NOT NULL,
    tel         VARCHAR(20),
    email       VARCHAR(150),
    cep         VARCHAR(10),
    rua         VARCHAR(200),
    num         VARCHAR(20),
    comp        VARCHAR(100),
    bairro      VARCHAR(100),
    cidade      VARCHAR(100),
    estado      CHAR(2),
    rep         VARCHAR(150),
    cpf_rep     VARCHAR(20),
    cargo_rep   VARCHAR(100),
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PRODUTOS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS produtos (
    id          SERIAL PRIMARY KEY,
    nome        VARCHAR(200) NOT NULL,
    categoria   VARCHAR(50)  NOT NULL,
    marca       VARCHAR(100),
    modelo      VARCHAR(100),
    descricao   TEXT,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── NÚMEROS DE SÉRIE ────────────────────────────────
CREATE TABLE IF NOT EXISTS seriais (
    id          SERIAL PRIMARY KEY,
    produto_id  INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
    sn          VARCHAR(100) NOT NULL UNIQUE,
    status      VARCHAR(20) NOT NULL DEFAULT 'disponível' CHECK (status IN ('disponível', 'vendido', 'reservado')),
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── VENDAS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendas (
    id              SERIAL PRIMARY KEY,
    num             SERIAL,
    cliente_id      INTEGER NOT NULL REFERENCES clientes(id),
    usuario_id      INTEGER REFERENCES usuarios(id),
    valor_total     NUMERIC(12,2) NOT NULL,
    forma_pagamento VARCHAR(30) NOT NULL CHECK (forma_pagamento IN ('À vista', 'Cartão de crédito', 'Parcelado')),
    status          VARCHAR(20) NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Em andamento', 'Pago')),
    -- Parcelamento
    entrada         NUMERIC(12,2),
    num_parcelas    INTEGER,
    dia_vencimento  INTEGER,
    valor_parcela   NUMERIC(12,2),
    saldo_restante  NUMERIC(12,2),
    -- Implantação
    tem_implantacao BOOLEAN NOT NULL DEFAULT false,
    impl_data       DATE,
    impl_descricao  TEXT,
    -- Controle
    data_venda      DATE NOT NULL DEFAULT CURRENT_DATE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ITENS DA VENDA ──────────────────────────────────
CREATE TABLE IF NOT EXISTS venda_itens (
    id          SERIAL PRIMARY KEY,
    venda_id    INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    produto_id  INTEGER NOT NULL REFERENCES produtos(id),
    serial_id   INTEGER NOT NULL REFERENCES seriais(id),
    valor_unit  NUMERIC(12,2) NOT NULL DEFAULT 0,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── CONTRATOS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS contratos (
    id          SERIAL PRIMARY KEY,
    num_contrato VARCHAR(20) NOT NULL UNIQUE,
    venda_id    INTEGER NOT NULL REFERENCES vendas(id),
    gerado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    gerado_por  INTEGER REFERENCES usuarios(id)
);

-- ─── ÍNDICES ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_seriais_produto  ON seriais(produto_id);
CREATE INDEX IF NOT EXISTS idx_seriais_status   ON seriais(status);
CREATE INDEX IF NOT EXISTS idx_venda_itens_venda ON venda_itens(venda_id);
CREATE INDEX IF NOT EXISTS idx_vendas_cliente   ON vendas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_vendas_status    ON vendas(status);
CREATE INDEX IF NOT EXISTS idx_vendas_data      ON vendas(data_venda);

-- ─── TRIGGER: atualizado_em automático ──────────────
CREATE OR REPLACE FUNCTION set_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN NEW.atualizado_em = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clientes_updated  BEFORE UPDATE ON clientes  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE TRIGGER trg_produtos_updated  BEFORE UPDATE ON produtos  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE TRIGGER trg_vendas_updated    BEFORE UPDATE ON vendas    FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- ─── SEED: Usuário admin padrão ──────────────────────
-- Senha padrão: Admin@2024 (troque no primeiro acesso)
INSERT INTO usuarios (nome, email, senha_hash, perfil)
VALUES (
    'Administrador',
    'admin@megabitix.com.br',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewYpfQPB9TtEcfOW', -- Admin@2024
    'admin'
) ON CONFLICT (email) DO NOTHING;

-- ─── SEED: Dados de exemplo ──────────────────────────
INSERT INTO clientes (nome, doc, tel, email, rua, num, bairro, cidade, estado, cep, rep, cpf_rep, cargo_rep)
VALUES 
    ('Tech Solutions Ltda.', '12.345.678/0001-90', '(11) 98765-4321', 'contato@techsol.com',
     'Av. Paulista', '1000', 'Bela Vista', 'São Paulo', 'SP', '01310-100',
     'Carlos Eduardo Mendes', '123.456.789-00', 'Diretor de TI'),
    ('Flylink Serv e Telecon Ltda.', '07.593.083/0001-19', '(91) 3333-4444', 'comercial@flylink.com.br',
     'R. São Clemente', '300', 'Bengui', 'Belém', 'PA', '66.630-080',
     'Raphael Cardoso de Oliveira', '727.412.522-20', 'Sócio Administrador')
ON CONFLICT DO NOTHING;

INSERT INTO produtos (nome, categoria, marca, modelo, descricao)
VALUES
    ('Roteador Cisco ASR 1001-X', 'Roteador', 'Cisco', 'ASR 1001-X', 'Roteador de serviços agregados, semi novo'),
    ('Roteador Cisco ASR 1002-X', 'Roteador', 'Cisco', 'ASR 1002-X', 'Roteador de alta performance, semi novo'),
    ('Servidor Dell PowerEdge R750', 'Servidor', 'Dell', 'PowerEdge R750', 'Servidor rack 2U'),
    ('A10 Thunder CFW', 'CGNAT', 'A10 Networks', 'Thunder CFW', 'Appliance CGNAT/Firewall')
ON CONFLICT DO NOTHING;

-- Séries de exemplo (só insere se os produtos foram inseridos)
INSERT INTO seriais (produto_id, sn, status)
SELECT p.id, s.sn, 'disponível'
FROM produtos p, (VALUES
    ('Roteador Cisco ASR 1001-X', 'SN-ASR1001-2024-001'),
    ('Roteador Cisco ASR 1001-X', 'SN-ASR1001-2024-002'),
    ('Roteador Cisco ASR 1002-X', 'FOX1811GPTP'),
    ('Roteador Cisco ASR 1002-X', 'SN-ASR1002-2024-001'),
    ('Servidor Dell PowerEdge R750', 'SN-DELL-R750-001'),
    ('A10 Thunder CFW', 'SN-A10-CFW-001'),
    ('A10 Thunder CFW', 'SN-A10-CFW-002')
) AS s(produto_nome, sn)
WHERE p.nome = s.produto_nome
ON CONFLICT (sn) DO NOTHING;
