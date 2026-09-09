/** 电脑操作：Windows / macOS / Linux。其它系统开不了。 */

export const COMPUTER_USE_UNSUPPORTED = '电脑操作目前只支持 Windows、macOS 和 Linux。'

export function computerUseBlockedReason(
  wantOn: boolean,
  supported: boolean,
): string | null {
  if (wantOn && !supported) return COMPUTER_USE_UNSUPPORTED
  return null
}

export function computerUseMenuSub(supported: boolean): string {
  return supported
    ? '截屏、点击、打字。默认关，在设置里授权'
    : '当前系统不可用'
}

export function computerUsePlatformHint(platform: string | undefined): string | null {
  switch ((platform || '').toLowerCase()) {
    case 'macos':
      return 'macOS 要在「系统设置 → 隐私与安全性」打开屏幕录制和辅助功能。'
    case 'linux':
      return 'Linux 需要 grim 或 ImageMagick import / scrot，以及 xdotool（X11）或 ydotool（Wayland）。'
    default:
      return null
  }
}
