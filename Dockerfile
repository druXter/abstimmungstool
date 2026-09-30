# Wir nutzen eine schlanke Node.js-Version als Basis
FROM node:20-alpine

# Arbeitsverzeichnis im Container festlegen
WORKDIR /app

# git wird von npm gebraucht, um das gemeinsame Paket suite-kit direkt von GitHub zu holen
# (siehe package.json) - node:20-alpine bringt es nicht mit.
RUN apk add --no-cache git

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

# Beim Starten des Containers: ggf. Bestandsdaten umziehen (scripts/migrate-db.js, legt
# vorher eine Sicherung in ./data an), Datenbank-Struktur sicherstellen und App starten.
# Schlägt der Umzug fehl, startet der Container bewusst nicht - `db push` würde sonst an
# den alten Spalten scheitern oder (mit --accept-data-loss) Daten verwerfen.
CMD ["sh", "-c", "node scripts/migrate-db.js && npx prisma db push && npm start"]
