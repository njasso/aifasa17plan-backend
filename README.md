 AIFASA 17 - Application de Gestion Associative

Application mobile et API pour la gestion de l'association AIFASA 17.

## Architecture

- **Backend**: Node.js + Express + MongoDB
- **Frontend**: React + Capacitor (Android)
- **API**: RESTful avec Socket.io pour temps réel

## Déploiement

### Backend
Déployé sur Render : https://aifasa17plan-backend.onrender.com

### API Endpoints
- Health: `/health`
- Auth: `/api/auth`
- Members: `/api/members`
- Activities: `/api/activities`
- Finances: `/api/finances`

## Installation locale

### Backend
```bash
cd backend
npm install
cp .env.example .env
# Configurer .env
npm run dev