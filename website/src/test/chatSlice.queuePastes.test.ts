/**
 * A queued send's row carries the paste blocks behind its wire text, so the
 * queue card shows the `[ Paste #N ]` token and not the expanded paste.
 *
 * The gateway queues a send with its WIRE text, in which the composer expanded
 * every paste token in place, and carries no blocks on the entry. The sending
 * browser recorded the send in the paste side table under that wire text
 * (`saveStoredPaste`), which is where the sent bubble is re-collapsed from on a
 * reload; the queue reducers read the same record (`queueEntryPastes`) when a
 * `queue_push` frame or a slot-detail hydration builds the row, keep the blocks
 * an edit's text still holds, and hand them to the user row the entry drains into.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import reducer, { appendQueuedMessage, editQueuedMessage, removeQueuedMessage } from '../store/chatSlice'
import { hydrateQueuedBubbles } from '../store/chat/queue'
import { queueEntryPastes } from '../store/chat/wire'
import { buildOutgoingTurn } from '../chat-core/composer/outgoingTurn'
import { formatToken, saveStoredPaste, type PasteBlock } from '../utils/pasteTokens'
import type { ChatMessage } from '../types'

const initial = reducer(undefined, { type: '@@INIT' })
const P1: PasteBlock = { id: 'p1', seq: 1, lines: 3, content: 'alpha\nbeta\ngamma' }
const T1 = formatToken(P1)

/** A real send: the wire the gateway queues, recorded in the side table the
 *  way the composer records it (`storeSentPastes`). */
function sent(text: string) {
  const turn = buildOutgoingTurn({ text, pastes: [P1] }, 'send')
  const entry = turn.storedPaste!
  saveStoredPaste(entry.expanded, entry.display, entry.pastes, entry.files)
  return turn.wire
}

beforeEach(() => { localStorage.clear() })

describe('queueEntryPastes', () => {
  it('finds the blocks this browser recorded under the wire text', () => {
    const wire = sent(`look at ${T1}`)
    expect(wire).toContain('alpha\nbeta\ngamma')
    expect(queueEntryPastes(wire)).toEqual({ pastes: [P1] })
    // The gateway strips trailing whitespace from stored text; the key does too.
    expect(queueEntryPastes(wire + '\n')).toEqual({ pastes: [P1] })
  })

  it('finds nothing for a send another browser made, or one the table evicted', () => {
    const wire = buildOutgoingTurn({ text: `look at ${T1}`, pastes: [P1] }, 'send').wire
    expect(queueEntryPastes(wire)).toEqual({})
  })

  it('finds a paste collapsed at the threshold whose trailing whitespace the wire lost', () => {
    // 199 characters plus one trailing space: collapsed by the composer, but
    // trimmed below the threshold in the text the entry holds.
    const block: PasteBlock = { id: 'p2', seq: 2, lines: 1, content: 'x'.repeat(199) + ' ' }
    saveStoredPaste(block.content, formatToken(block), [block])
    expect(queueEntryPastes(block.content.trimEnd())).toEqual({ pastes: [block] })
  })

  it('finds nothing for empty text', () => {
    expect(queueEntryPastes('')).toEqual({})
  })
})

describe('queue rows carry the blocks', () => {
  it('a queue_push frame builds the row with meta.pastes', () => {
    const wire = sent(`look at ${T1}`)
    const state = reducer({ ...initial, activeSlot: 'chat-1' }, appendQueuedMessage({ slot: 'chat-1', content: wire, ts: 't1', queue_id: 'q-1', meta: { sendId: 's-1' } }))
    const row = state.messages.find(m => m.role === 'queued')
    expect(row?.meta).toEqual({ queueId: 'q-1', sendId: 's-1', pastes: [P1] })
  })

  it('a slot-detail hydration builds the row with meta.pastes', () => {
    const wire = sent(`look at ${T1}`)
    const rows = hydrateQueuedBubbles([], [{ content: wire, queueId: 'q-1', ts: 't1' }])
    expect(rows).toHaveLength(1)
    expect(rows[0].meta).toEqual({ queueId: 'q-1', pastes: [P1] })
  })

  it('a row whose send is not on record carries no pastes key', () => {
    const wire = buildOutgoingTurn({ text: `look at ${T1}`, pastes: [P1] }, 'send').wire
    const rows = hydrateQueuedBubbles([], [{ content: wire, queueId: 'q-1', ts: 't1' }])
    expect(rows[0].meta).toEqual({ queueId: 'q-1' })
  })
})

describe('editQueuedMessage keeps the blocks whose text the edited wire still holds', () => {
  function withQueued(content: string, meta: Record<string, unknown>) {
    return { ...initial, activeSlot: 'chat-1', messages: [{ role: 'queued', content, cls: 'msg msg-queued', ts: 't1', meta: { queueId: 'q-1', ...meta } } as ChatMessage] }
  }

  it('keeps the blocks when the edited wire still holds the paste, with no side-table record for it', () => {
    const before = sent(`look at ${T1}`)
    // The echoed content differs from what the card recorded: the gateway
    // renumbered an attachment marker. The paste text is unchanged.
    const after = buildOutgoingTurn({ text: `look at ${T1} now`, pastes: [P1] }, 'send').wire + '\n[attached_file 1] /tmp/b.txt'
    const state = reducer(withQueued(before, { pastes: [P1] }), editQueuedMessage({ slot: 'chat-1', queue_id: 'q-1', content: after }))
    expect(state.messages[0].content).toBe(after)
    expect(state.messages[0].meta).toEqual({ queueId: 'q-1', pastes: [P1] })
  })

  it('keeps a block whose trailing whitespace the edit action trimmed away', () => {
    const block: PasteBlock = { id: 'p2', seq: 2, lines: 1, content: 'x'.repeat(199) + ' ' }
    const before = `see ${formatToken(block)}`.replace(formatToken(block), block.content)
    const state = reducer(withQueued(before, { pastes: [block] }), editQueuedMessage({ slot: 'chat-1', queue_id: 'q-1', content: block.content.trim() }))
    expect(state.messages[0].meta).toEqual({ queueId: 'q-1', pastes: [block] })
  })

  it('drops the blocks when the edit took the token out', () => {
    const before = sent(`look at ${T1}`)
    const state = reducer(withQueued(before, { pastes: [P1] }), editQueuedMessage({ slot: 'chat-1', queue_id: 'q-1', content: 'never mind' }))
    expect(state.messages[0].meta).toEqual({ queueId: 'q-1' })
  })
})

describe('removeQueuedMessage hands the blocks to the drained user row', () => {
  it('the rebuilt user row carries the queued row\'s pastes', () => {
    const wire = buildOutgoingTurn({ text: `look at ${T1}`, pastes: [P1] }, 'send').wire
    const st = { ...initial, activeSlot: 'chat-1', messages: [{ role: 'queued', content: wire, cls: 'msg msg-queued', ts: 't1', meta: { queueId: 'q-1', pastes: [P1] } } as ChatMessage] }
    const state = reducer(st, removeQueuedMessage({ slot: 'chat-1', content: wire, queue_id: 'q-1', meta: { sendId: 's-1' } }))
    const row = state.messages.find(m => m.role === 'user')
    expect(row?.content).toBe(wire)
    expect(row?.meta).toEqual({ pastes: [P1], sendId: 's-1', queueId: 'q-1' })
  })

  it('a queued row without blocks rebuilds as before', () => {
    const wire = 'summarize this'
    const st = { ...initial, activeSlot: 'chat-1', messages: [{ role: 'queued', content: wire, cls: 'msg msg-queued', ts: 't1', meta: { queueId: 'q-1' } } as ChatMessage] }
    const state = reducer(st, removeQueuedMessage({ slot: 'chat-1', content: wire, queue_id: 'q-1' }))
    expect('meta' in (state.messages.find(m => m.role === 'user') as object)).toBe(false)
  })
})
