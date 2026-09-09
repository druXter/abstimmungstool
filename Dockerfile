# Wir nutzen eine schlanke Node.js-Version als Basis
FROM node:20-alpine

# Arbeitsverzeichnis im Container festlegen
WORKDIR /app

# Abhängigkeiten kopieren und installieren
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install
RUN npx prisma generate

# Restlichen Code kopieren und die App für den Produktivbetrieb bauen
COPY . .
RUN npm run build

# next start lauscht standardmäßig auf Port 3000 im Container
EXPOSE 3000

# Beim Starten des Containers: Datenbank-Struktur sicherstellen und App starten
CMD ["sh", "-c", "npx prisma db push && npm start"]
