import { useEffect, useRef, useState, type FormEvent } from 'react'
import { es } from '../app/i18n/es'
import type { WorkMeta } from '../db/repo'

interface Props {
  heading: string
  initial: WorkMeta
  onSave: (meta: WorkMeta) => void
  onCancel: () => void
}

export function MetadataDialog({ heading, initial, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initial.title)
  const [composer, setComposer] = useState(initial.composer)
  const [tags, setTags] = useState(initial.tags.join(', '))
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({ title, composer, tags: tags.split(',') })
  }

  return (
    <div className="backdrop" onClick={onCancel}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meta-heading"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="meta-heading">{heading}</h2>
        <label className="field">
          <span>
            {es.meta.title} <small>({es.meta.optional})</small>
          </span>
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} name="title" autoComplete="off" />
        </label>
        <label className="field">
          <span>
            {es.meta.composer} <small>({es.meta.optional})</small>
          </span>
          <input value={composer} onChange={(e) => setComposer(e.target.value)} name="composer" autoComplete="off" />
        </label>
        <label className="field">
          <span>
            {es.meta.tags} <small>({es.meta.tagsHint})</small>
          </span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} name="tags" autoComplete="off" />
        </label>
        <div className="dialog-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>
            {es.meta.cancel}
          </button>
          <button type="submit" className="primary-btn">
            {es.meta.save}
          </button>
        </div>
      </form>
    </div>
  )
}
