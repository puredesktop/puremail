import { ArrowLeft, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'
import { newSweep, sweepProgress, type ArchiveSweep, type SweepDecision, type SweepRow } from '../lib/archiveSweep'
import { readSweepFile, updateSweepFile } from '../lib/archiveSweepPersistence'
import { decideSweepBatch, nextSweepBatch, setSweepStopped, type SweepProvider } from '../lib/archiveSweepRun'
import {
  RunHeaderBack,
  RunHeaderBar,
  RunHeaderButton,
  RunHeaderMeta,
  RunHeaderName,
  RunHeaderSpacer,
  RunPrimaryButton,
  RunsIndexEmpty,
  RunsIndexList,
  RunsIndexMeta,
  RunsIndexName,
  RunsIndexRow,
  RunsIndexScroll,
  RunsIndexSection,
  RunSurface,
} from './runStyles'

const Form = styled.form`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px 12px;
  align-items: end;
  margin-bottom: 18px;

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--platform-colors-text-secondary);
    font-size: 12px;
  }

  input {
    height: 30px;
    box-sizing: border-box;
    padding: 0 8px;
    border: 1px solid var(--platform-colors-border);
    background: var(--puremail-message-bg);
    color: var(--platform-colors-text);
    font: inherit;
    font-size: 13px;
  }
`

const Said = styled.p`
  margin: 0 0 12px;
  max-width: 64ch;
  color: var(--platform-colors-text-secondary);
  font-size: 13px;
  line-height: 1.5;
`

const Item = styled.article`
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--platform-colors-border);

  &:last-child {
    border-bottom: 0;
  }

  h3 {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  small {
    color: var(--platform-colors-text-secondary);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  p {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
`

const ItemActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
`

const Problem = styled.p`
  margin: 0 0 12px;
  color: var(--platform-colors-danger, #a32d2d);
  font-size: 13px;
`

const dayOf = (iso: string): string => {
  const when = new Date(iso)
  return Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const list = (value: string): string[] => value.split(',').map(item => item.trim()).filter(Boolean)

export interface ArchiveSweepsScreenProps {
  provider: SweepProvider | null
  onBack: () => void
  /** Saves a kept message's file, through the same code the assistant's tool uses. */
  save: (decision: SweepDecision) => Promise<{ files: string[]; failed?: string }>
  onReveal: (path: string) => void
}

/**
 * Going through the whole mailbox by hand: the same sweeps the assistant works
 * on, in the same file. Start one, decide what it finds a batch at a time, and
 * see what has been kept. A sweep the assistant started can be finished here.
 */
export function ArchiveSweepsScreen({ provider, onBack, save, onReveal }: ArchiveSweepsScreenProps): React.ReactElement {
  const [sweeps, setSweeps] = useState<ArchiveSweep[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [rows, setRows] = useState<SweepRow[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', words: '', senders: '', since: '', before: '' })

  const reload = useCallback(async () => {
    setSweeps((await readSweepFile()).sweeps)
  }, [])
  useEffect(() => {
    void reload().catch(error => setProblem(error instanceof Error ? error.message : String(error)))
  }, [reload])

  const open = sweeps.find(sweep => sweep.id === openId) ?? null

  const attempt = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setProblem(null)
    try {
      await work()
      await reload()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const readNext = (id: string): Promise<void> =>
    attempt(async () => {
      if (!provider) throw new Error('This account cannot be gone through: it needs a connected mail server.')
      setRows((await nextSweepBatch(provider, id)).rows)
    })

  const decide = (id: string, row: SweepRow, keep: boolean): Promise<void> =>
    attempt(async () => {
      const decision: SweepDecision = { id: row.id, keep, ...(keep ? { save: 'auto' as const } : {}) }
      const applied = await decideSweepBatch(id, [decision], 'person', save)
      if (applied.retry.length) throw new Error(applied.outcomes[0]?.saveFailed ?? 'Its file could not be saved.')
      setRows(current => current.filter(item => item.id !== row.id))
    })

  if (open) {
    const { status, said } = sweepProgress(open)
    return (
      <RunSurface aria-label={open.name}>
        <RunHeaderBar>
          <RunHeaderBack type="button" aria-label="Back to archive sweeps" onClick={() => { setOpenId(null); setRows([]) }}>
            <ArrowLeft aria-hidden="true" />
          </RunHeaderBack>
          <RunHeaderName>{open.name}</RunHeaderName>
          <RunHeaderSpacer />
          <RunHeaderButton type="button" disabled={busy} onClick={() => void attempt(async () => { await setSweepStopped(open.id, !open.stopped) })}>
            {open.stopped ? 'Start again' : 'Stop'}
          </RunHeaderButton>
          {status !== 'done' && !open.stopped && (
            <RunPrimaryButton type="button" disabled={busy} onClick={() => void readNext(open.id)}>
              {busy ? 'Reading…' : 'Read the next ones'}
            </RunPrimaryButton>
          )}
        </RunHeaderBar>
        <RunsIndexScroll>
          <Said>{said}</Said>
          {problem && <Problem role="alert">{problem}</Problem>}
          {rows.length > 0 && (
            <>
              <RunsIndexSection>To decide</RunsIndexSection>
              <RunsIndexList>
                {rows.map(row => (
                  <Item key={row.id}>
                    <h3>{row.subject}</h3>
                    <small>{row.from} · {dayOf(row.at)}{row.files?.length ? ` · ${row.files.join(', ')}` : ''}</small>
                    <p>{row.text}</p>
                    <ItemActions>
                      <RunHeaderButton type="button" disabled={busy} onClick={() => void decide(open.id, row, true)}>Keep and save</RunHeaderButton>
                      <RunHeaderButton type="button" disabled={busy} onClick={() => void decide(open.id, row, false)}>Skip</RunHeaderButton>
                    </ItemActions>
                  </Item>
                ))}
              </RunsIndexList>
            </>
          )}
          <RunsIndexSection>Kept</RunsIndexSection>
          {open.kept.length === 0 ? (
            <RunsIndexEmpty>Nothing kept yet.</RunsIndexEmpty>
          ) : (
            <RunsIndexList>
              {[...open.kept].reverse().slice(0, 200).map(item => (
                <Item key={item.id}>
                  <h3>{item.subject}</h3>
                  <small>{item.from} · {dayOf(item.at)}</small>
                  {item.note && <p>{item.note}</p>}
                  {item.saveFailed && <Problem>Its file could not be saved: {item.saveFailed}</Problem>}
                  {item.files.length > 0 && (
                    <ItemActions>
                      {item.files.map(path => (
                        <RunHeaderButton key={path} type="button" onClick={() => onReveal(path)}>
                          {path.split('/').pop()}
                        </RunHeaderButton>
                      ))}
                    </ItemActions>
                  )}
                </Item>
              ))}
            </RunsIndexList>
          )}
        </RunsIndexScroll>
      </RunSurface>
    )
  }

  return (
    <RunSurface aria-label="Archive sweeps">
      <RunHeaderBar>
        <RunHeaderBack type="button" aria-label="Back to mail" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </RunHeaderBack>
        <Search aria-hidden="true" size={14} />
        <RunHeaderName>Archive sweeps</RunHeaderName>
        <RunHeaderMeta>Every message on the server, once</RunHeaderMeta>
        <RunHeaderSpacer />
      </RunHeaderBar>
      <RunsIndexScroll>
        {problem && <Problem role="alert">{problem}</Problem>}
        <Form
          onSubmit={event => {
            event.preventDefault()
            void attempt(async () => {
              const sweep = newSweep(
                {
                  name: form.name,
                  words: list(form.words),
                  senders: list(form.senders),
                  ...(form.since ? { since: form.since } : {}),
                  ...(form.before ? { before: form.before } : {}),
                },
                'person',
              )
              await updateSweepFile(file => ({ file: { ...file, sweeps: [...file.sweeps, sweep] }, result: null }))
              setForm({ name: '', words: '', senders: '', since: '', before: '' })
              setOpenId(sweep.id)
            })
          }}
        >
          <label>What it is for<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
          <label>Words, with commas<input value={form.words} onChange={event => setForm({ ...form, words: event.target.value })} /></label>
          <label>From, with commas<input value={form.senders} onChange={event => setForm({ ...form, senders: event.target.value })} /></label>
          <label>On or after<input type="date" value={form.since} onChange={event => setForm({ ...form, since: event.target.value })} /></label>
          <label>Before<input type="date" value={form.before} onChange={event => setForm({ ...form, before: event.target.value })} /></label>
          <RunPrimaryButton type="submit" disabled={busy || !provider}>Start a sweep</RunPrimaryButton>
        </Form>
        {sweeps.length === 0 ? (
          <RunsIndexEmpty>
            A sweep goes through all your mail on the server, however old, and sets aside what you ask for. It keeps its place, so it can stop and carry on. Nothing in your mailbox changes.
          </RunsIndexEmpty>
        ) : (
          <RunsIndexList>
            {[...sweeps].reverse().map(sweep => (
              <RunsIndexRow key={sweep.id}>
                <RunsIndexName type="button" title={sweep.name} onClick={() => setOpenId(sweep.id)}>{sweep.name}</RunsIndexName>
                <RunsIndexMeta>{sweepProgress(sweep).said}</RunsIndexMeta>
              </RunsIndexRow>
            ))}
          </RunsIndexList>
        )}
      </RunsIndexScroll>
    </RunSurface>
  )
}
