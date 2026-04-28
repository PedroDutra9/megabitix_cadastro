const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes     = require('./routes/auth');
const clientesRoutes = require('./routes/clientes');
const produtosRoutes = require('./routes/produtos');
const vendasRoutes   = require('./routes/vendas');
const contratosRoutes = require('./routes/contratos');

const app = express();

// Necessário para funcionar atrás do Nginx (proxy reverso)
app.set('trust proxy', 1);

// ─── Middlewares globais ─────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limit global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições, tente novamente em alguns minutos' }
}));

// Rate limit mais apertado no login
app.use('/api/auth/login', rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 10,
  message: { error: 'Muitas tentativas de login, aguarde 10 minutos' }
}));

// ─── Health check ────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ─── Rotas ──────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/clientes',  clientesRoutes);
app.use('/api/produtos',  produtosRoutes);
app.use('/api/vendas',    vendasRoutes);
app.use('/api/contratos', contratosRoutes);

// ─── 404 e Errors ────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Rota ${req.method} ${req.path} não encontrada` });
});

app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// ─── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Megabitix API rodando na porta ${PORT}`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
