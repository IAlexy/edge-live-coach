# Guide de Contribution (Contributing)

Merci de votre intérêt pour **Edge Live-Coach** ! Ce projet open-source vise à proposer un coaching biomécanique en temps réel respectueux de la vie privée (**Zéro Média**) et universellement accessible.

## Prérequis

- **Node.js** `>= 22.5.0` (utilise le module natif `node:sqlite`)
- **npm** `>= 10.0.0`

## Installation et Développement

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer le serveur Backend (Agent 2 Cloud - Port 8000)
npm run dev:backend

# 3. Lancer le serveur Frontend (Agent 1 Edge - Port 5173)
npm run dev
```

## Qualité du Code et Tests

Avant d'ouvrir une Pull Request, assurez-vous que l'ensemble des vérifications et des suites de tests passent avec succès :

```bash
# Vérification du typage TypeScript
npm run typecheck

# Exécution de toute la suite de tests (Unitaires, API/WebSocket, Interface UI)
npm test

# Build de production
npm run build
```

## Principes Architecturaux à Respecter

1. **Confidentialité Zéro-Média (Privacy by Design)** : Aucune image, frame vidéo ou flux audio brut ne doit quitter le navigateur client ni être stocké sur disque. Seuls des invariants cinématiques anonymisés (angles articulaires, ratios, durées) peuvent transiter vers l'Agent 2.
2. **Double Accessibilité** : Toute nouvelle fonctionnalité de retour utilisateur doit proposer un retour visuel (HUD haute visibilité pour personnes sourdes ou malentendantes) et un retour sonore/vocal (Earcons + Web Speech TTS pour personnes aveugles ou malvoyantes).
