FROM node:20-alpine

WORKDIR /app

# Créer le dossier logs avec les bonnes permissions
RUN mkdir -p /app/logs && chmod 777 /app/logs

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances avec legacy-peer-deps
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# Copier le reste du code
COPY . .

# Exposer le port
EXPOSE 5000

# Démarrer l'application
CMD ["node", "server.js"]