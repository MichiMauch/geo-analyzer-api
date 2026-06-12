import { useEffect, useState } from 'react';

// Live-Statistik-Sektion für geo.mauch.rocks (Vite + React, statisch).
// Holt die aggregierten Zahlen clientseitig von der Analytics-API —
// gleiches Muster wie der Tech-Changelog-Fetch. Bei Fehlern rendert die
// Sektion einfach nichts (kein Layout-Bruch auf der statischen Seite).
//
// Einbau: Datei ins Website-Repo kopieren und <StatsSection /> einbinden.

const STATS_URL = 'https://api.geo.mauch.rocks/v1/stats';

// Empfehlungs-Keys → menschenlesbare Aussage für die Statistik
const REC_LABELS: Record<string, string> = {
  no_llms_txt: 'haben keine llms.txt',
  no_schema: 'haben keine strukturierten Daten (Schema.org)',
  schema_incomplete: 'haben unvollständige Schema-Auszeichnungen',
  canonical_missing: 'haben kein Canonical-Tag',
  no_h1: 'haben keine saubere H1-Überschrift',
  bad_hierarchy: 'überspringen Überschriften-Ebenen',
  images_missing_alts: 'haben Bilder ohne Alt-Texte',
  no_sourced_claims: 'machen Faktenaussagen ohne Quellen',
  no_author: 'nennen keine Autorin / keinen Autor',
  no_faq: 'haben keine FAQ-Sektion',
  description_missing: 'haben keine Meta-Description',
  low_readability: 'sind schwer lesbar',
};

interface Stats {
  totalAnalyses: number;
  avgScore: number;
  maxScore: number;
  topRecommendations: { key: string; count: number; pct: number }[];
  updatedAt: string;
}

export default function StatsSection() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch(STATS_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  // Erst ab etwas Volumen anzeigen — "basierend auf 7 Analysen" wirkt dünn.
  if (!stats || stats.totalAnalyses < 100) return null;

  const findings = stats.topRecommendations
    .filter((rec) => REC_LABELS[rec.key])
    .slice(0, 4);

  return (
    <section>
      <h2>GEO in Zahlen</h2>
      <p>
        Basierend auf {stats.totalAnalyses.toLocaleString('de-CH')} anonymen
        Analysen mit dem Paul AI GEO Analyzer (Ø-Score{' '}
        {stats.avgScore.toFixed(1)}/{stats.maxScore}):
      </p>
      <ul>
        {findings.map((rec) => (
          <li key={rec.key}>
            <strong>{rec.pct}%</strong> der analysierten Seiten{' '}
            {REC_LABELS[rec.key]}
          </li>
        ))}
      </ul>
      <p>
        <small>
          Anonyme Opt-out-Statistik, keine URLs oder Seiteninhalte. Stand:{' '}
          {new Date(stats.updatedAt).toLocaleDateString('de-CH')}
        </small>
      </p>
    </section>
  );
}
