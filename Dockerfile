# Wir nutzen eine schlanke Node.js-Version als Basis (aktuelle LTS, wie alle Tools der Suite)
FROM node:22-alpine

# git wird von npm gebraucht, um das gemeinsame Paket suite-kit direkt von GitHub zu holen
# (siehe package.json) - node:22-alpine bringt es nicht mit.
RUN apk add --no-cache git

# Arbeitsverzeichnis anlegen und dem unprivilegierten Nutzer "node" (UID 1000) übergeben.
# Installation, Build und Betrieb laufen bewusst NICHT als root: Eine Lücke in der App oder
# einer Abhängigkeit hätte sonst Root-Rechte im Container. Wie in den anderen Tools der Suite.
WORKDIR /app
RUN chown node:node /app
USER node

# Abhängigkeiten exakt nach package-lock.json installieren (npm ci statt npm install:
# reproduzierbar, bricht ab statt still andere Versionen zu ziehen)
COPY --chown=node:node package*.json ./
COPY --chown=node:node prisma ./prisma/
RUN npm ci
RUN npx prisma generate

# Restlichen Code kopieren und die App für den Produktivbetrieb bauen
COPY --chown=node:node . .
RUN npm run build

# next start lauscht standardmäßig auf Port 3000 im Container (außen 3006, siehe docker-compose.yml)
EXPOSE 3000

# Beim Starten des Containers: ggf. Bestandsdaten umziehen (scripts/migrate-db.js, legt
# vorher eine Sicherung in ./data an), Datenbank-Struktur sicherstellen und App starten.
# Schlägt der Umzug fehl, startet der Container bewusst nicht - `db push` würde sonst an
# den alten Spalten scheitern oder (mit --accept-data-loss) Daten verwerfen.
# --skip-generate: Der Client ist schon beim Build erzeugt, zur Laufzeit wird nichts neu geschrieben.
CMD ["sh", "-c", "node scripts/migrate-db.js && npx prisma db push --skip-generate && npm start"]
