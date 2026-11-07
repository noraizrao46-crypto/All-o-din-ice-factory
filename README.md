# All-o-din Ice Factory

A small ice-factory reporting app with a public monthly summary and a private admin ledger. The public page shows totals and six-month trends only; individual sales, expense descriptions, notes, and dates are available only after admin sign-in.

## Requirements

- Node.js 22.5 or newer (`node:sqlite` is used by the API)
- npm

## Run locally

1. Install the project packages:

   ```sh
   npm install
   ```

2. Start the website; Vite also starts the API automatically:

   ```sh
   npm run dev
   ```

3. Open the Vite URL shown in the terminal. Use **Admin sign in** to create the first admin account. The first admin must use a username with 3–40 letters, numbers, dots, underscores, or hyphens and a password of at least 10 characters.

Keep the Vite terminal running while you use the website. The API listens on port `3001`; Vite proxies `/api` requests to it. `npm run api` remains available if you want to run the API separately.

The API creates `data/factory.sqlite` automatically. Keep this database file private and back it up regularly. To store it elsewhere, set `ICE_FACTORY_DB_PATH` before starting the API.

## Production

Build the frontend and run the API server in production mode:

```sh
npm run build
npm start
```

Set `NODE_ENV=production` and `PUBLIC_ORIGIN=https://your-domain.example` on the server. In production the Node server serves both the built frontend and API on `PORT` (default `3001`); terminate HTTPS at your hosting provider or reverse proxy. Use persistent storage for the SQLite database and restrict access to server backups. Do not expose the database file or API internals through a static file host.

The app is not deployed by this repository. A hosting account/domain and a persistent server or volume are needed to make it available online. For multi-instance hosting or multiple admins, move the database and authentication to a managed production service before scaling.

## Checks

```sh
npm run lint
npm run build
```
