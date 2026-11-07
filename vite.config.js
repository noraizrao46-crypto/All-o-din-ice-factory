import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

function apiServerPlugin() {
  let apiProcess
  let restartRequested = false
  let isShuttingDown = false
  const apiPath = fileURLToPath(new URL('./server/index.js', import.meta.url))

  return {
    name: 'ice-factory-api',
    async configureServer(server) {
      async function waitForApiReady(child) {
        let lastError = 'The API did not respond.'
        const deadline = Date.now() + 10000
        while (Date.now() < deadline && !isShuttingDown) {
          if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(`The API process exited before becoming ready (code ${child.exitCode ?? 'unknown'}).`)
          }
          try {
            const response = await fetch('http://127.0.0.1:3001/api/status')
            if (response.ok) return
            lastError = `The API returned HTTP ${response.status}.`
          } catch (error) {
            lastError = error.message
          }
          await new Promise((resolveWait) => setTimeout(resolveWait, 200))
        }
        if (isShuttingDown) throw new Error('The dev server shut down before the API became ready.')
        throw new Error(`The API did not become ready within 10 seconds: ${lastError}`)
      }

      async function reloadPageWhenApiIsReady(child) {
        try {
          await waitForApiReady(child)
          if (!isShuttingDown) server.ws.send({ type: 'full-reload' })
        } catch (error) {
          if (!isShuttingDown) console.error(`The API restarted, but the page could not be refreshed: ${error.message}`)
        }
      }

      function startApiServer(reloadClient = false) {
        if (isShuttingDown) return
        const child = spawn(process.execPath, [apiPath], { stdio: 'inherit', env: process.env })
        apiProcess = child
        if (reloadClient) child.once('spawn', () => { reloadPageWhenApiIsReady(child) })
        child.on('error', (error) => {
          console.error('Could not start the ice factory API:', error.message)
        })
        child.on('exit', () => {
          if (apiProcess === child) apiProcess = undefined
          if (restartRequested && !isShuttingDown) {
            restartRequested = false
            startApiServer(true)
          }
        })
      }

      startApiServer()
      server.watcher.add(apiPath)
      server.watcher.on('change', (changedPath) => {
        if (resolve(changedPath) !== apiPath) return
        if (!apiProcess || apiProcess.exitCode !== null || apiProcess.signalCode !== null) return
        restartRequested = true
        apiProcess.kill()
      })
      server.httpServer?.once('close', () => {
        isShuttingDown = true
        restartRequested = false
        if (apiProcess && apiProcess.exitCode === null && apiProcess.signalCode === null) {
          apiProcess.kill()
        }
      })
      try {
        await waitForApiReady(apiProcess)
      } catch (error) {
        if (apiProcess && apiProcess.exitCode === null && apiProcess.signalCode === null) {
          apiProcess.kill()
        }
        console.error(`Could not start the ice factory API: ${error.message}`)
        throw error
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/All-o-din-ice-factory/',

  plugins: [react(), apiServerPlugin()],

  server: {
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
