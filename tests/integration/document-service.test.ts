import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScratchDB } from '@/storage/db'
import { ConflictError, ScratchRepository } from '@/storage/repository'
import { DocumentService } from '@/storage/document-service'
import type { TipTapNode } from '@/core/models/types'
import { nodeToPlainText } from '@/core/content'

function paragraph(text: string, blockId: string): TipTapNode {
  return {
    type: 'paragraph',
    attrs: { blockId },
    content: [{ type: 'text', text }],
  }
}

function doc(...nodes: TipTapNode[]): TipTapNode {
  return { type: 'doc', content: nodes }
}

let db: ScratchDB
let repo: ScratchRepository
let service: DocumentService

beforeEach(async () => {
  db = new ScratchDB(`scratch-test-${crypto.randomUUID()}`)
  await db.open()
  repo = new ScratchRepository(db)
  service = new DocumentService(repo)
  await service.init()
})

afterEach(async () => {
  service.dispose()
  await db.delete()
})

function currentId(): string {
  const id = service.getState().session.scratch?.id
  if (!id) throw new Error('no scratch open')
  return id
}

async function reloadService(): Promise<void> {
  service.dispose()
  service = new DocumentService(new ScratchRepository(db))
  await service.init()
}

describe('DocumentService', () => {
  it('creates a first scratch and syncs paper blocks with stable ids', async () => {
    const id = currentId()
    await service.syncPaperDocument(
      doc(paragraph('第一段', 'b1'), paragraph('第二段', 'b2')),
      id,
    )
    await service.flush()
    const state = service.getState()
    expect(state.session.order).toEqual(['b1', 'b2'])
    expect(state.session.scratch?.title).toBe('第一段')
    expect(state.session.blocks.map((block) => nodeToPlainText(block.content.node))).toEqual([
      '第一段',
      '第二段',
    ])

    const rows = await db.blocks.where('scratchId').equals(id).toArray()
    expect(rows.map((row) => row.id).sort()).toEqual(['b1', 'b2'])
  })

  it('restores blocks, order, title and mode after reload', async () => {
    const id = currentId()
    await service.syncPaperDocument(doc(paragraph('甲', 'a'), paragraph('乙', 'b')), id)
    await service.setMode('canvas')
    await service.flush()
    await reloadService()
    const state = service.getState()
    expect(state.session.scratch?.id).toBe(id)
    expect(state.session.scratch?.activeMode).toBe('canvas')
    expect(state.session.order).toEqual(['a', 'b'])
    expect(state.session.blocks.map((block) => nodeToPlainText(block.content.node))).toEqual([
      '甲',
      '乙',
    ])
  })

  it('does not override a manual title, and resumes auto titles when cleared', async () => {
    const id = currentId()
    await service.syncPaperDocument(doc(paragraph('自动标题', 'b1')), id)
    await service.flush()
    expect(service.getState().session.scratch?.title).toBe('自动标题')

    await service.renameScratch(id, '手写标题')
    await service.syncPaperDocument(doc(paragraph('改了内容', 'b1')), id)
    await service.flush()
    expect(service.getState().session.scratch?.title).toBe('手写标题')

    await service.renameScratch(id, '')
    await service.flush()
    expect(service.getState().session.scratch?.title).toBe('改了内容')
  })

  it('deletes blocks removed from the paper and prunes canvas hidden entries', async () => {
    const id = currentId()
    await service.syncPaperDocument(
      doc(paragraph('一', 'b1'), paragraph('二', 'b2'), paragraph('三', 'b3')),
      id,
    )
    await service.hideBlock('b2')
    await service.flush()
    expect(service.getState().session.canvas?.hiddenBlockIds).toEqual(['b2'])

    await service.syncPaperDocument(doc(paragraph('一', 'b1'), paragraph('三', 'b3')), id)
    await service.flush()
    const state = service.getState()
    expect(state.session.order).toEqual(['b1', 'b3'])
    expect(state.session.canvas?.hiddenBlockIds).toEqual([])
    expect(await db.blocks.get('b2')).toBeUndefined()
  })

  it('supports hide / show-all and explicit content deletion', async () => {
    const id = currentId()
    await service.syncPaperDocument(doc(paragraph('一', 'b1'), paragraph('二', 'b2')), id)
    await service.hideBlock('b1')
    await service.flush()
    expect(service.getState().session.canvas?.hiddenBlockIds).toContain('b1')

    await service.showAllHiddenBlocks()
    await service.flush()
    expect(service.getState().session.canvas?.hiddenBlockIds).toEqual([])

    await service.deleteBlock('b2')
    await service.flush()
    expect(service.getState().session.order).toEqual(['b1'])
    expect(await db.blocks.get('b2')).toBeUndefined()
  })

  it('trashes, restores and permanently deletes scratches', async () => {
    const first = currentId()
    const second = await service.createScratch()
    expect(currentId()).toBe(second.id)

    await service.trashScratch(second.id)
    let state = service.getState()
    expect(state.trashed.map((item) => item.id)).toContain(second.id)
    expect(currentId()).toBe(first)

    await service.restoreScratch(second.id)
    state = service.getState()
    expect(state.trashed).toHaveLength(0)
    expect(state.scratches.map((item) => item.id)).toContain(second.id)

    await service.deleteScratchPermanently(second.id)
    expect(await db.scratches.get(second.id)).toBeUndefined()
    expect(service.getState().scratches.map((item) => item.id)).not.toContain(second.id)
  })

  it('exports and replaces the whole dataset', async () => {
    const id = currentId()
    await service.syncPaperDocument(doc(paragraph('原始内容', 'b1')), id)
    await service.flush()
    const exported = await service.exportDataset()
    expect(exported.scratches.length).toBeGreaterThan(0)

    await service.syncPaperDocument(doc(paragraph('修改后的内容', 'b1')), id)
    await service.flush()

    await service.replaceDataset(exported)
    const state = service.getState()
    expect(nodeToPlainText(state.session.blocks[0].content.node)).toBe('原始内容')
    const row = await db.blocks.get('b1')
    expect(row).toBeTruthy()
    expect(nodeToPlainText(row!.content.node)).toBe('原始内容')
  })

  it('rejects stale revisions instead of silently overwriting', async () => {
    const id = currentId()
    await service.syncPaperDocument(doc(paragraph('本地内容', 'b1')), id)
    await service.flush()
    const scratch = (await db.scratches.get(id))!
    await expect(
      repo.saveSession({
        scratch: { ...scratch, title: '来自另一个标签页' },
        blocks: [],
        order: [],
        canvas: {
          scratchId: id,
          snapshot: null,
          hiddenBlockIds: [],
          updatedAt: Date.now(),
        },
        blocksDirty: false,
        canvasDirty: false,
        baseRevision: scratch.revision - 1,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect((await db.scratches.get(id))?.title).toBe(scratch.title)
  })



  it('surfaces save failures and retries successfully while keeping edits dirty', async () => {
    const id = currentId()
    const saveSpy = vi.spyOn(repo, 'saveSession').mockRejectedValueOnce(new Error('disk full'))
    await service.syncPaperDocument(doc(paragraph('需要重试的内容', 'b1')), id)
    await service.flush()
    let state = service.getState()
    expect(state.status.phase).toBe('error')
    expect(state.status.message).toContain('disk full')
    expect(nodeToPlainText(state.session.blocks[0].content.node)).toBe('需要重试的内容')

    saveSpy.mockRestore()
    await service.flush()
    state = service.getState()
    expect(state.status.phase).toBe('saved')
    const row = await db.blocks.get('b1')
    expect(row).toBeTruthy()
    expect(nodeToPlainText(row!.content.node)).toBe('需要重试的内容')
  })

  it('notifies other tabs and surfaces a conflict instead of silent overwrite', async () => {
    if (typeof BroadcastChannel === 'undefined') return
    const id = currentId()
    const other = new DocumentService(new ScratchRepository(db))
    await other.init()
    try {
      expect(other.getState().session.scratch?.id).toBe(id)

      await service.syncPaperDocument(doc(paragraph('来自标签页 A', 'b1')), id)
      await service.flush()
      await new Promise((resolve) => setTimeout(resolve, 250))
      expect(nodeToPlainText(other.getState().session.blocks[0].content.node)).toBe(
        '来自标签页 A',
      )

      // The second tab now has unsaved local edits; a remote save must not silently win.
      await other.syncPaperDocument(doc(paragraph('标签页 B 未保存的修改', 'b1')), id)
      await service.syncPaperDocument(doc(paragraph('标签页 A 再次修改', 'b1')), id)
      await service.flush()
      await new Promise((resolve) => setTimeout(resolve, 250))
      expect(other.getState().conflict).not.toBeNull()
      expect(nodeToPlainText(other.getState().session.blocks[0].content.node)).toBe(
        '标签页 B 未保存的修改',
      )

      // While unresolved, navigating away would discard local edits silently.
      await expect(other.createScratch()).rejects.toThrow('冲突')
      await expect(other.openScratch('some-other-id')).rejects.toThrow('冲突')
      await expect(other.trashScratch(id)).rejects.toThrow('冲突')

      await other.resolveConflict('overwrite')
      expect(other.getState().conflict).toBeNull()
      await other.flush()
      expect(other.getState().status.phase).toBe('saved')
    } finally {
      other.dispose()
    }
  })

  it('stores assets once by content hash and resolves them', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const blob = new Blob([png as BlobPart], { type: 'image/png' })
    const first = await service.addAssetFromBlob(blob)
    const second = await service.addAssetFromBlob(blob)
    expect(second).toBe(first)
    expect(await service.getAssetBlob(first)).toBeTruthy()
    const url = await service.getAssetUrl(first)
    expect(url?.startsWith('blob:')).toBe(true)
  })
})
