import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.SCRATCH_URL ?? 'http://localhost:5173'
const OUT = 'docs/screenshots'

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
})
const page = await context.newPage()

async function setTheme(theme) {
  await page.evaluate((value) => localStorage.setItem('scratch:theme', value), theme)
  await page.reload()
  await page.locator('#root').waitFor()
}

async function seedContent() {
  const editor = page.locator('.tiptap')
  await editor.waitFor()
  await page.getByLabel('草稿标题').fill('周末整理')
  await editor.click()
  await page.keyboard.type('打开就写，想整理就拖，关掉内容仍在。')
  await page.keyboard.press('Enter')
  await page.keyboard.type(
    '一个本地的个人草稿空间：纸张负责顺序，画布负责空间，内容只有一份。',
  )
  await page.keyboard.press('Enter')
  await page.keyboard.type('## 这周')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- 打磨 Paper 与 Canvas 的内容映射')
  await page.keyboard.press('Enter')
  await page.keyboard.type('给 OneDrive 备份接上真实账号')
  await page.keyboard.press('Enter')
  await page.keyboard.type('做一次完整的恢复演练')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('> 纸张负责线性记录，画布负责空间整理，内容只有一份。')
  await page.getByText('已保存', { exact: true }).waitFor({ timeout: 15_000 })
}

try {
  await page.goto(BASE)
  await page.locator('#root').waitFor()
  await setTheme('light')
  await seedContent()

  await page.screenshot({ path: `${OUT}/paper-light.png` })

  await page.getByRole('tab', { name: '画布' }).click()
  const cards = page.locator('.scratch-block-card')
  await cards.first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: '适应视图' }).click()
  await page.waitForTimeout(500)

  // Give the grid a slightly more spatial, less machine-like arrangement.
  const layout = [
    ['打开就写', 180, -40],
    ['一个本地的个人草稿空间', 260, 80],
    ['这周', 40, 120],
  ]
  for (const [text, dx, dy] of layout) {
    const card = cards.filter({ hasText: text }).first()
    if ((await card.count()) === 0) continue
    const box = await card.boundingBox()
    if (!box) continue
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, {
      steps: 12,
    })
    await page.mouse.up()
    await page.waitForTimeout(120)
  }
  await page.getByRole('button', { name: '适应视图' }).click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/canvas-light.png` })

  await page.getByRole('button', { name: '画布设置', exact: true }).click()
  await page.getByRole('dialog', { name: '画布设置' }).waitFor()
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT}/canvas-settings.png` })
  await page.getByRole('button', { name: '关闭画布设置' }).click()

  await setTheme('dark')
  await page.getByRole('button', { name: '适应视图' }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/canvas-dark.png` })

  await page.getByRole('tab', { name: '纸张' }).click()
  await page.locator('.tiptap').waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/paper-dark.png` })

  await setTheme('light')
  await page.goto(`${BASE}/#/settings`)
  await page.getByRole('heading', { name: '数据与恢复' }).waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/settings-light.png` })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${BASE}/#/`)
  await page.getByRole('tab', { name: '纸张' }).click()
  await page.locator('.tiptap').waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/paper-mobile.png` })

  console.log('Screenshots written to', OUT)
} finally {
  await browser.close()
}
