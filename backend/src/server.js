const express = require('express');
const cors = require('cors');

const authRoutes      = require('./routes/auth');
const clientesRoutes  = require('./routes/clientes');
const produtosRoutes  = require('./routes/produtos');
const vendasRoutes    = require('./routes/vendas');
const contratosRoutes = require('./routes/contratos');
const { router: parcelasRouter } = require('./routes/parcelas');

const app = express();
app.set('trust proxy', 1);

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '20mb' }));  // 20mb para suportar PDF base64
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/auth',      authRoutes);
app.use('/api/clientes',  clientesRoutes);
app.use('/api/produtos',  produtosRoutes);
app.use('/api/vendas',    vendasRoutes);
app.use('/api/contratos', contratosRoutes);
app.use('/api/parcelas',  parcelasRouter);

app.use((req, res) => res.status(404).json({ error: `Rota ${req.method} ${req.path} não encontrada` }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Erro interno' }); });

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Megabitix API rodando na porta ${PORT}`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
