import { describe, expect, it } from 'vitest'
import {
  backupFilename,
  buildBackupArchive,
  parseBackupArchive,
} from '@/features/backup/archive/format'
import { buildZip, readZipEntries } from '@/features/backup/archive/zip'
import { utf8 } from '@/features/backup/archive/hash'
import type { Dataset, Scratch } from '@/core/models/types'

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
  0x52, 0x00, 0x00, 0x00, 0x01,
])

function scratch(overrides: Partial<Scratch> = {}): Scratch {
  return {
    id: 'scratch-1',
    title: '测试草稿',
    titleIsAuto: false,
    activeMode: 'paper',
    createdAt: 1000,
    updatedAt: 2000,
    revision: 3,
    ...overrides,
  }
}

function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  const base: Dataset = {
    scratches: [scratch(), scratch({ id: 'scratch-trash', deletedAt: 5000, title: '' })],
    blocks: [
      {
        id: 'block-1',
        scratchId: 'scratch-1',
        kind: 'richtext',
        content: {
          node: {
            type: 'paragraph',
            attrs: { blockId: 'block-1' },
            content: [{ type: 'text', text: '你好，Scratch。' }],
          },
        },
        createdAt: 1000,
        updatedAt: 2000,
        revision: 3,
      },
      {
        id: 'block-image',
        scratchId: 'scratch-1',
        kind: 'image',
        content: {
          node: {
            type: 'image',
            attrs: { blockId: 'block-image', assetId: 'asset-1', alt: '示意图' },
          },
        },
        createdAt: 1100,
        updatedAt: 2000,
        revision: 3,
      },
    ],
    paperLayouts: [
      { scratchId: 'scratch-1', blockOrder: ['block-1', 'block-image'] },
      { scratchId: 'scratch-trash', blockOrder: [] },
    ],
    canvasLayouts: [
      {
        scratchId: 'scratch-1',
        snapshot: { store: {}, schema: {} },
        hiddenBlockIds: [],
        updatedAt: 2000,
      },
      {
        scratchId: 'scratch-trash',
        snapshot: null,
        sessionState: { camera: { x: 0, y: 0, z: 1 } },
        hiddenBlockIds: [],
        updatedAt: 2000,
      },
    ],
    assets: [
      {
        id: 'asset-1',
        mimeType: 'image/png',
        size: PNG_BYTES.byteLength,
        createdAt: 1200,
        blob: new Blob([PNG_BYTES as BlobPart], { type: 'image/png' }),
        bytes: PNG_BYTES,
      },
    ],
  }
  return { ...base, ...overrides }
}

const OPTIONS = { datasetId: 'dataset-uuid', appVersion: '0.1.0' }

describe('backup archive protocol', () => {
  it('round-trips a dataset with an image asset', async () => {
    const dataset = makeDataset()
    const archive = await buildBackupArchive(dataset, OPTIONS)
    expect(archive.encrypted).toBe(false)
    expect(archive.filename).toMatch(/^scratchbackup-\d{8}T\d{6}Z-[a-f0-9]{8}\.scratchbackup$/)
    expect(archive.manifest.scratchCount).toBe(2)
    expect(archive.manifest.assetCount).toBe(1)
    expect(archive.manifest.payloadSha256).toMatch(/^[a-f0-9]{64}$/)

    const parsed = await parseBackupArchive(archive.blob)
    expect(parsed.manifest.payloadSha256).toBe(archive.manifest.payloadSha256)
    expect(parsed.dataset.scratches.map((item) => item.id).sort()).toEqual([
      'scratch-1',
      'scratch-trash',
    ])
    expect(parsed.dataset.blocks).toHaveLength(2)
    expect(parsed.dataset.paperLayouts[0].blockOrder).toEqual(['block-1', 'block-image'])
    expect(parsed.dataset.assets).toHaveLength(1)
    expect(parsed.dataset.assets[0].bytes).toEqual(PNG_BYTES)
    expect(parsed.dataset.assets[0].mimeType).toBe('image/png')
    expect(parsed.warnings).toHaveLength(0)
    expect(parsed.dataset.canvasLayouts).toHaveLength(2)
  })

  it('refuses encrypted archives without the password and on wrong password', async () => {
    const archive = await buildBackupArchive(makeDataset(), {
      ...OPTIONS,
      password: 'correct horse battery',
    })
    expect(archive.encrypted).toBe(true)

    await expect(parseBackupArchive(archive.blob)).rejects.toMatchObject({
      code: 'password-required',
    })
    await expect(
      parseBackupArchive(archive.blob, { password: 'definitely wrong' }),
    ).rejects.toMatchObject({ code: 'wrong-password' })

    const parsed = await parseBackupArchive(archive.blob, {
      password: 'correct horse battery',
    })
    expect(parsed.encrypted).toBe(true)
    expect(parsed.dataset.blocks).toHaveLength(2)
    expect(parsed.dataset.assets[0].bytes).toEqual(PNG_BYTES)
  })

  it('rejects tampered payloads via the manifest hash', async () => {
    const archive = await buildBackupArchive(makeDataset(), OPTIONS)
    const bytes = new Uint8Array(await archive.blob.arrayBuffer())
    const files = readZipEntries(bytes)
    files['blocks.json'] = utf8(JSON.stringify([]))
    const tampered = buildZip(files)
    await expect(parseBackupArchive(tampered)).rejects.toMatchObject({ code: 'invalid-data' })
  })

  it('rejects arbitrary bytes, oversized archives and unknown versions', async () => {
    await expect(parseBackupArchive(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({
      code: 'invalid-format',
    })

    const archive = await buildBackupArchive(makeDataset(), OPTIONS)
    await expect(
      parseBackupArchive(archive.blob, { limits: { maxArchiveBytes: 10 } }),
    ).rejects.toMatchObject({ code: 'too-large' })

    const bytes = new Uint8Array(await archive.blob.arrayBuffer())
    const files = readZipEntries(bytes)
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as Record<
      string,
      unknown
    >
    manifest.formatVersion = 99
    files['manifest.json'] = utf8(JSON.stringify(manifest))
    await expect(parseBackupArchive(buildZip(files))).rejects.toMatchObject({
      code: 'unsupported-version',
    })
  })

  it('warns about missing image assets instead of silently dropping blocks', async () => {
    const dataset = makeDataset({
      assets: [],
      blocks: [
        {
          id: 'block-image',
          scratchId: 'scratch-1',
          kind: 'image',
          content: {
            node: {
              type: 'image',
              attrs: { blockId: 'block-image', assetId: 'missing-asset' },
            },
          },
          createdAt: 1000,
          updatedAt: 1000,
          revision: 1,
        },
      ],
      paperLayouts: [{ scratchId: 'scratch-1', blockOrder: ['block-image'] }],
    })
    const archive = await buildBackupArchive(dataset, OPTIONS)
    const parsed = await parseBackupArchive(archive.blob)
    expect(parsed.dataset.blocks).toHaveLength(1)
    expect(parsed.warnings.join('\n')).toContain('图片资源缺失')
  })

  it('repairs layouts that reference unknown blocks', async () => {
    const dataset = makeDataset({
      paperLayouts: [{ scratchId: 'scratch-1', blockOrder: ['ghost', 'block-1'] }],
    })
    const archive = await buildBackupArchive(dataset, OPTIONS)
    const parsed = await parseBackupArchive(archive.blob)
    expect(parsed.dataset.paperLayouts[0].blockOrder).toEqual(['block-1', 'block-image'])
    expect(parsed.warnings.length).toBeGreaterThan(0)
  })

  it('generates namespaced filenames', () => {
    expect(backupFilename(new Date('2026-11-10T12:34:56Z'))).toMatch(
      /^scratchbackup-20261110T123456Z-[a-f0-9]{8}\.scratchbackup$/,
    )
  })
})
