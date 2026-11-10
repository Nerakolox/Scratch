import { z } from 'zod'
import type { TipTapNode } from './models/types'

export const tiptapMarkSchema = z.object({
  type: z.string().min(1).max(64),
  attrs: z.record(z.string(), z.unknown()).optional(),
})

export const tiptapNodeSchema: z.ZodType<TipTapNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(64),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(tiptapNodeSchema).optional(),
    marks: z.array(tiptapMarkSchema).optional(),
    text: z.string().optional(),
  }),
)

export const blockContentSchema = z.object({
  node: tiptapNodeSchema,
})

export const blockKindSchema = z.enum(['richtext', 'code', 'image'])

export const scratchSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().max(10_000),
  titleIsAuto: z.boolean(),
  activeMode: z.enum(['paper', 'canvas']),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().optional(),
})

export const contentBlockSchema = z.object({
  id: z.string().min(1).max(128),
  scratchId: z.string().min(1).max(128),
  kind: blockKindSchema,
  content: blockContentSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
})

export const paperLayoutSchema = z.object({
  scratchId: z.string().min(1).max(128),
  blockOrder: z.array(z.string().min(1).max(128)).max(100_000),
})

export const canvasLayoutSchema = z.object({
  scratchId: z.string().min(1).max(128),
  snapshot: z.unknown().nullable(),
  sessionState: z.unknown().optional(),
  hiddenBlockIds: z.array(z.string().min(1).max(128)).max(100_000),
  updatedAt: z.number().int().nonnegative(),
})

export const datasetSchema = z.object({
  scratches: z.array(scratchSchema),
  blocks: z.array(contentBlockSchema),
  paperLayouts: z.array(paperLayoutSchema),
  canvasLayouts: z.array(canvasLayoutSchema),
})

export const manifestSchema = z.object({
  format: z.literal('duskbit.scratch.backup'),
  formatVersion: z.literal(1),
  createdAt: z.string().min(1),
  appVersion: z.string().min(1),
  datasetId: z.string().min(1),
  scratchCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  encryption: z
    .object({
      cipher: z.literal('AES-256-GCM'),
      kdf: z.literal('PBKDF2-SHA-256'),
      iterations: z.number().int().min(100_000),
      salt: z.string().min(1),
      iv: z.string().min(1),
    })
    .optional(),
})

export const encryptedHeaderSchema = z.object({
  format: z.literal('duskbit.scratch.encrypted'),
  formatVersion: z.literal(1),
  cipher: z.literal('AES-256-GCM'),
  kdf: z.literal('PBKDF2-SHA-256'),
  iterations: z.number().int().min(100_000),
  salt: z.string().min(1),
  iv: z.string().min(1),
})
