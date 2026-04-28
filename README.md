# 🚀 Megabitix — Sistema de Gestão Comercial

Sistema web completo para gestão de vendas e geração de contratos da Megabitix Soluções em Conectividade Ltda.

## Stack

| Camada | Tecnologia |
|--------|------------|
| Frontend | HTML + CSS + JS vanilla (sem framework) |
| Backend | Node.js + Express |
| Banco de dados | PostgreSQL 16 |
| Servidor web | Nginx (reverse proxy) |
| Infraestrutura | Docker + Docker Compose |

---

## ⚡ Subir em 3 passos

### 1. Clone e configure o ambiente

```bash
git clone <seu-repositorio> megabitix
cd megabitix

# Copie e edite as variáveis de ambiente
cp .env.example .env
nano .env
```

### 2. Suba os containers

```bash
docker compose up -d --build
```

### 3. Acesse o sistema

```
http://localhost        → Sistema web
http://localhost/api/health → Health check da API
```

---

## 🔐 Login padrão

| Campo | Valor |
|-------|-------|
| E-mail | `admin@megabitix.com.br` |
| Senha | `Admin@2024` |

> ⚠️ **Troque a senha no primeiro acesso!** (Menu → Minha Conta → Trocar Senha)

---

## 📁 Estrutura do projeto

```
megabitix/
├── docker-compose.yml          # Orquestração dos serviços
├── nginx.conf                  # Config do servidor web / proxy
├── .env.example                # Variáveis de ambiente (modelo)
│
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js           # Entry point Express
│       ├── db/
│       │   ├── pool.js         # Pool de conexões PostgreSQL
│       │   └── init.sql        # Schema + dados iniciais (auto-executado)
│       ├── middleware/
│       │   └── auth.js         # JWT middleware
│       └── routes/
│           ├── auth.js         # Login, usuários, troca de senha
│           ├── clientes.js     # CRUD clientes
│           ├── produtos.js     # CRUD produtos + séries + estoque
│           ├── vendas.js       # CRUD vendas + dashboard stats
│           └── contratos.js    # Registro de contratos gerados
│
└── frontend/
    └── public/
        └── index.html          # SPA completa (HTML + CSS + JS)
```

---

## 🔧 Comandos úteis

```bash
# Ver logs em tempo real
docker compose logs -f

# Ver logs só do backend
docker compose logs -f backend

# Restart de um serviço específico
docker compose restart backend

# Parar tudo
docker compose down

# Parar e apagar dados do banco (CUIDADO!)
docker compose down -v

# Acessar o banco de dados diretamente
docker compose exec postgres psql -U megabitix -d megabitix

# Rebuild do backend após mudanças no código
docker compose up -d --build backend
```

---

## 🌐 Deploy em VPS (produção)

### Requisitos mínimos
- Ubuntu 20.04+ ou Debian 11+
- 2 vCPU, 2GB RAM
- Docker + Docker Compose instalados

### Instalação do Docker no Ubuntu

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### Configuração de produção

```bash
# No servidor, edite o .env com valores seguros:
POSTGRES_PASSWORD=SenhaForteComMaisde20Chars!
JWT_SECRET=StringAleatoriaMuitoLongaParaJWT123456789

# Suba o sistema
docker compose up -d --build

# Configure para reiniciar automaticamente
# (já configurado: restart: unless-stopped)
```

### Domínio com HTTPS (opcional — com Nginx + Certbot externo)

```bash
# Instale Certbot no host
sudo apt install certbot python3-certbot-nginx

# Configure o domínio no nginx.conf ou use proxy reverso externo
```

---

## 🗄️ Banco de dados

O schema é criado automaticamente na primeira execução (`init.sql`).

### Tabelas principais

| Tabela | Descrição |
|--------|-----------|
| `usuarios` | Contas de acesso ao sistema |
| `clientes` | Cadastro de compradores |
| `produtos` | Catálogo de equipamentos |
| `seriais` | Números de série por produto |
| `vendas` | Negociações realizadas |
| `venda_itens` | Produtos vinculados a cada venda |
| `contratos` | Registro de contratos gerados |

### Backup do banco

```bash
# Exportar
docker compose exec postgres pg_dump -U megabitix megabitix > backup_$(date +%Y%m%d).sql

# Importar
docker compose exec -T postgres psql -U megabitix megabitix < backup_20240101.sql
```

---

## 🔑 Perfis de acesso

| Perfil | Permissões |
|--------|-----------|
| `admin` | Acesso total + gestão de usuários |
| `vendedor` | Clientes, produtos, vendas, contratos (sem gestão de usuários) |

---

## 📋 Funcionalidades

- ✅ Tela de login com JWT (sessão de 8h)
- ✅ Múltiplos usuários com perfis (admin / vendedor)
- ✅ Troca de senha própria
- ✅ Cadastro de clientes (CNPJ/CPF, endereço, representante legal)
- ✅ Cadastro de produtos com múltiplos números de série
- ✅ Controle de estoque automático (baixa ao vender)
- ✅ Registro de vendas (à vista, cartão, parcelado)
- ✅ Cálculo automático de parcelas
- ✅ Campo de implantação com cláusula adicional no contrato
- ✅ Geração automática de contrato no modelo Megabitix
- ✅ Download do contrato em PDF
- ✅ Dashboard com KPIs e últimas vendas
- ✅ Filtros por status, forma de pagamento, cliente
