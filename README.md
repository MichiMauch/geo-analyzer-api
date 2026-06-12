# geo-analytics-api

Ingest + Stats API für die anonymen Nutzungsstatistiken des **Paul AI GEO Analyzers** (Chrome Extension). Liefert die Aggregat-Zahlen für die Live-Statistik auf [geo.mauch.rocks](https://geo.mauch.rocks).

## Privacy-Vertrag

- Die Extension sendet **keine URLs, keine Seiteninhalte, nichts URL-Abgeleitetes** (auch keine Hashes) — nur Scores, gefeuerte Empfehlungs-Keys, Sprache, Version und eine zufällige Install-ID.
- Deduplizierung (1 Report pro Seite/Tag) passiert **clientseitig** in der Extension.
- IPs werden ausschliesslich in-memory fürs Rate-Limiting verwendet und **nie gespeichert**.
- Opt-out-Modell in der Extension: einmaliger Hinweis + Toggle im Footer.

## Endpoints

| Endpoint | Beschreibung |
|---|---|
| `POST /v1/analyses` | Ingest (strikt validiert, 4 KB-Limit, 120 req/h/IP) |
| `GET /v1/stats` | Aggregierte Statistik (10 min gecacht, CORS offen) |
| `GET /health` | Healthcheck für Coolify |

## Deployment auf Coolify (Hetzner)

1. **Repo auf GitHub anlegen und pushen** (z.B. `MichiMauch/geo-analytics-api`).
2. **Postgres-Ressource in Coolify erstellen** (z.B. `geo-analytics-db`), Datenbank `geo_analytics`. Interne Connection-URL notieren.
3. **Neue Coolify-App** aus dem GitHub-Repo, Build Pack: Dockerfile.
   - Env: `DATABASE_URL` = interne Postgres-URL, `PORT=3000`
   - Healthcheck: `GET /health`
   - Domain: `api.geo.mauch.rocks` (DNS A-Record auf den Server, SSL via Coolify/Let's Encrypt)
4. Deploy. Die Tabelle wird beim Start automatisch angelegt (`CREATE TABLE IF NOT EXISTS`).

## Verifizieren

```bash
curl https://api.geo.mauch.rocks/health
curl -X POST https://api.geo.mauch.rocks/v1/analyses \
  -H 'Content-Type: application/json' \
  -d '{"installId":"123e4567-e89b-42d3-a456-426614174000","version":"4.0.0","lang":"de","score":17.2,"maxScore":30,"ratingLevel":"moderate","categories":{"contentClarity":3.1},"recommendations":["no_llms_txt"]}'
curl https://api.geo.mauch.rocks/v1/stats
```

## Website-Einbindung

`website/StatsSection.tsx` ins Repo [website-paul-geo-chrome-ext](https://github.com/MichiMauch/website-paul-geo-chrome-ext) kopieren und einbinden — die Komponente lädt die Stats clientseitig (gleiches Muster wie der Changelog-Fetch) und blendet sich unter 100 Analysen automatisch aus.

## Lokal entwickeln

```bash
npm install
cp .env.example .env   # DATABASE_URL anpassen
npm run dev
```
