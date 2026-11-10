import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('paper writing syncs to canvas, edits there, and survives reload', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.tiptap')
  await expect(editor).toBeVisible()

  await editor.click()
  await page.keyboard.type('第一段：打开就写')
  await page.keyboard.press('Enter')
  await page.keyboard.type('第二段：想整理就拖')

  await expect(page.getByLabel('草稿标题')).toHaveValue('第一段：打开就写')
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.getByRole('tab', { name: '画布' }).click()
  const cards = page.locator('.scratch-block-card')
  await expect(cards).toHaveCount(2, { timeout: 20_000 })
  await expect(cards.filter({ hasText: '第一段' })).toHaveCount(1)
  await expect(cards.filter({ hasText: '第二段' })).toHaveCount(1)
  const firstCard = cards.filter({ hasText: '第一段' })

  const firstCardBox = await firstCard.boundingBox()
  expect(firstCardBox).toBeTruthy()
  await page.mouse.dblclick(
    firstCardBox!.x + firstCardBox!.width / 2,
    firstCardBox!.y + firstCardBox!.height / 2,
  )
  const overlay = page.locator('.scratch-card-editor')
  await expect(overlay).toBeVisible()
  await expect(page.locator('.tl-text-shape')).toHaveCount(0)
  await overlay.locator('.tiptap').click()
  await page.keyboard.press('End')
  await page.keyboard.type('（画布补充）')
  await overlay.getByRole('button', { name: '完成' }).click()
  await expect(overlay).toBeHidden()
  await expect(page.locator('.tl-text-shape')).toHaveCount(0)
  await expect(cards.filter({ hasText: '（画布补充）' })).toHaveCount(1)

  await page.getByRole('tab', { name: '纸张' }).click()
  await expect(page.locator('.tiptap')).toContainText('（画布补充）')
  await expect(page.locator('.tiptap > p')).toHaveCount(2)
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.reload()
  await expect(page.locator('.tiptap')).toContainText('第一段：打开就写')
  await expect(page.locator('.tiptap')).toContainText('（画布补充）')
  await expect(page.getByRole('tab', { name: '纸张' })).toHaveAttribute('aria-selected', 'true')

  await page.getByRole('tab', { name: '画布' }).click()
  await expect(page.locator('.scratch-block-card')).toHaveCount(2, { timeout: 20_000 })
  await expect(
    page.locator('.scratch-block-card').filter({ hasText: '（画布补充）' }),
  ).toHaveCount(1)
})

test('exports a .scratchbackup and restores it over modified data', async ({ page }, testInfo) => {
  await page.goto('/')
  const editor = page.locator('.tiptap')
  await editor.click()
  await page.keyboard.type('备份中的原始内容')
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.locator('button[aria-label="设置与备份"]').click()
  await page.getByRole('button', { name: '导出完整备份' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '生成并下载' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.scratchbackup$/)
  const backupPath = testInfo.outputPath('roundtrip.scratchbackup')
  await download.saveAs(backupPath)

  await page.getByRole('button', { name: '返回草稿' }).click()
  await page.locator('.tiptap').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('已经被改掉的内容')
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.locator('button[aria-label="设置与备份"]').click()
  await expect(page.getByRole('heading', { name: '数据与恢复' })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(backupPath)
  const dialog = page.getByRole('dialog', { name: '恢复备份到本机' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('草稿 / 内容块 / 图片')
  await dialog.getByRole('button', { name: '恢复并替换全部数据' }).click()
  await expect(page.getByText('恢复完成，本地数据已替换')).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: '返回草稿' }).click()
  await expect(page.locator('.tiptap')).toContainText('备份中的原始内容')
  await expect(page.locator('.tiptap')).not.toContainText('已经被改掉的内容')
})

test('searches, trashes and restores a scratch', async ({ page }) => {
  await page.goto('/')
  await page.locator('.tiptap').click()
  await page.keyboard.type('第一个草稿')
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: '新草稿' }).click()
  await expect(page.getByLabel('草稿标题')).toHaveValue('')
  await page.locator('.tiptap').click()
  await page.keyboard.type('第二个草稿')
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.keyboard.press('ControlOrMeta+K')
  const palette = page.getByRole('dialog', { name: '搜索草稿' })
  await expect(palette).toBeVisible()
  await palette.getByLabel('搜索草稿').fill('第一个')
  await expect(palette.getByRole('option').first()).toContainText('第一个草稿')
  await palette.getByRole('option').first().click()
  await expect(page.locator('.tiptap')).toContainText('第一个草稿')

  const item = page.locator('li').filter({ hasText: '第一个草稿' }).first()
  await item.hover()
  await item.getByRole('button', { name: '草稿操作' }).click()
  await page.getByRole('menuitem', { name: '移到回收站' }).click()
  await expect(page.getByText('已移到回收站')).toBeVisible()

  await page.getByRole('button', { name: /回收站/ }).click()
  const trashed = page.getByRole('button', { name: '恢复草稿' }).first()
  await trashed.click()
  await expect(page.getByText('已恢复草稿')).toBeVisible()
  await expect(page.locator('li').filter({ hasText: '第一个草稿' }).first()).toBeVisible()
})

test('slash menu, markdown shortcuts, and block drag handles work', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.tiptap')
  await editor.click()

  await page.keyboard.type('/')
  const menu = page.getByRole('listbox', { name: '插入内容' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type('斜杠标题')
  await expect(page.locator('.tiptap h1')).toContainText('斜杠标题')

  await page.keyboard.press('Enter')
  await page.keyboard.type('- 列表项')
  await expect(page.locator('.tiptap li')).toContainText('列表项')

  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await expect(menu).toBeVisible()
  await menu.getByRole('option', { name: /代码块/ }).click()
  await page.keyboard.type('const answer = 42')
  await expect(page.locator('.tiptap pre code')).toContainText('const answer = 42')
  const language = page.getByLabel('代码语言')
  await expect(language).toBeVisible()
  await language.selectOption('typescript')
  await expect(language).toHaveValue('typescript')
  await expect(page.getByRole('button', { name: '复制代码' })).toBeVisible()

  await page.locator('.tiptap h1').hover()
  await expect(page.locator('[title="拖动以移动此块"]')).toBeVisible()
})

test('repeated Paper/Canvas switches keep blocks and layout stable', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.tiptap')
  await editor.click()
  await page.keyboard.type('第一块')
  await page.keyboard.press('Enter')
  await page.keyboard.type('第二块')
  await page.keyboard.press('Enter')
  await page.keyboard.type('## 第三块')
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10_000 })

  for (let round = 0; round < 6; round += 1) {
    await page.getByRole('tab', { name: '画布' }).click()
    await expect(page.locator('.scratch-block-card')).toHaveCount(3, { timeout: 20_000 })
    await page.getByRole('tab', { name: '纸张' }).click()
    await expect(page.locator('.tiptap > p')).toHaveCount(2)
    await expect(page.locator('.tiptap > h2')).toHaveCount(1)
    await expect(page.locator('.tiptap')).toContainText('第一块')
    await expect(page.locator('.tiptap')).toContainText('第二块')
    await expect(page.locator('.tiptap')).toContainText('第三块')
  }

  const rows = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('scratch-db')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction('blocks', 'readonly')
          const count = transaction.objectStore('blocks').count()
          count.onsuccess = () => resolve(count.result)
          count.onerror = () => reject(count.error)
        }
      }),
  )
  expect(rows).toBe(3)
})

test('inserting an image stores it locally and creates a canvas card', async ({ page }, testInfo) => {
  await page.goto('/')
  const editor = page.locator('.tiptap')
  await editor.click()
  await page.keyboard.type('图片草稿')

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4S8AAAAASUVORK5CYII=',
    'base64',
  )
  const imagePath = testInfo.outputPath('pixel.png')
  await writeFile(imagePath, png)
  await page.locator('input[accept="image/*"]').setInputFiles(imagePath)

  await expect(page.locator('.tiptap img')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.getByRole('tab', { name: '画布' }).click()
  await expect(page.locator('.scratch-block-card')).toHaveCount(2, { timeout: 20_000 })
  await expect(page.locator('.scratch-block-card img')).toBeVisible({ timeout: 10_000 })

  await page.reload()
  await expect(page.locator('.scratch-block-card img')).toBeVisible({ timeout: 20_000 })
})

test('pastes Markdown source as rich text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  const editor = page.locator('.tiptap')
  await editor.click()

  const markdown = '# 粘贴标题\n\n- 第一项\n- 第二项\n\n**加粗内容**'
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text)
  }, markdown)
  await page.keyboard.press('ControlOrMeta+V')

  await expect(page.locator('.tiptap h1')).toContainText('粘贴标题')
  await expect(page.locator('.tiptap li')).toHaveCount(2)
  await expect(page.locator('.tiptap strong').first()).toContainText('加粗内容')
})

test('canvas settings control minimap, snap, grid, style panel and tldraw menu', async ({ page }) => {
  await page.goto('/')
  await page.locator('.tiptap').click()
  await page.keyboard.type('画布设置测试')
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('tab', { name: '画布' }).click()

  const card = page.locator('.scratch-block-card').first()
  await expect(card).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '画布设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '画布设置' })
  await expect(dialog).toBeVisible()

  const snap = dialog.getByRole('checkbox', { name: /吸附与对齐线/ })
  await expect(snap).toBeChecked()

  await dialog.getByRole('checkbox', { name: /小地图/ }).check()
  await expect(page.locator('.tlui-minimap')).toBeVisible({ timeout: 10_000 })

  await dialog.getByRole('checkbox', { name: /tldraw 菜单/ }).check()
  await expect(page.locator('.tlui-menu-zone')).toBeVisible({ timeout: 10_000 })

  await dialog.getByRole('checkbox', { name: /网格背景/ }).check()
  await dialog.getByRole('checkbox', { name: /样式面板/ }).check()
  await dialog.getByRole('button', { name: '关闭画布设置' }).click()

  const box = await card.boundingBox()
  expect(box).toBeTruthy()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await expect(page.locator('.tlui-style-panel')).toBeVisible({ timeout: 10_000 })

  await page.reload()
  await expect(page.locator('.tlui-minimap')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.tlui-menu-zone')).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: '画布设置', exact: true }).click()
  const restored = page.getByRole('dialog', { name: '画布设置' })
  await expect(restored.getByRole('checkbox', { name: /吸附与对齐线/ })).toBeChecked()
  await expect(restored.getByRole('checkbox', { name: /网格背景/ })).toBeChecked()
  await expect(restored.getByRole('checkbox', { name: /小地图/ })).toBeChecked()
  await expect(restored.getByRole('checkbox', { name: /样式面板/ })).toBeChecked()
  await expect(restored.getByRole('checkbox', { name: /tldraw 菜单/ })).toBeChecked()
})

test('pastes Markdown when the clipboard also includes a pre-wrapped HTML copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  const editor = page.locator('.tiptap')
  await editor.click()

  const pixel =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4S8AAAAASUVORK5CYII='
  const markdown = `# 解析标题

| 名称 | 数量 |
| --- | --- |
| 苹果 | 2 |

- [x] 已完成
- [ ] 待办

![像素](${pixel})`
  const escaped = markdown.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  await page.evaluate(
    async ({ markdown, html }) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([markdown], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
    },
    { markdown, html: `<pre>${escaped}</pre>` },
  )
  await page.keyboard.press('ControlOrMeta+V')

  await expect(page.locator('.tiptap h1')).toContainText('解析标题')
  await expect(page.locator('.tiptap table th').first()).toContainText('名称')
  await expect(page.locator('.tiptap table td').first()).toContainText('苹果')
  await expect(page.locator('.tiptap input[type="checkbox"]')).toHaveCount(2)
  await expect(page.locator('.tiptap input[type="checkbox"]').first()).toBeChecked()
  await expect(page.locator('.tiptap img')).toBeVisible()
})
