FROM node:20-alpine

WORKDIR /app

# Instala dependências primeiro (cache de layer)
COPY package*.json ./
RUN npm install --omit=dev

# Copia o código
COPY . .

EXPOSE 3001

CMD ["node", "src/server.js"]
