import { useEffect } from 'react'
import { useStore } from '../store'
import { api } from '../ws'
import { EXAMPLES } from '../words'

/** "?" guide: what each part of the screen is, and what you can say. */
export function Help() {
  const open = useStore((s) => s.helpOpen)
  const setOpen = useStore((s) => s.setHelpOpen)
  const name = useStore((s) => s.settings?.assistant_name || 'Friday')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null
  const run = (t: string) => {
    setOpen(false)
    api.chat(t)
  }
  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal help" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {name.toUpperCase()} KAISE USE KAREIN
          <button className="x" onClick={() => setOpen(false)} aria-label="Band karein">
            ✕
          </button>
        </div>

        <section>
          <h3>BOL KAR</h3>
          <ol className="steps">
            <li>
              Boliye <b>“{name}”</b> ya <b>“Wake up”</b>. Ek “ting” aayegi.
            </li>
            <li>Phir apni command boliye. Ek saath bhi chalega: “Hey {name}, chrome kholo”.</li>
            <li>
              Wo bol rahi ho aur rokna ho, toh boliye <b>“{name} stop”</b>.
            </li>
            <li>Upar “🎙 Sunna band” dikhe, toh us par click karke sunna chalu karein.</li>
          </ol>
        </section>

        <section>
          <h3>SCREEN PAR KYA HAI</h3>
          <dl className="parts">
            <dt>Beech ka gola</dt>
            <dd>{name} ki halat. Aap bolte ho toh lines aapki awaaz par hilti hain. Neeche likha hota hai abhi kya ho raha hai.</dd>
            <dt>PC ki halat</dt>
            <dd>Processor kitna busy hai, RAM kitni bhari hai, storage kitna bhara hai, aur internet kitna chal raha hai.</dd>
            <dt>Mere kaam</dt>
            <dd>Aapke pending kaam. ◇ par click karo toh kaam poora. Neeche likh kar naya kaam jodo.</dd>
            <dt>Shortcuts</dt>
            <dd>Ek click wale kaam: PC ki halat, latest Excel, YouTube, settings.</dd>
            <dt>Baatcheet</dt>
            <dd>Aapke sawaal aur jawab. “⚡ Turant” wale jawab AI ke bina, PC par hi bane hain.</dd>
            <dt>Neeche ki patti</dt>
            <dd>Connection, kaunsa AI chal raha hai, pichhla jawab kitni der me aaya, mic aur awaaz ki halat.</dd>
          </dl>
        </section>

        <section>
          <h3>YE BOL KAR DEKHIYE</h3>
          <div className="examples">
            {[...EXAMPLES, 'ek python script likho jo 1 se 10 tak table print kare', 'GST wali excel file dhundo'].map((e) => (
              <button key={e} className="example" onClick={() => run(e)}>
                “{e}”
              </button>
            ))}
          </div>
        </section>

        <div className="modal-actions">
          <button className="btn btn-send" onClick={() => setOpen(false)}>
            Samajh gaya
          </button>
        </div>
      </div>
    </div>
  )
}
