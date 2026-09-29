import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { TopBar } from '@/components/ui'
import { DOCS, type DocId } from '@/config'
import { useT } from '@/i18n'
import { openExternal } from '@/lib/telegram'

/**
 * Документы (соглашение, политика) открываются прямо внутри Mini App:
 * так они работают во всех клиентах Telegram, без перехода в браузер.
 */
export default function DocPage() {
  const t = useT()
  const { doc } = useParams<{ doc: string }>()
  const [loaded, setLoaded] = useState(false)
  if (!doc || !(doc in DOCS)) return <Navigate to="/account" replace />
  const url = DOCS[doc as DocId]

  return (
    <>
      <TopBar />
      <div className="glass relative -mx-1 overflow-hidden !rounded-[22px]" style={{ height: 'calc(100dvh - var(--safe-top) - 120px)' }}>
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white" />
          </div>
        )}
        <iframe
          src={url}
          title={doc}
          onLoad={() => setLoaded(true)}
          className={`h-full w-full border-0 transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
      <button onClick={() => openExternal(url)} className="mt-3 w-full text-center text-[13px] text-faint underline-offset-4 active:underline">
        {t('docs.openBrowser')}
      </button>
    </>
  )
}
