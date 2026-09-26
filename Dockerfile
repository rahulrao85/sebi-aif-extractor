FROM mcr.microsoft.com/playwright:v1.59.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=8080
ENV SEBI_HEADLESS=1
ENV NODE_ENV=production
ENV ENABLE_AUTH=1

EXPOSE 8080

CMD ["node", "server.js"]