//! 电脑操作：截屏、点击、打字。默认关，由 `[desktop] computer_use` 控制。
//!
//! 官方引擎没有桌面 GUI Computer Use 通道。本模块给内置 MCP 用，
//! 模型经 MCP 调用；每次调用仍走官方工具审批。

use std::io::Cursor;

use base64::Engine as _;

const MAX_SHOT_WIDTH: u32 = 1280;

/// `[desktop] computer_use`，缺省为关。
pub fn is_enabled() -> bool {
    let Ok(root) = crate::commands::load_config_root() else {
        return false;
    };
    root.get("desktop")
        .and_then(|d| d.get("computer_use"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

pub fn set_enabled(on: bool) -> Result<(), String> {
    let mut root = crate::commands::load_config_root()?;
    let root_tbl = root
        .as_table_mut()
        .ok_or_else(|| "config.toml 根节点必须是 table".to_string())?;
    let desktop = root_tbl
        .entry("desktop".to_string())
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    let desktop_tbl = desktop
        .as_table_mut()
        .ok_or_else(|| "[desktop] 必须是 table".to_string())?;
    desktop_tbl.insert("computer_use".into(), toml::Value::Boolean(on));
    crate::commands::write_config_root(&root)
}

pub struct Shot {
    pub width: u32,
    pub height: u32,
    pub screen_width: u32,
    pub screen_height: u32,
    pub origin_x: i32,
    pub origin_y: i32,
    pub png: Vec<u8>,
}

pub fn screenshot() -> Result<Shot, String> {
    if !is_enabled() {
        return Err("电脑操作未开启。到设置 → 安全打开，并确认会截屏、模拟键鼠。".into());
    }
    screenshot_os()
}

pub fn click(x: i32, y: i32, button: &str) -> Result<String, String> {
    if !is_enabled() {
        return Err("电脑操作未开启".into());
    }
    click_os(x, y, button)
}

pub fn type_text(text: &str) -> Result<String, String> {
    if !is_enabled() {
        return Err("电脑操作未开启".into());
    }
    type_os(text)
}

pub fn press_key(key: &str) -> Result<String, String> {
    if !is_enabled() {
        return Err("电脑操作未开启".into());
    }
    key_os(key)
}

pub fn screen_size() -> Result<(u32, u32), String> {
    if !is_enabled() {
        return Err("电脑操作未开启".into());
    }
    screen_size_os()
}

pub fn shot_to_json(shot: &Shot) -> serde_json::Value {
    let b64 = base64::engine::general_purpose::STANDARD.encode(&shot.png);
    serde_json::json!({
        "width": shot.width,
        "height": shot.height,
        "screen_width": shot.screen_width,
        "screen_height": shot.screen_height,
        "origin_x": shot.origin_x,
        "origin_y": shot.origin_y,
        "mime": "image/png",
        "image_png_base64": b64,
        "note": "坐标按本图像素。点击时用图上的 x/y，后端会映射到屏幕。",
    })
}

pub fn encode_png_rgb(width: u32, height: u32, rgb: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(Cursor::new(&mut out), width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("写 PNG 头失败: {e}"))?;
        writer
            .write_image_data(rgb)
            .map_err(|e| format!("写 PNG 失败: {e}"))?;
    }
    Ok(out)
}

pub fn downscale_rgb(width: u32, height: u32, rgb: &[u8], max_width: u32) -> (u32, u32, Vec<u8>) {
    if width <= max_width || width == 0 {
        return (width, height, rgb.to_vec());
    }
    let nw = max_width;
    let nh = ((height as u64 * nw as u64) / width as u64).max(1) as u32;
    let mut out = vec![0u8; (nw * nh * 3) as usize];
    for y in 0..nh {
        let sy = (y as u64 * height as u64) / nh as u64;
        for x in 0..nw {
            let sx = (x as u64 * width as u64) / nw as u64;
            let si = ((sy * width as u64 + sx) * 3) as usize;
            let di = ((y as u64 * nw as u64 + x as u64) * 3) as usize;
            out[di..di + 3].copy_from_slice(&rgb[si..si + 3]);
        }
    }
    (nw, nh, out)
}

#[cfg(windows)]
fn screenshot_os() -> Result<Shot, String> {
    windows_screenshot()
}

#[cfg(not(windows))]
fn screenshot_os() -> Result<Shot, String> {
    Err("电脑操作目前只在 Windows 上可用".into())
}

#[cfg(windows)]
fn click_os(x: i32, y: i32, button: &str) -> Result<String, String> {
    windows_click(x, y, button)
}

#[cfg(not(windows))]
fn click_os(_x: i32, _y: i32, _button: &str) -> Result<String, String> {
    Err("电脑操作目前只在 Windows 上可用".into())
}

#[cfg(windows)]
fn type_os(text: &str) -> Result<String, String> {
    windows_type(text)
}

#[cfg(not(windows))]
fn type_os(_text: &str) -> Result<String, String> {
    Err("电脑操作目前只在 Windows 上可用".into())
}

#[cfg(windows)]
fn key_os(key: &str) -> Result<String, String> {
    windows_key(key)
}

#[cfg(not(windows))]
fn key_os(_key: &str) -> Result<String, String> {
    Err("电脑操作目前只在 Windows 上可用".into())
}

#[cfg(windows)]
fn screen_size_os() -> Result<(u32, u32), String> {
    windows_screen_size()
}

#[cfg(not(windows))]
fn screen_size_os() -> Result<(u32, u32), String> {
    Err("电脑操作目前只在 Windows 上可用".into())
}

#[cfg(windows)]
fn windows_screen_size() -> Result<(u32, u32), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    };
    unsafe {
        let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if w <= 0 || h <= 0 {
            return Err("读不到屏幕尺寸".into());
        }
        Ok((w as u32, h as u32))
    }
}

#[cfg(windows)]
fn windows_screenshot() -> Result<Shot, String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        BITMAPINFO, BITMAPINFOHEADER, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, HGDIOBJ, ReleaseDC, SRCCOPY,
        SelectObject,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    };

    unsafe {
        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if vw <= 0 || vh <= 0 {
            return Err("读不到屏幕尺寸".into());
        }
        let hdc = GetDC(Some(HWND::default()));
        if hdc.0.is_null() {
            return Err("GetDC 失败".into());
        }
        let mem = CreateCompatibleDC(Some(hdc));
        let bmp = CreateCompatibleBitmap(hdc, vw, vh);
        let old = SelectObject(mem, HGDIOBJ(bmp.0));
        let blit_ok = BitBlt(mem, 0, 0, vw, vh, Some(hdc), vx, vy, SRCCOPY).is_ok();
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: vw,
                biHeight: -vh, // top-down
                biPlanes: 1,
                biBitCount: 24,
                biCompression: 0,
                ..Default::default()
            },
            ..Default::default()
        };
        let stride = ((((vw as u32) * 3 + 3) / 4) * 4) as u32;
        let mut dib = vec![0u8; (stride * vh as u32) as usize];
        let got = GetDIBits(
            mem,
            bmp,
            0,
            vh as u32,
            Some(dib.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        );
        SelectObject(mem, old);
        let _ = DeleteObject(HGDIOBJ(bmp.0));
        let _ = DeleteDC(mem);
        ReleaseDC(Some(HWND::default()), hdc);
        if !blit_ok || got == 0 {
            return Err("截屏失败".into());
        }
        let mut rgb = vec![0u8; (vw * vh * 3) as usize];
        for y in 0..vh as u32 {
            let src = (y * stride) as usize;
            let dst = (y * vw as u32 * 3) as usize;
            for x in 0..vw as u32 {
                let si = src + (x * 3) as usize;
                let di = dst + (x * 3) as usize;
                // BGR → RGB
                rgb[di] = dib[si + 2];
                rgb[di + 1] = dib[si + 1];
                rgb[di + 2] = dib[si];
            }
        }
        let screen_width = vw as u32;
        let screen_height = vh as u32;
        let (width, height, scaled) =
            downscale_rgb(screen_width, screen_height, &rgb, MAX_SHOT_WIDTH);
        let png = encode_png_rgb(width, height, &scaled)?;
        Ok(Shot {
            width,
            height,
            screen_width,
            screen_height,
            origin_x: vx,
            origin_y: vy,
            png,
        })
    }
}

#[cfg(windows)]
fn windows_click(x: i32, y: i32, button: &str) -> Result<String, String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
        MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, mouse_event,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SetCursorPos,
    };
    let (sw, sh) = windows_screen_size()?;
    let (vx, vy) = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
        )
    };
    let img_w = ((sw.min(MAX_SHOT_WIDTH)) as i32).max(1);
    let img_h = (((sh as u64 * img_w as u64) / sw as u64) as i32).max(1);
    let sx = vx + (x as i64 * sw as i64 / img_w as i64) as i32;
    let sy = vy + (y as i64 * sh as i64 / img_h as i64) as i32;
    unsafe {
        SetCursorPos(sx, sy).map_err(|e| format!("移动光标失败: {e}"))?;
        let (down, up) = match button.trim().to_ascii_lowercase().as_str() {
            "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
            "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
            _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        };
        mouse_event(down, 0, 0, 0, 0);
        mouse_event(up, 0, 0, 0, 0);
    }
    Ok(format!("已点击 ({sx},{sy})"))
}

#[cfg(windows)]
fn windows_type(text: &str) -> Result<String, String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, SendInput,
        VIRTUAL_KEY,
    };
    if text.is_empty() {
        return Err("要打的字是空的".into());
    }
    let mut inputs: Vec<INPUT> = Vec::new();
    for ch in text.encode_utf16() {
        let down = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: ch,
                    dwFlags: KEYEVENTF_UNICODE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let up = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: ch,
                    dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        inputs.push(down);
        inputs.push(up);
    }
    unsafe {
        let n = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        if n as usize != inputs.len() {
            return Err("SendInput 未全部送达".into());
        }
    }
    Ok(format!("已输入 {} 个字符", text.chars().count()))
}

#[cfg(windows)]
fn windows_key(key: &str) -> Result<String, String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput, VIRTUAL_KEY,
        VK_BACK, VK_CONTROL, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_HOME, VK_LEFT, VK_MENU,
        VK_NEXT, VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP,
    };
    let raw = key.trim().to_ascii_lowercase();
    if raw.is_empty() {
        return Err("按键名是空的".into());
    }
    let mut mods: Vec<VIRTUAL_KEY> = Vec::new();
    let mut main = raw.as_str();
    if let Some(rest) = raw.strip_prefix("ctrl+") {
        mods.push(VK_CONTROL);
        main = rest;
    }
    if let Some(rest) = main.strip_prefix("alt+") {
        mods.push(VK_MENU);
        main = rest;
    }
    if let Some(rest) = main.strip_prefix("shift+") {
        mods.push(VK_SHIFT);
        main = rest;
    }
    let vk = match main {
        "enter" | "return" => VK_RETURN,
        "tab" => VK_TAB,
        "esc" | "escape" => VK_ESCAPE,
        "space" => VK_SPACE,
        "backspace" => VK_BACK,
        "delete" | "del" => VK_DELETE,
        "up" => VK_UP,
        "down" => VK_DOWN,
        "left" => VK_LEFT,
        "right" => VK_RIGHT,
        "home" => VK_HOME,
        "end" => VK_END,
        "pageup" => VK_PRIOR,
        "pagedown" => VK_NEXT,
        other if other.len() == 1 => {
            let c = other.as_bytes()[0];
            if c.is_ascii_alphanumeric() {
                VIRTUAL_KEY(c.to_ascii_uppercase() as u16)
            } else {
                return Err(format!("不认识的按键: {key}"));
            }
        }
        _ => return Err(format!("不认识的按键: {key}")),
    };
    let mut inputs: Vec<INPUT> = Vec::new();
    let push = |inputs: &mut Vec<INPUT>, k: VIRTUAL_KEY, up: bool| {
        inputs.push(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: k,
                    wScan: 0,
                    dwFlags: if up {
                        KEYEVENTF_KEYUP
                    } else {
                        Default::default()
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    };
    for m in &mods {
        push(&mut inputs, *m, false);
    }
    push(&mut inputs, vk, false);
    push(&mut inputs, vk, true);
    for m in mods.iter().rev() {
        push(&mut inputs, *m, true);
    }
    unsafe {
        let n = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        if n as usize != inputs.len() {
            return Err("SendInput 未全部送达".into());
        }
    }
    Ok(format!("已按 {key}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_roundtrip_header() {
        let rgb = [255u8, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0];
        let png = encode_png_rgb(2, 2, &rgb).unwrap();
        assert!(png.starts_with(&[137, 80, 78, 71]));
    }

    #[test]
    fn downscale_halves_width() {
        let mut rgb = vec![0u8; 8 * 2 * 3];
        rgb[0] = 1;
        let (w, h, out) = downscale_rgb(8, 2, &rgb, 4);
        assert_eq!((w, h), (4, 1));
        assert_eq!(out.len(), 4 * 1 * 3);
    }
}
