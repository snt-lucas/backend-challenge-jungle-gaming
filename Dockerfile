FROM oven/bun:1-alpine AS base
WORKDIR /app

# Instala dependências
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copia código-fonte
COPY . .

# Expõe porta HTTP
EXPOSE 3000

# Executa aplicação
CMD ["bun", "run", "start"]
