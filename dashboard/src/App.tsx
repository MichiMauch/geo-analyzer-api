import { useState, useEffect, useCallback } from 'react'

interface Stats {
  overview: {
    total_analyses: number
    avg_score: number | null
    avg_content_clarity: number | null
    avg_answerability: number | null
    avg_trust_sources: number | null
    avg_machine_readability: number | null
    avg_ai_citation: number | null
    min_score: number | null
    max_score: number | null
    unique_urls: number
    unique_versions: number
  }
  scoreDistribution: { range: string; count: number }[]
  perDay: { date: string; count: number; avg_score: number }[]
  topUrls: { url: string; count: number; avg_score: number }[]
  versions: { extension_version: string; count: number }[]
}

function ScoreBar({ label, value, max = 5 }: { label: string; value: number | null; max?: number }) {
  const v = value ?? 0
  const pct = (v / max) * 100
  return (
    <div className="flex items-center gap-3">
      <span className="w-44 text-sm text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
      <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: pct >= 80 ? '#22c55e' : pct >= 60 ? '#eab308' : pct >= 40 ? '#f97316' : '#ef4444',
          }}
        />
      </div>
      <span className="w-12 text-right text-sm font-mono font-medium">{v.toFixed(1)}</span>
    </div>
  )
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 ${className}`}>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">{title}</h2>
      {children}
    </div>
  )
}

function StatNumber({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-bold text-slate-900 dark:text-white">{value}</div>
      <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{label}</div>
    </div>
  )
}

function MiniChart({ data }: { data: { date: string; count: number; avg_score: number }[] }) {
  if (data.length === 0) return <p className="text-slate-400 text-sm">Keine Daten</p>
  const maxCount = Math.max(...data.map((d) => d.count), 1)

  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
          <div
            className="w-full bg-indigo-500 dark:bg-indigo-400 rounded-t opacity-80 hover:opacity-100 transition-opacity min-h-[2px]"
            style={{ height: `${(d.count / maxCount) * 100}%` }}
          />
          <div className="absolute bottom-full mb-2 hidden group-hover:block bg-slate-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
            {d.date}: {d.count} Analysen, Avg {d.avg_score.toFixed(1)}
          </div>
        </div>
      ))}
    </div>
  )
}

function truncateUrl(url: string, max = 60) {
  try {
    const u = new URL(url)
    const display = u.hostname + u.pathname
    return display.length > max ? display.slice(0, max) + '...' : display
  } catch {
    return url.length > max ? url.slice(0, max) + '...' : url
  }
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('geo-api-key') || '')
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchStats = useCallback(async (key: string) => {
    if (!key) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/stats?key=${encodeURIComponent(key)}`)
      if (!res.ok) {
        setError(res.status === 401 ? 'Ungültiger API-Key' : `Fehler: ${res.status}`)
        setStats(null)
        return
      }
      setStats(await res.json())
    } catch (e) {
      setError(`Verbindung fehlgeschlagen: ${e instanceof Error ? e.message : 'Unknown error'}`)
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (apiKey) fetchStats(apiKey)
  }, [apiKey, fetchStats])

  const handleKeySubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const key = (form.get('key') as string).trim()
    if (key) {
      localStorage.setItem('geo-api-key', key)
      setApiKey(key)
    }
  }

  if (!apiKey || error === 'Ungültiger API-Key') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <form onSubmit={handleKeySubmit} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 w-full max-w-md">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">GEO Analyzer</h1>
          <p className="text-slate-500 dark:text-slate-400 mb-6">API-Key eingeben um das Dashboard zu öffnen.</p>
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
          <input
            name="key"
            type="password"
            placeholder="API-Key"
            defaultValue=""
            className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button type="submit" className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors">
            Verbinden
          </button>
        </form>
      </div>
    )
  }

  if (loading && !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500">Laden...</p>
      </div>
    )
  }

  if (!stats) return null

  const o = stats.overview

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">GEO Analyzer Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Extension-Statistiken</p>
        </div>
        <button
          onClick={() => { localStorage.removeItem('geo-api-key'); setApiKey(''); setStats(null) }}
          className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          Logout
        </button>
      </header>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card title="Analysen total" className="flex flex-col items-center justify-center">
          <StatNumber value={o.total_analyses} label="Einträge" />
        </Card>
        <Card title="Unique URLs" className="flex flex-col items-center justify-center">
          <StatNumber value={o.unique_urls} label="URLs" />
        </Card>
        <Card title="Avg Score" className="flex flex-col items-center justify-center">
          <StatNumber value={o.avg_score?.toFixed(1) ?? '–'} label={`von 25 (${o.min_score ?? 0}–${o.max_score ?? 0})`} />
        </Card>
        <Card title="Versionen" className="flex flex-col items-center justify-center">
          <StatNumber value={o.unique_versions} label="Extensions" />
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        {/* Category Averages */}
        <Card title="Durchschnitt pro Kategorie">
          <div className="space-y-3">
            <ScoreBar label="Content Clarity" value={o.avg_content_clarity} />
            <ScoreBar label="Answerability" value={o.avg_answerability} />
            <ScoreBar label="Trust & Sources" value={o.avg_trust_sources} />
            <ScoreBar label="Machine Readability" value={o.avg_machine_readability} />
            <ScoreBar label="AI Citation" value={o.avg_ai_citation} />
          </div>
        </Card>

        {/* Score Distribution */}
        <Card title="Score-Verteilung">
          <div className="space-y-2">
            {stats.scoreDistribution.map((d) => {
              const total = stats.scoreDistribution.reduce((s, x) => s + x.count, 0)
              const pct = total > 0 ? (d.count / total) * 100 : 0
              return (
                <div key={d.range} className="flex items-center gap-3">
                  <span className="w-16 text-sm font-mono text-slate-500 dark:text-slate-400">{d.range}</span>
                  <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-500 dark:bg-indigo-400 flex items-center justify-end pr-2 text-xs text-white font-medium transition-all duration-500"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    >
                      {d.count > 0 ? d.count : ''}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        {/* Analyses per Day Chart */}
        <Card title="Analysen pro Tag (letzte 30 Tage)">
          <MiniChart data={stats.perDay} />
          {stats.perDay.length > 0 && (
            <div className="flex justify-between text-xs text-slate-400 mt-2">
              <span>{stats.perDay[0]?.date}</span>
              <span>{stats.perDay[stats.perDay.length - 1]?.date}</span>
            </div>
          )}
        </Card>

        {/* Version Stats */}
        <Card title="Extension-Versionen">
          {stats.versions.length === 0 ? (
            <p className="text-slate-400 text-sm">Keine Daten</p>
          ) : (
            <div className="space-y-2">
              {stats.versions.map((v) => (
                <div key={v.extension_version} className="flex items-center justify-between py-1">
                  <span className="font-mono text-sm">{v.extension_version}</span>
                  <span className="text-sm bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">{v.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Top URLs */}
      <Card title="Top URLs" className="mb-6">
        {stats.topUrls.length === 0 ? (
          <p className="text-slate-400 text-sm">Keine Daten</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <th className="pb-2 font-medium">URL</th>
                  <th className="pb-2 font-medium text-right">Analysen</th>
                  <th className="pb-2 font-medium text-right">Avg Score</th>
                </tr>
              </thead>
              <tbody>
                {stats.topUrls.map((u) => (
                  <tr key={u.url} className="border-b border-slate-100 dark:border-slate-700/50">
                    <td className="py-2 font-mono text-xs text-slate-600 dark:text-slate-300" title={u.url}>
                      {truncateUrl(u.url)}
                    </td>
                    <td className="py-2 text-right">{u.count}</td>
                    <td className="py-2 text-right font-mono">{u.avg_score.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
