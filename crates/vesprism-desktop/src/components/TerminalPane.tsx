import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  detachTabPty,
  listenPtyOutput,
  resizeTabPty,
  startTabPty,
  writeTabPty,
} from '../lib/terminalXterm'
import { markPtyAlive } from '../store'

/** 当前 Tab 的交互式 shell。卸载只 detach，不杀进程。 */
export function TerminalPane({ tabId, cwd }: { tabId: string; cwd: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !tabId) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, 'JetBrains Mono', Consolas, monospace",
      theme: {
        background: '#111827',
        foreground: '#e5e7eb',
        cursor: '#e5e7eb',
      },
      convertEol: false,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    const cols = term.cols || 80
    const rows = term.rows || 24
    let unlisten: (() => void) | undefined
    let alive = true

    // 先 listen 再 start：提示符往往在 spawn 当下就写出，后挂听会空屏。
    void listenPtyOutput(tabId, (data) => {
      if (alive) term.write(data)
    })
      .then((fn) => {
        unlisten = fn
        if (!alive) return Promise.resolve()
        return startTabPty(tabId, cwd, cols, rows)
      })
      .then(() => {
        if (alive) markPtyAlive(tabId, true)
      })
      .catch((e) => {
        if (alive) term.writeln(`\r\n启动终端失败: ${String(e)}`)
      })

    const sub = term.onData((data) => {
      void writeTabPty(tabId, data).catch(() => {})
    })

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        void resizeTabPty(tabId, term.cols, term.rows).catch(() => {})
      } catch {
        /* 容器尚未有尺寸 */
      }
    })
    ro.observe(host)

    return () => {
      alive = false
      ro.disconnect()
      sub.dispose()
      unlisten?.()
      term.dispose()
      void detachTabPty(tabId).catch(() => {})
    }
  }, [tabId, cwd])

  return <div ref={hostRef} className="session-pty-host" />
}
