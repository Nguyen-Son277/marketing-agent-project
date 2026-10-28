import { existsSync } from 'node:fs'
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from 'vitest'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { BrowserWorkerController } from '../src/controller.ts'
const executable =
  process.env.BROWSER_TEST_EXECUTABLE ?? '/usr/bin/google-chrome'
describe.skipIf(!existsSync(executable))(
  'WordPress fixed browser adapters',
  () => {
    let browser: Browser,
      context: BrowserContext,
      controller: BrowserWorkerController
    beforeAll(async () => {
      browser = await chromium.launch({
        executablePath: executable,
        headless: true,
        args: ['--no-sandbox'],
      })
    })
    afterAll(async () => {
      await browser.close()
    })
    beforeEach(async () => {
      context = await browser.newContext()
      controller = new BrowserWorkerController(context, {
        screen: async () => Buffer.from(''),
        input: async () => {},
      })
      await controller.init()
      await controller.setMode('agent')
    })
    afterEach(async () => {
      await context.close()
    })
    it('starts backup using database/files checkboxes and captures before/after, without claiming completion', async () => {
      await context.route('https://wp.example/**', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<h1>UpdraftPlus</h1><button id="updraft-backupnow-button">Backup Now</button><input type="checkbox" id="backupnow_database"><input type="checkbox" id="backupnow_files"><button id="backupnow_go" onclick="document.body.dataset.started=1">Backup now</button>',
        }),
      )
      const result = await controller.wordpress({
        jobId: 'wp-backup',
        siteUrl: 'https://wp.example',
        operation: 'backup',
      })
      expect(result.status).toBe('started')
      expect(result.before).toBeTruthy()
      expect(result.after).toBeTruthy()
      expect(
        await context.pages()[0]!.locator('body').getAttribute('data-started'),
      ).toBe('1')
    })
    it('hands login and unsupported Elementor layouts back to human and rejects arbitrary operations', async () => {
      await context.route('https://wp.example/**', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<label>Password<input type="password"></label>',
        }),
      )
      expect(
        (
          await controller.wordpress({
            jobId: 'wp-login',
            siteUrl: 'https://wp.example',
            operation: 'elementor',
            postId: 7,
            widgetId: 'abc',
            text: 'Title',
          })
        ).status,
      ).toBe('waiting_human')
      await expect(
        controller.wordpress({
          jobId: 'wp-arbitrary',
          siteUrl: 'https://wp.example',
          operation: 'shell',
        }),
      ).rejects.toThrow()
      await controller.setMode('human')
      await expect(
        controller.wordpress({
          jobId: 'wp-human',
          siteUrl: 'https://wp.example',
          operation: 'backup',
        }),
      ).rejects.toThrow()
    })
    it('updates only the exact Elementor heading widget and verifies it in preview', async () => {
      let heading = 'Old heading'
      await context.route('https://wp.example/**', (route) => {
        if (route.request().url().includes('admin-ajax.php')) {
          heading = 'New heading'
          return route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ success: true }),
          })
        }
        if (route.request().url().includes('preview'))
          return route.fulfill({
            contentType: 'text/html',
            body: `<div class="elementor-element" data-id="abc123" data-widget_type="heading.default"><h2>${heading}</h2></div>`,
          })
        return route.fulfill({
          contentType: 'text/html',
          body: `<h1>Elementor editor</h1><textarea data-setting="title">Old heading</textarea><button id="elementor-panel-saver-button-publish" onclick="fetch('/wp-admin/admin-ajax.php',{method:'POST',body:'action=elementor_ajax&save_builder=1'})">Update</button><iframe id="elementor-preview-iframe" src="https://wp.example/preview"></iframe>`,
        })
      })
      const result = await controller.wordpress({
        jobId: 'wp-elementor',
        siteUrl: 'https://wp.example',
        operation: 'elementor',
        postId: 7,
        widgetId: 'abc123',
        text: 'New heading',
      })
      expect(result.status).toBe('verified')
    })
  },
)
