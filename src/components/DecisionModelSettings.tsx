import { useEffect, useState } from 'react'
import { SelectField } from '@purescience/platform-ui/components/common/inputs/SelectField'
import { getDecisionModelSettings, setDecisionModelOverride, type DecisionSettings } from '../lib/decisionModels'
export function DecisionModelSettings({onSettingsChange}: {onSettingsChange?: (settings: DecisionSettings) => void}) {
  const [settings, setSettings] = useState<DecisionSettings | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { let live = true; const reload = () => { void getDecisionModelSettings().then(next => { if (live) { setSettings(next); setError('') } }).catch(() => { if (live) setError('Decision models/system one models need a desktop version with the shared service.') }) }; reload(); window.addEventListener('focus', reload); return () => { live = false; window.removeEventListener('focus', reload) } }, [])
  const save = async (id: string) => {
    setSaving(true); setError('')
    try { const next = await setDecisionModelOverride(id || null); setSettings(next); onSettingsChange?.(next) }
    catch { setError('Could not save decision models/system one models settings.') }
    finally { setSaving(false) }
  }
  return <section aria-label="Decision models/system one models">
    <p>Use the global decision models/system one models choice, or override it for this app. Provider keys stay in the desktop vault.</p>
    {settings && <>
      <SelectField aria-label="Decision models/system one models" value={settings.overrideModelId ?? ''} disabled={saving} options={[{value:'',label:'Use global setting'}, ...settings.models.map(m => ({value:m.id,label:m.label}))]} onValueChange={id => { void save(id) }} />
      <p>Effective model: {settings.models.find(m => m.id === settings.effectiveModelId)?.label}. {settings.configured ? 'Provider configured.' : 'Add the provider key in the vault, or start the local runtime.'}</p>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>
}
